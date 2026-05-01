/**
 * Gemini provider adapter (v1: chat-only, no tools).
 *
 * Uses Google's Generative Language API. This adapter intentionally exposes no
 * tools, MCP, skills, or resume support; Solo's tool-running agent harness is
 * Anthropic-only for v1.
 */

import { createLogger } from '../logger.js';

import type { AttachmentContentBlock } from '../messages.js';
import type { ProviderEvent, ProviderSession, SessionCredentials } from './types.js';

const logger = createLogger('GeminiAdapter');

export interface GeminiAdapterOptions {
  model: string;
  credentials: SessionCredentials;
  maxTokens?: number;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    message?: string;
  };
}

export async function createGeminiSession(opts: GeminiAdapterOptions): Promise<ProviderSession> {
  const { model, credentials, maxTokens } = opts;
  const apiKey = credentialToken(credentials);

  let pendingUserText: string | null = null;
  let abortController: AbortController | null = null;
  let closed = false;

  const session: ProviderSession = {
    provider: 'gemini',

    sendMessage(text: string, _attachments?: AttachmentContentBlock[]): void {
      if (closed) {
        logger.warn('sendMessage called on closed Gemini session — ignoring');
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

      const startedAt = Date.now();
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            model
          )}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            signal: abortController.signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: userText }] }],
              generationConfig:
                maxTokens !== undefined ? { maxOutputTokens: maxTokens } : undefined,
            }),
          }
        );

        const json = (await response.json()) as GeminiResponse;
        if (!response.ok) {
          throw new Error(json.error?.message ?? `Gemini request failed with ${response.status}`);
        }

        const text =
          json.candidates?.[0]?.content?.parts
            ?.map((part) => part.text ?? '')
            .join('') ?? '';
        if (text) {
          yield { type: 'text_delta', text };
        }

        const usage = json.usageMetadata;
        if (usage) {
          yield {
            type: 'usage',
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: usage.candidatesTokenCount ?? 0,
          };
        }

        yield {
          type: 'done',
          stopReason: json.candidates?.[0]?.finishReason ?? 'end_turn',
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        if (abortController?.signal.aborted) {
          yield { type: 'done', stopReason: 'interrupted', durationMs: Date.now() - startedAt };
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, 'Gemini API error');
        throw err;
      } finally {
        abortController = null;
      }
    },

    async interrupt(): Promise<void> {
      abortController?.abort();
    },

    async close(): Promise<void> {
      closed = true;
      abortController?.abort();
    },
  };

  return session;
}

function credentialToken(credentials: SessionCredentials): string {
  if (credentials.kind !== 'api_key') {
    throw new Error('Gemini chat requires an API key credential.');
  }
  return credentials.token;
}
