import {
  createLogger
} from "./chunk-PI2SZOW3.js";

// src/providers/openai.ts
import { spawn } from "child_process";
import { constants as FsConstants } from "fs";
import { access } from "fs/promises";
import { createInterface } from "readline";
import OpenAI from "openai";
var logger = createLogger("OpenAIAdapter");
var CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";
var API_BASE_URL = "https://api.openai.com/v1";
var CODEX_INSPIRATION_DIR = "/Users/sachin/Developer/Orbit_Main/Inspirations/codex";
var INSTALLED_CODEX_PATH = "/Applications/Codex.app/Contents/Resources/codex";
var DEBUG_CODEX_SCRIPT = `${CODEX_INSPIRATION_DIR}/scripts/debug-codex.sh`;
var codexExecutablePromise = null;
async function createOpenAISession(opts) {
  if (opts.agentMode === true) {
    return createCodexHarnessSession(opts);
  }
  const { model, credentials, maxTokens, thinkingEnabled } = opts;
  const client = buildClient(credentials);
  const usesChatGptBackend = credentials.kind === "oauth";
  let pendingUserText = null;
  let abortController = null;
  let closed = false;
  const session = {
    provider: "openai",
    sendMessage(text, _attachments) {
      if (closed) {
        logger.warn("sendMessage called on closed OpenAI session \u2014 ignoring");
        return;
      }
      pendingUserText = text;
    },
    async *receiveResponse() {
      if (closed) {
        yield { type: "done", stopReason: "session_closed" };
        return;
      }
      if (pendingUserText === null) {
        logger.warn("receiveResponse called with no pending message");
        yield { type: "done", stopReason: "no_input" };
        return;
      }
      const userText = pendingUserText;
      pendingUserText = null;
      abortController = new AbortController();
      try {
        const requestBody = usesChatGptBackend ? {
          model,
          instructions: "You are Solo. Reply directly and concisely.",
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: userText }]
            }
          ],
          stream: true,
          store: false,
          tools: []
        } : {
          model,
          input: userText,
          stream: true,
          tools: []
        };
        if (!usesChatGptBackend && maxTokens !== void 0) {
          requestBody.max_output_tokens = maxTokens;
        }
        if (thinkingEnabled === true) {
          requestBody.reasoning = { effort: "medium" };
        }
        const stream = await client.responses.create(
          requestBody,
          { signal: abortController.signal }
        );
        let sawDone = false;
        for await (const event of stream) {
          if (abortController?.signal.aborted) {
            yield { type: "done", stopReason: "interrupted" };
            sawDone = true;
            return;
          }
          const ev = translateEvent(event);
          if (ev) {
            if (ev.type === "done") sawDone = true;
            yield ev;
          }
        }
        if (!sawDone) {
          yield { type: "done", stopReason: "end_turn" };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "OpenAI Responses API error");
        throw err;
      } finally {
        abortController = null;
      }
    },
    async interrupt() {
      if (abortController) {
        abortController.abort();
      }
    },
    async close() {
      closed = true;
      if (abortController) {
        abortController.abort();
      }
    }
  };
  return session;
}
async function createCodexHarnessSession(opts) {
  const credentials = opts.credentials;
  const cwd = opts.cwd ?? process.cwd();
  let model = opts.model;
  let codexThreadId = opts.resumeSessionId ?? null;
  let pendingMessage = null;
  let activeChild = null;
  let interrupted = false;
  let closed = false;
  const session = {
    provider: "openai",
    sendMessage(text, attachments) {
      if (closed) {
        logger.warn("sendMessage called on closed OpenAI Codex session \u2014 ignoring");
        return;
      }
      pendingMessage = { text, attachments };
    },
    async *receiveResponse() {
      if (closed) {
        yield { type: "done", stopReason: "session_closed" };
        return;
      }
      if (pendingMessage === null) {
        logger.warn("receiveResponse called with no pending Codex message");
        yield { type: "done", stopReason: "no_input" };
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
        attachments: message.attachments
      });
      const env = buildCodexEnv(credentials);
      const startedAt = Date.now();
      const child = spawn(executable, args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"]
      });
      activeChild = child;
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdin.on("error", () => {
      });
      child.stdin.end(prompt);
      const exitPromise = new Promise(
        (resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({ code, signal }));
        }
      );
      const translationState = {
        startedToolIds: /* @__PURE__ */ new Set(),
        isResumed: useResume,
        isForked: opts.forkSession === true
      };
      let sawDone = false;
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (line.trim() === "") continue;
          const event = parseCodexEvent(line);
          if (event === null) {
            logger.warn({ line }, "Ignoring malformed Codex JSONL event");
            continue;
          }
          for (const providerEvent of translateCodexEvent(event, translationState)) {
            if (providerEvent.type === "session_init") {
              codexThreadId = providerEvent.sdkSessionId;
            } else if (providerEvent.type === "done") {
              sawDone = true;
            }
            yield providerEvent;
          }
        }
        const { code, signal } = await exitPromise;
        if (interrupted) {
          if (!sawDone) {
            yield { type: "done", stopReason: "interrupted", durationMs: Date.now() - startedAt };
          }
          return;
        }
        if (code !== 0) {
          const suffix = signal ? ` (signal ${signal})` : "";
          const messageText = stderr.trim() || `codex exec exited with code ${String(code)}${suffix}`;
          throw new Error(messageText);
        }
        if (!sawDone) {
          yield { type: "done", stopReason: "end_turn", durationMs: Date.now() - startedAt };
        }
      } finally {
        activeChild = null;
      }
    },
    async interrupt() {
      interrupted = true;
      if (activeChild && !activeChild.killed) {
        activeChild.kill("SIGINT");
      }
    },
    async close() {
      closed = true;
      interrupted = true;
      if (activeChild && !activeChild.killed) {
        activeChild.kill("SIGINT");
      }
    },
    async setModel(nextModel) {
      model = nextModel;
    }
  };
  return session;
}
function buildClient(credentials) {
  switch (credentials.kind) {
    case "oauth": {
      const defaultHeaders = {};
      if (credentials.accountId) {
        defaultHeaders["ChatGPT-Account-Id"] = credentials.accountId;
      }
      return new OpenAI({
        apiKey: credentials.token,
        baseURL: CHATGPT_BASE_URL,
        defaultHeaders
      });
    }
    case "api_key":
      return new OpenAI({
        apiKey: credentials.token,
        baseURL: API_BASE_URL
      });
  }
}
async function resolveCodexExecutable() {
  codexExecutablePromise ??= resolveCodexExecutableInner();
  return codexExecutablePromise;
}
async function resolveCodexExecutableInner() {
  const candidates = [
    process.env.SOLO_CODEX_EXECUTABLE,
    process.env.CODEX_EXECUTABLE,
    process.env.CODEX_PATH,
    INSTALLED_CODEX_PATH,
    DEBUG_CODEX_SCRIPT
  ].filter((candidate) => Boolean(candidate && candidate.trim() !== ""));
  for (const candidate of candidates) {
    if (!candidate.includes("/")) {
      return candidate;
    }
    try {
      await access(candidate, FsConstants.X_OK);
      return candidate;
    } catch {
      logger.debug({ candidate }, "Codex executable candidate is not usable");
    }
  }
  return "codex";
}
function buildCodexExecArgs(opts) {
  const args = opts.resumeThreadId === null ? ["exec", "--json", "--model", opts.model, "--skip-git-repo-check"] : ["exec", "resume", "--json", "--model", opts.model, "--skip-git-repo-check"];
  const bypass = process.env.SOLO_CODEX_BYPASS_APPROVALS !== "0";
  if (bypass) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", process.env.SOLO_CODEX_SANDBOX ?? "danger-full-access");
  }
  const imagePaths = imageAttachmentPaths(opts.attachments);
  for (const imagePath of imagePaths) {
    args.push("-i", imagePath);
  }
  if (opts.resumeThreadId === null) {
    args.push("--cd", opts.cwd, "-");
  } else {
    args.push(opts.resumeThreadId, "-");
  }
  return args;
}
function buildCodexEnv(credentials) {
  const env = { ...process.env };
  if (credentials.kind === "api_key") {
    env.CODEX_API_KEY = credentials.token;
    env.OPENAI_API_KEY ??= credentials.token;
  }
  return env;
}
function buildCodexPrompt(message) {
  const attachmentText = (message.attachments ?? []).map(formatAttachmentForPrompt).filter((text) => text !== null);
  if (attachmentText.length === 0) {
    return message.text;
  }
  return `${message.text}

<solo_attachments>
${attachmentText.join("\n\n")}
</solo_attachments>`;
}
function formatAttachmentForPrompt(attachment) {
  if (attachment.type === "text" && attachment.text) {
    const label = attachment.name ?? attachment.filePath ?? "text attachment";
    return `<attachment name="${escapeXmlAttribute(label)}">
${attachment.text}
</attachment>`;
  }
  if (attachment.filePath) {
    const range = attachment.lineStart !== void 0 ? ` lines ${String(attachment.lineStart)}-${String(attachment.lineEnd ?? attachment.lineStart)}` : "";
    return `<attachment_path>${attachment.filePath}${range}</attachment_path>`;
  }
  if (attachment.name) {
    return `<attachment name="${escapeXmlAttribute(attachment.name)}" type="${attachment.type}">Attached binary content is available in Solo but cannot be passed to codex exec without a file path.</attachment>`;
  }
  return null;
}
function imageAttachmentPaths(attachments) {
  return (attachments ?? []).filter((attachment) => attachment.type === "image" && typeof attachment.filePath === "string").map((attachment) => attachment.filePath);
}
function escapeXmlAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function parseCodexEvent(line) {
  try {
    const parsed = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function* translateCodexEvent(event, state) {
  const type = asString(event.type);
  switch (type) {
    case "thread.started": {
      const threadId = asString(event.thread_id);
      if (threadId !== "") {
        yield {
          type: "session_init",
          sdkSessionId: threadId,
          isResumed: state.isResumed,
          isForked: state.isForked
        };
      }
      return;
    }
    case "item.started": {
      const item = getCodexItem(event);
      const toolCall = item ? toolCallFromCodexItem(item) : null;
      if (toolCall) {
        state.startedToolIds.add(toolCall.id);
        yield toolCall;
      }
      return;
    }
    case "item.completed": {
      const item = getCodexItem(event);
      if (!item) return;
      const itemType = asString(item.type);
      if (itemType === "agent_message") {
        const text = asString(item.text);
        if (text !== "") yield { type: "text_delta", text };
        return;
      }
      if (itemType === "reasoning") {
        const text = asString(item.text);
        if (text !== "") yield { type: "thinking_delta", text };
        return;
      }
      if (itemType === "error") {
        const message = asString(item.message, "Codex item failed");
        yield {
          type: "tool_result",
          toolCallId: asString(item.id, "codex_error"),
          output: message,
          isError: true
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
    case "turn.completed": {
      const usage = isRecord(event.usage) ? event.usage : {};
      yield {
        type: "usage",
        inputTokens: asNumber(usage.input_tokens),
        outputTokens: asNumber(usage.output_tokens),
        cacheReadInputTokens: asNumber(usage.cached_input_tokens)
      };
      yield { type: "done", stopReason: "end_turn" };
      return;
    }
    case "turn.failed": {
      const error = isRecord(event.error) ? event.error : {};
      throw new Error(asString(error.message, "Codex turn failed"));
    }
    case "error":
      throw new Error(asString(event.message, "Codex stream failed"));
    default:
      return;
  }
}
function getCodexItem(event) {
  const item = event.item;
  return isRecord(item) ? item : null;
}
function toolCallFromCodexItem(item) {
  const id = asString(item.id);
  if (id === "") return null;
  const tool = codexToolDescriptor(item);
  if (tool === null) return null;
  return {
    type: "tool_call",
    id,
    name: tool.name,
    input: tool.input
  };
}
function toolResultFromCodexItem(item) {
  const id = asString(item.id);
  if (id === "") return null;
  const itemType = asString(item.type);
  switch (itemType) {
    case "command_execution":
      return {
        type: "tool_result",
        toolCallId: id,
        output: commandExecutionOutput(item),
        isError: isFailedStatus(item.status) || asNumber(item.exit_code, 0) !== 0
      };
    case "file_change":
      return {
        type: "tool_result",
        toolCallId: id,
        output: jsonForDisplay({ changes: item.changes ?? [], status: item.status }),
        isError: isFailedStatus(item.status)
      };
    case "mcp_tool_call":
      return {
        type: "tool_result",
        toolCallId: id,
        output: mcpToolOutput(item),
        isError: isFailedStatus(item.status) || item.error !== void 0
      };
    case "collab_tool_call":
      return {
        type: "tool_result",
        toolCallId: id,
        output: jsonForDisplay({
          status: item.status,
          receiver_thread_ids: item.receiver_thread_ids,
          agents_states: item.agents_states
        }),
        isError: isFailedStatus(item.status)
      };
    case "web_search":
      return {
        type: "tool_result",
        toolCallId: id,
        output: jsonForDisplay({ query: item.query, action: item.action })
      };
    case "todo_list":
      return {
        type: "tool_result",
        toolCallId: id,
        output: jsonForDisplay({ items: item.items ?? [] })
      };
    default:
      return null;
  }
}
function codexToolDescriptor(item) {
  switch (asString(item.type)) {
    case "command_execution":
      return {
        name: "Bash",
        input: { command: asString(item.command), status: item.status }
      };
    case "file_change":
      return {
        name: "apply_patch",
        input: { changes: item.changes ?? [], status: item.status }
      };
    case "mcp_tool_call": {
      const server = asString(item.server, "unknown");
      const tool = asString(item.tool, "unknown");
      return {
        name: `mcp__${server}__${tool}`,
        input: normalizeToolInput(item.arguments)
      };
    }
    case "collab_tool_call":
      return {
        name: collabToolName(asString(item.tool, "unknown")),
        input: {
          prompt: item.prompt,
          receiver_thread_ids: item.receiver_thread_ids
        }
      };
    case "web_search":
      return {
        name: "WebSearch",
        input: { id: item.id, query: item.query, action: item.action }
      };
    case "todo_list":
      return {
        name: "update_plan",
        input: { items: item.items ?? [] }
      };
    default:
      return null;
  }
}
function commandExecutionOutput(item) {
  const output = asString(item.aggregated_output);
  const exitCode = item.exit_code;
  if (output !== "") {
    return output;
  }
  return jsonForDisplay({ status: item.status, exit_code: exitCode });
}
function mcpToolOutput(item) {
  if (isRecord(item.error)) {
    return asString(item.error.message, jsonForDisplay(item.error));
  }
  if (item.result !== void 0) {
    return jsonForDisplay(item.result);
  }
  return jsonForDisplay({ status: item.status });
}
function collabToolName(tool) {
  switch (tool) {
    case "spawn_agent":
      return "spawn_agent";
    case "send_input":
      return "send_input";
    case "wait":
      return "wait_agent";
    case "close_agent":
      return "close_agent";
    default:
      return `collab__${tool}`;
  }
}
function normalizeToolInput(value) {
  if (isRecord(value)) {
    return value;
  }
  return { arguments: value };
}
function isFailedStatus(status) {
  return status === "failed" || status === "declined" || status === "error";
}
function jsonForDisplay(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function asNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function translateEvent(event) {
  const type = event.type;
  switch (type) {
    case "response.output_text.delta": {
      const delta = event.delta;
      return typeof delta === "string" && delta !== "" ? { type: "text_delta", text: delta } : null;
    }
    case "response.reasoning_summary_text.delta":
    case "response.reasoning_text.delta": {
      const delta = event.delta;
      return typeof delta === "string" && delta !== "" ? { type: "thinking_delta", text: delta } : null;
    }
    case "response.completed": {
      const response = event.response;
      const usage = response?.usage;
      if (usage) {
        const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
        const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
        return { type: "usage", inputTokens, outputTokens };
      }
      return null;
    }
    default:
      return null;
  }
}
export {
  createOpenAISession
};
//# sourceMappingURL=openai-PM43ACSB.js.map