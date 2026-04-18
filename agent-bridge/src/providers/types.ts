/**
 * Provider abstraction for the agent bridge.
 *
 * Both Anthropic (wrapping the existing OrbitAgent / @anthropic-ai/claude-agent-sdk)
 * and OpenAI (using the `openai` npm package) implement this interface. The shape
 * is deliberately close to what @anthropic-ai/claude-agent-sdk emits so the
 * existing StreamManager + stdout event wiring doesn't need to change.
 */

import type { AttachmentContentBlock } from '../messages.js';

/**
 * Internal event shape emitted by a ProviderSession's async iterator.
 *
 * Values here are the _already-normalized_ shapes the downstream pipeline
 * (session-manager.ts, stdout emitter) expects.
 */
export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolCallId: string; output: string }
  | {
      type: 'usage';
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    }
  | { type: 'done'; stopReason: string; totalCostUsd?: number; durationMs?: number };

/**
 * Credentials passed from Rust to the sidecar via `create_session`.
 *
 * When absent (e.g. legacy callers), the Anthropic adapter falls back to
 * resolving credentials itself via `ClaudeCredentials.getCredentials()`.
 * The OpenAI adapter REQUIRES credentials in this shape — there is no
 * fallback resolver for OpenAI in the sidecar.
 */
export type SessionCredentials =
  | { kind: 'oauth'; token: string; accountId?: string }
  | { kind: 'api_key'; token: string };

/**
 * Contract implemented by both providers.
 *
 * Lifecycle:
 *   const session = await createProviderSession(...);
 *   session.sendMessage("hello", undefined);
 *   for await (const ev of session.receiveResponse()) { ... }
 *   await session.close();
 */
export interface ProviderSession {
  /** Provider identity for logging / debugging. */
  readonly provider: 'anthropic' | 'openai';

  /** Queue a user message (with optional attachments). Non-blocking. */
  sendMessage(text: string, attachments?: AttachmentContentBlock[]): void;

  /** Async iterator over events emitted by the provider. Drains until done. */
  receiveResponse(): AsyncIterable<ProviderEvent>;

  /** Interrupt an in-flight response. Idempotent. */
  interrupt(): Promise<void>;

  /** Dispose resources. Idempotent. */
  close(): Promise<void>;
}
