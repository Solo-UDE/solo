/**
 * OpenAI provider adapter.
 *
 * Chat mode keeps the direct Responses API path. Agent mode delegates to the
 * Codex CLI (`codex exec --json`) so GPT models use the same harness, tools,
 * MCP config, and command sandbox semantics as Codex itself.
 */

import { spawn } from 'node:child_process';
import { constants as FsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import OpenAI from 'openai';

import { createLogger } from '../logger.js';

import type { AttachmentContentBlock } from '../messages.js';
import type { ProviderEvent, ProviderSession, SessionCredentials } from './types.js';

const logger = createLogger('OpenAIAdapter');

export interface OpenAIAdapterOptions {
  /** Model alias — e.g. "gpt-5.5". */
  model: string;
  /** Credentials resolved by Rust and passed across the wire. Required. */
  credentials: SessionCredentials;
  /** Optional max output tokens. Defaults to no cap (model-level default). */
  maxTokens?: number;
  /** Optional: enable reasoning/thinking for models that support it. */
  thinkingEnabled?: boolean;
  /** When true, run through Codex's agent harness instead of direct chat. */
  agentMode?: boolean;
  /** Working directory for Codex agent sessions. */
  cwd?: string;
  /** Codex thread id to resume. */
  resumeSessionId?: string;
  /** Whether this Solo session was created as a fork. Codex exec resumes in place. */
  forkSession?: boolean;
}

const CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const API_BASE_URL = 'https://api.openai.com/v1';
const CODEX_INSPIRATION_DIR = '/Users/sachin/Developer/Orbit_Main/Inspirations/codex';
const INSTALLED_CODEX_PATH = '/Applications/Codex.app/Contents/Resources/codex';
const DEBUG_CODEX_SCRIPT = `${CODEX_INSPIRATION_DIR}/scripts/debug-codex.sh`;

type JsonRecord = Record<string, unknown>;
type ToolCallProviderEvent = Extract<ProviderEvent, { type: 'tool_call' }>;
type ToolResultProviderEvent = Extract<ProviderEvent, { type: 'tool_result' }>;

interface PendingMessage {
  text: string;
  attachments?: AttachmentContentBlock[];
}

interface CodexTranslationState {
  startedToolIds: Set<string>;
  isResumed: boolean;
  isForked: boolean;
}

let codexExecutablePromise: Promise<string> | null = null;

export async function createOpenAISession(
  opts: OpenAIAdapterOptions
): Promise<ProviderSession> {
  if (opts.agentMode === true) {
    return createCodexHarnessSession(opts);
  }

  const { model, credentials, maxTokens, thinkingEnabled } = opts;

  const client = buildClient(credentials);
  const usesChatGptBackend = credentials.kind === 'oauth';

  // Pending user input, flushed when receiveResponse() is called.
  // OpenAI's Responses API is request/response per turn (not a persistent
  // socket), so we buffer the latest message and send it on drain.
  let pendingUserText: string | null = null;
  let abortController: AbortController | null = null;
  let closed = false;

  const session: ProviderSession = {
    provider: 'openai',

    sendMessage(text: string, _attachments?: AttachmentContentBlock[]): void {
      // v1: attachments are silently dropped.
      if (closed) {
        logger.warn('sendMessage called on closed OpenAI session — ignoring');
        return;
      }
      pendingUserText = text;
    },

    async *receiveResponse(): AsyncIterable<ProviderEvent> {
      if (closed) {
        yield { type: 'done', stopReason: 'session_closed' };
        return;
      }
      if (pendingUserText === null) {
        logger.warn('receiveResponse called with no pending message');
        yield { type: 'done', stopReason: 'no_input' };
        return;
      }

      const userText = pendingUserText;
      pendingUserText = null;
      abortController = new AbortController();

      try {
        // Build the request body. We use `any` at the call site because the
        // Responses API is evolving rapidly and the openai SDK's types may
        // not match the server exactly — defensive typing here lets us
        // tolerate SDK drift without build failures.
        const requestBody: Record<string, unknown> = usesChatGptBackend
          ? {
              model,
              instructions: 'You are Solo. Reply directly and concisely.',
              input: [
                {
                  role: 'user',
                  content: [{ type: 'input_text', text: userText }],
                },
              ],
              stream: true,
              store: false,
              tools: [],
            }
          : {
              model,
              input: userText,
              stream: true,
              tools: [],
            };
        if (!usesChatGptBackend && maxTokens !== undefined) {
          requestBody.max_output_tokens = maxTokens;
        }
        if (thinkingEnabled === true) {
          requestBody.reasoning = { effort: 'medium' };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream: AsyncIterable<Record<string, unknown>> = (await (client.responses.create as any)(
          requestBody,
          { signal: abortController.signal }
        )) as AsyncIterable<Record<string, unknown>>;

        let sawDone = false;

        for await (const event of stream) {
          if (abortController?.signal.aborted) {
            yield { type: 'done', stopReason: 'interrupted' };
            sawDone = true;
            return;
          }
          const ev = translateEvent(event);
          if (ev) {
            if (ev.type === 'done') sawDone = true;
            yield ev;
          }
        }

        // If the stream ended without a response.completed event, emit a
        // synthetic done so the consumer's loop terminates cleanly.
        if (!sawDone) {
          yield { type: 'done', stopReason: 'end_turn' };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, 'OpenAI Responses API error');
        throw err;
      } finally {
        abortController = null;
      }
    },

    async interrupt(): Promise<void> {
      if (abortController) {
        abortController.abort();
      }
    },

    async close(): Promise<void> {
      closed = true;
      if (abortController) {
        abortController.abort();
      }
    },
  };

  return session;
}

async function createCodexHarnessSession(opts: OpenAIAdapterOptions): Promise<ProviderSession> {
  const credentials = opts.credentials;
  const cwd = opts.cwd ?? process.cwd();
  let model = opts.model;
  let codexThreadId = opts.resumeSessionId ?? null;
  let pendingMessage: PendingMessage | null = null;
  let activeChild: ReturnType<typeof spawn> | null = null;
  let interrupted = false;
  let closed = false;

  const session: ProviderSession = {
    provider: 'openai',

    sendMessage(text: string, attachments?: AttachmentContentBlock[]): void {
      if (closed) {
        logger.warn('sendMessage called on closed OpenAI Codex session — ignoring');
        return;
      }
      pendingMessage = { text, attachments };
    },

    async *receiveResponse(): AsyncIterable<ProviderEvent> {
      if (closed) {
        yield { type: 'done', stopReason: 'session_closed' };
        return;
      }
      if (pendingMessage === null) {
        logger.warn('receiveResponse called with no pending Codex message');
        yield { type: 'done', stopReason: 'no_input' };
        return;
      }

      const message = pendingMessage;
      pendingMessage = null;
      interrupted = false;
      const prompt = buildCodexPrompt(message);
      const executable = await resolveCodexExecutable();
      const useResume = codexThreadId !== null;
      const args = buildCodexExecArgs({
        model,
        cwd,
        resumeThreadId: useResume ? codexThreadId : null,
        attachments: message.attachments,
      });
      const env = buildCodexEnv(credentials);
      const startedAt = Date.now();
      const child = spawn(executable, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      activeChild = child;

      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.stdin.on('error', () => {
        // The child may exit before it reads stdin after an auth/config error.
      });
      child.stdin.end(prompt);

      const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once('error', reject);
          child.once('close', (code, signal) => resolve({ code, signal }));
        }
      );

      const translationState: CodexTranslationState = {
        startedToolIds: new Set(),
        isResumed: useResume,
        isForked: opts.forkSession === true,
      };
      let sawDone = false;
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });

      try {
        for await (const line of lines) {
          if (line.trim() === '') continue;
          const event = parseCodexEvent(line);
          if (event === null) {
            logger.warn({ line }, 'Ignoring malformed Codex JSONL event');
            continue;
          }

          for (const providerEvent of translateCodexEvent(event, translationState)) {
            if (providerEvent.type === 'session_init') {
              codexThreadId = providerEvent.sdkSessionId;
            } else if (providerEvent.type === 'done') {
              sawDone = true;
            }
            yield providerEvent;
          }
        }

        const { code, signal } = await exitPromise;
        if (interrupted) {
          if (!sawDone) {
            yield { type: 'done', stopReason: 'interrupted', durationMs: Date.now() - startedAt };
          }
          return;
        }
        if (code !== 0) {
          const suffix = signal ? ` (signal ${signal})` : '';
          const messageText = stderr.trim() || `codex exec exited with code ${String(code)}${suffix}`;
          throw new Error(messageText);
        }
        if (!sawDone) {
          yield { type: 'done', stopReason: 'end_turn', durationMs: Date.now() - startedAt };
        }
      } finally {
        activeChild = null;
      }
    },

    async interrupt(): Promise<void> {
      interrupted = true;
      if (activeChild && !activeChild.killed) {
        activeChild.kill('SIGINT');
      }
    },

    async close(): Promise<void> {
      closed = true;
      interrupted = true;
      if (activeChild && !activeChild.killed) {
        activeChild.kill('SIGINT');
      }
    },

    async setModel(nextModel: string): Promise<void> {
      model = nextModel;
    },
  };

  return session;
}

function buildClient(credentials: SessionCredentials): OpenAI {
  switch (credentials.kind) {
    case 'oauth': {
      const defaultHeaders: Record<string, string> = {};
      if (credentials.accountId) {
        defaultHeaders['ChatGPT-Account-Id'] = credentials.accountId;
      }
      return new OpenAI({
        apiKey: credentials.token,
        baseURL: CHATGPT_BASE_URL,
        defaultHeaders,
      });
    }
    case 'api_key':
      return new OpenAI({
        apiKey: credentials.token,
        baseURL: API_BASE_URL,
      });
  }
}

async function resolveCodexExecutable(): Promise<string> {
  codexExecutablePromise ??= resolveCodexExecutableInner();
  return codexExecutablePromise;
}

async function resolveCodexExecutableInner(): Promise<string> {
  const candidates = [
    process.env.SOLO_CODEX_EXECUTABLE,
    process.env.CODEX_EXECUTABLE,
    process.env.CODEX_PATH,
    INSTALLED_CODEX_PATH,
    DEBUG_CODEX_SCRIPT,
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim() !== ''));

  for (const candidate of candidates) {
    if (!candidate.includes('/')) {
      return candidate;
    }
    try {
      await access(candidate, FsConstants.X_OK);
      return candidate;
    } catch {
      logger.debug({ candidate }, 'Codex executable candidate is not usable');
    }
  }

  return 'codex';
}

function buildCodexExecArgs(opts: {
  model: string;
  cwd: string;
  resumeThreadId: string | null;
  attachments?: AttachmentContentBlock[];
}): string[] {
  const args =
    opts.resumeThreadId === null
      ? ['exec', '--json', '--model', opts.model, '--skip-git-repo-check']
      : ['exec', 'resume', '--json', '--model', opts.model, '--skip-git-repo-check'];

  const bypass = process.env.SOLO_CODEX_BYPASS_APPROVALS !== '0';
  if (bypass) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    args.push('--sandbox', process.env.SOLO_CODEX_SANDBOX ?? 'danger-full-access');
  }

  const imagePaths = imageAttachmentPaths(opts.attachments);
  for (const imagePath of imagePaths) {
    args.push('-i', imagePath);
  }

  if (opts.resumeThreadId === null) {
    args.push('--cd', opts.cwd, '-');
  } else {
    args.push(opts.resumeThreadId, '-');
  }

  return args;
}

function buildCodexEnv(credentials: SessionCredentials): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (credentials.kind === 'api_key') {
    env.CODEX_API_KEY = credentials.token;
    env.OPENAI_API_KEY ??= credentials.token;
  }
  return env;
}

function buildCodexPrompt(message: PendingMessage): string {
  const attachmentText = (message.attachments ?? [])
    .map(formatAttachmentForPrompt)
    .filter((text): text is string => text !== null);

  if (attachmentText.length === 0) {
    return message.text;
  }

  return `${message.text}\n\n<solo_attachments>\n${attachmentText.join('\n\n')}\n</solo_attachments>`;
}

function formatAttachmentForPrompt(attachment: AttachmentContentBlock): string | null {
  if (attachment.type === 'text' && attachment.text) {
    const label = attachment.name ?? attachment.filePath ?? 'text attachment';
    return `<attachment name="${escapeXmlAttribute(label)}">\n${attachment.text}\n</attachment>`;
  }
  if (attachment.filePath) {
    const range =
      attachment.lineStart !== undefined
        ? ` lines ${String(attachment.lineStart)}-${String(attachment.lineEnd ?? attachment.lineStart)}`
        : '';
    return `<attachment_path>${attachment.filePath}${range}</attachment_path>`;
  }
  if (attachment.name) {
    return `<attachment name="${escapeXmlAttribute(attachment.name)}" type="${attachment.type}">Attached binary content is available in Solo but cannot be passed to codex exec without a file path.</attachment>`;
  }
  return null;
}

function imageAttachmentPaths(attachments?: AttachmentContentBlock[]): string[] {
  return (attachments ?? [])
    .filter((attachment) => attachment.type === 'image' && typeof attachment.filePath === 'string')
    .map((attachment) => attachment.filePath as string);
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function parseCodexEvent(line: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function* translateCodexEvent(
  event: JsonRecord,
  state: CodexTranslationState
): Iterable<ProviderEvent> {
  const type = asString(event.type);

  switch (type) {
    case 'thread.started': {
      const threadId = asString(event.thread_id);
      if (threadId !== '') {
        yield {
          type: 'session_init',
          sdkSessionId: threadId,
          isResumed: state.isResumed,
          isForked: state.isForked,
        };
      }
      return;
    }
    case 'item.started': {
      const item = getCodexItem(event);
      const toolCall = item ? toolCallFromCodexItem(item) : null;
      if (toolCall) {
        state.startedToolIds.add(toolCall.id);
        yield toolCall;
      }
      return;
    }
    case 'item.completed': {
      const item = getCodexItem(event);
      if (!item) return;
      const itemType = asString(item.type);

      if (itemType === 'agent_message') {
        const text = asString(item.text);
        if (text !== '') yield { type: 'text_delta', text };
        return;
      }
      if (itemType === 'reasoning') {
        const text = asString(item.text);
        if (text !== '') yield { type: 'thinking_delta', text };
        return;
      }
      if (itemType === 'error') {
        const message = asString(item.message, 'Codex item failed');
        yield {
          type: 'tool_result',
          toolCallId: asString(item.id, 'codex_error'),
          output: message,
          isError: true,
        };
        return;
      }

      const toolCall = toolCallFromCodexItem(item);
      if (toolCall && !state.startedToolIds.has(toolCall.id)) {
        state.startedToolIds.add(toolCall.id);
        yield toolCall;
      }
      const toolResult = toolResultFromCodexItem(item);
      if (toolResult) yield toolResult;
      return;
    }
    case 'turn.completed': {
      const usage = isRecord(event.usage) ? event.usage : {};
      yield {
        type: 'usage',
        inputTokens: asNumber(usage.input_tokens),
        outputTokens: asNumber(usage.output_tokens),
        cacheReadInputTokens: asNumber(usage.cached_input_tokens),
      };
      yield { type: 'done', stopReason: 'end_turn' };
      return;
    }
    case 'turn.failed': {
      const error = isRecord(event.error) ? event.error : {};
      throw new Error(asString(error.message, 'Codex turn failed'));
    }
    case 'error':
      throw new Error(asString(event.message, 'Codex stream failed'));
    default:
      return;
  }
}

function getCodexItem(event: JsonRecord): JsonRecord | null {
  const item = event.item;
  return isRecord(item) ? item : null;
}

function toolCallFromCodexItem(item: JsonRecord): ToolCallProviderEvent | null {
  const id = asString(item.id);
  if (id === '') return null;

  const tool = codexToolDescriptor(item);
  if (tool === null) return null;
  return {
    type: 'tool_call',
    id,
    name: tool.name,
    input: tool.input,
  };
}

function toolResultFromCodexItem(item: JsonRecord): ToolResultProviderEvent | null {
  const id = asString(item.id);
  if (id === '') return null;

  const itemType = asString(item.type);
  switch (itemType) {
    case 'command_execution':
      return {
        type: 'tool_result',
        toolCallId: id,
        output: commandExecutionOutput(item),
        isError: isFailedStatus(item.status) || asNumber(item.exit_code, 0) !== 0,
      };
    case 'file_change':
      return {
        type: 'tool_result',
        toolCallId: id,
        output: jsonForDisplay({ changes: item.changes ?? [], status: item.status }),
        isError: isFailedStatus(item.status),
      };
    case 'mcp_tool_call':
      return {
        type: 'tool_result',
        toolCallId: id,
        output: mcpToolOutput(item),
        isError: isFailedStatus(item.status) || item.error !== undefined,
      };
    case 'collab_tool_call':
      return {
        type: 'tool_result',
        toolCallId: id,
        output: jsonForDisplay({
          status: item.status,
          receiver_thread_ids: item.receiver_thread_ids,
          agents_states: item.agents_states,
        }),
        isError: isFailedStatus(item.status),
      };
    case 'web_search':
      return {
        type: 'tool_result',
        toolCallId: id,
        output: jsonForDisplay({ query: item.query, action: item.action }),
      };
    case 'todo_list':
      return {
        type: 'tool_result',
        toolCallId: id,
        output: jsonForDisplay({ items: item.items ?? [] }),
      };
    default:
      return null;
  }
}

function codexToolDescriptor(item: JsonRecord): { name: string; input: Record<string, unknown> } | null {
  switch (asString(item.type)) {
    case 'command_execution':
      return {
        name: 'Bash',
        input: { command: asString(item.command), status: item.status },
      };
    case 'file_change':
      return {
        name: 'apply_patch',
        input: { changes: item.changes ?? [], status: item.status },
      };
    case 'mcp_tool_call': {
      const server = asString(item.server, 'unknown');
      const tool = asString(item.tool, 'unknown');
      return {
        name: `mcp__${server}__${tool}`,
        input: normalizeToolInput(item.arguments),
      };
    }
    case 'collab_tool_call':
      return {
        name: collabToolName(asString(item.tool, 'unknown')),
        input: {
          prompt: item.prompt,
          receiver_thread_ids: item.receiver_thread_ids,
        },
      };
    case 'web_search':
      return {
        name: 'WebSearch',
        input: { id: item.id, query: item.query, action: item.action },
      };
    case 'todo_list':
      return {
        name: 'update_plan',
        input: { items: item.items ?? [] },
      };
    default:
      return null;
  }
}

function commandExecutionOutput(item: JsonRecord): string {
  const output = asString(item.aggregated_output);
  const exitCode = item.exit_code;
  if (output !== '') {
    return output;
  }
  return jsonForDisplay({ status: item.status, exit_code: exitCode });
}

function mcpToolOutput(item: JsonRecord): string {
  if (isRecord(item.error)) {
    return asString(item.error.message, jsonForDisplay(item.error));
  }
  if (item.result !== undefined) {
    return jsonForDisplay(item.result);
  }
  return jsonForDisplay({ status: item.status });
}

function collabToolName(tool: string): string {
  switch (tool) {
    case 'spawn_agent':
      return 'spawn_agent';
    case 'send_input':
      return 'send_input';
    case 'wait':
      return 'wait_agent';
    case 'close_agent':
      return 'close_agent';
    default:
      return `collab__${tool}`;
  }
}

function normalizeToolInput(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  return { arguments: value };
}

function isFailedStatus(status: unknown): boolean {
  return status === 'failed' || status === 'declined' || status === 'error';
}

function jsonForDisplay(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Translate an OpenAI Responses API SSE event into an internal ProviderEvent.
 * Returns null for events we don't surface.
 *
 * Reference: https://platform.openai.com/docs/api-reference/responses-streaming
 */
function translateEvent(event: Record<string, unknown>): ProviderEvent | null {
  const type = event.type as string | undefined;

  switch (type) {
    case 'response.output_text.delta': {
      const delta = event.delta as string | undefined;
      return typeof delta === 'string' && delta !== ''
        ? { type: 'text_delta', text: delta }
        : null;
    }
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta': {
      const delta = event.delta as string | undefined;
      return typeof delta === 'string' && delta !== ''
        ? { type: 'thinking_delta', text: delta }
        : null;
    }
    case 'response.completed': {
      const response = event.response as Record<string, unknown> | undefined;
      const usage = response?.usage as Record<string, unknown> | undefined;
      if (usage) {
        const inputTokens =
          typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
        const outputTokens =
          typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
        return { type: 'usage', inputTokens, outputTokens };
      }
      return null;
    }
    default:
      return null;
  }
}
