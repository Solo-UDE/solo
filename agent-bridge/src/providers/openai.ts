/**
 * OpenAI provider adapter (v1: text-only, no tools).
 *
 * Uses OpenAI's Responses API with streaming. Two auth modes:
 *   - OAuth (ChatGPT Plus/Pro): base URL = https://chatgpt.com/backend-api/codex,
 *     plus `chatgpt-account-id` header.
 *   - API key: base URL = https://api.openai.com/v1, no special headers.
 *
 * v1 limitations:
 *   - No tool calls — `tools: []` is sent, so the model can't invoke any
 *     Solo tools. File reads, bash commands, edits won't work.
 *   - No MCP support.
 *   - No session resumption — each createOpenAISession is a fresh session.
 *   - Attachments on sendMessage are silently dropped.
 *
 * See Plan 3 spec for the full dispatch contract.
 */

import OpenAI from 'openai';

import { createLogger } from '../logger.js';

import type { AttachmentContentBlock } from '../messages.js';
import type { ProviderEvent, ProviderSession, SessionCredentials } from './types.js';

const logger = createLogger('OpenAIAdapter');

export interface OpenAIAdapterOptions {
  /** Model alias — e.g. "gpt-5.4-medium". */
  model: string;
  /** Credentials resolved by Rust and passed across the wire. Required. */
  credentials: SessionCredentials;
  /** Optional max output tokens. Defaults to no cap (model-level default). */
  maxTokens?: number;
  /** Optional: enable reasoning/thinking for models that support it. */
  thinkingEnabled?: boolean;
}

const CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const API_BASE_URL = 'https://api.openai.com/v1';

export async function createOpenAISession(
  opts: OpenAIAdapterOptions
): Promise<ProviderSession> {
  const { model, credentials, maxTokens, thinkingEnabled } = opts;

  const client = buildClient(credentials);

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
        const requestBody: Record<string, unknown> = {
          model,
          input: userText,
          stream: true,
          tools: [],
        };
        if (maxTokens !== undefined) {
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

function buildClient(credentials: SessionCredentials): OpenAI {
  switch (credentials.kind) {
    case 'oauth': {
      const defaultHeaders: Record<string, string> = {};
      if (credentials.accountId) {
        defaultHeaders['chatgpt-account-id'] = credentials.accountId;
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
