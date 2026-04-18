/**
 * Anthropic provider adapter.
 *
 * Thin wrapper over the existing OrbitAgent (agent.ts) that exposes the
 * internal ProviderSession contract. Behavior is unchanged from pre-refactor —
 * this file exists solely so the SessionManager can dispatch symmetrically
 * between Anthropic and OpenAI.
 */

import { OrbitAgent } from '../agent.js';

import type { OrbitAgentConfig } from '../agent.js';
import type { AttachmentContentBlock } from '../messages.js';
import type { ProviderEvent, ProviderSession, SessionCredentials } from './types.js';

export interface AnthropicAdapterOptions {
  agentConfig: OrbitAgentConfig;
  /**
   * Credentials from Rust. If absent, OrbitAgent's internal
   * ClaudeCredentials.getCredentials() fallback runs.
   */
  credentials?: SessionCredentials;
}

export async function createAnthropicSession(
  opts: AnthropicAdapterOptions
): Promise<ProviderSession> {
  // When Rust passed explicit credentials, surface them via the environment
  // so the Claude Agent SDK picks them up (the SDK spawns a subprocess that
  // reads ANTHROPIC_API_KEY / the OAuth file from the env).
  if (opts.credentials) {
    switch (opts.credentials.kind) {
      case 'api_key':
        process.env.ANTHROPIC_API_KEY = opts.credentials.token;
        break;
      case 'oauth':
        // Claude Agent SDK reads OAuth tokens from
        // ~/.claude/.credentials.json or the keychain — we don't override
        // here. Leaving ANTHROPIC_API_KEY unset lets the SDK find the OAuth
        // token via its normal resolver. This matches existing behavior.
        break;
    }
  }

  const agent = new OrbitAgent(opts.agentConfig);
  await agent.startSession();

  const session: ProviderSession = {
    provider: 'anthropic',

    sendMessage(text: string, attachments?: AttachmentContentBlock[]): void {
      agent.queueMessage(text, attachments);
    },

    async *receiveResponse(): AsyncIterable<ProviderEvent> {
      // The Anthropic execution path in session-manager talks to OrbitAgent
      // directly (via getOrbitAgent below). This iterator exists for symmetry
      // with OpenAI; it emits nothing and yields a single done event.
      //
      // If some future refactor wants to pipe Anthropic through this
      // interface, translate OrbitAgent's async iterator output here.
      await Promise.resolve();
      yield { type: 'done', stopReason: 'end_turn' };
    },

    async interrupt(): Promise<void> {
      await agent.interrupt();
    },

    async close(): Promise<void> {
      await agent.stopSession();
    },
  };

  // Expose the underlying agent so session-manager can still reach the
  // Anthropic-specific APIs (permissions, hooks) during the Anthropic path.
  Object.defineProperty(session, '__orbitAgent', {
    value: agent,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return session;
}

/**
 * Extract the wrapped OrbitAgent from an Anthropic ProviderSession.
 *
 * The SessionManager uses this to reach the OrbitAgent's Anthropic-specific
 * APIs (permissions, hooks) during the Anthropic execution path. Returns
 * undefined for non-Anthropic sessions.
 */
export function getOrbitAgent(session: ProviderSession): OrbitAgent | undefined {
  if (session.provider !== 'anthropic') return undefined;
  const raw = (session as unknown as { __orbitAgent?: unknown }).__orbitAgent;
  return raw instanceof OrbitAgent ? raw : undefined;
}
