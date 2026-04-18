# Plan 3: Agent-Bridge Provider Dispatch (OpenAI Chat Routing)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user selects an OpenAI model and sends a chat message, route it to OpenAI's Responses API instead of Anthropic's SDK. Anthropic sessions keep working exactly as they do today.

**Architecture:** The existing sidecar (`agent-bridge/src/`) is deeply coupled to `@anthropic-ai/claude-agent-sdk`. Rather than rewrite it, we add a thin `ProviderSession` interface and two adapters: `anthropic.ts` wraps the existing `OrbitAgent` unchanged in behavior, and `openai.ts` is a new minimal adapter using the `openai` npm package. `SessionManager.createSession` dispatches based on a new `provider` field in `SessionConfig`. The Rust side resolves the active provider + credentials from `ProviderAuthState` and passes both across the stdin JSON protocol.

**Tech Stack:** TypeScript (`agent-bridge`), `openai` (v5.x), existing `@anthropic-ai/claude-agent-sdk`; Rust (`solo-desktop` Tauri commands, `solo-auth` credentials); Tauri IPC; OpenAI Responses API (streaming SSE).

## v1 Scope — What This Plan Delivers

- ✅ Text-only chat with OpenAI (`gpt-5.4-low`, `gpt-5.4-medium`, `gpt-5.4-extra-high`) through ChatGPT OAuth or API key.
- ✅ Streaming text deltas surfaced as `text` messages, identical shape to Anthropic's today.
- ✅ Reasoning/thinking tokens surfaced as `thinking` messages (when the model supports them).
- ✅ Anthropic sessions untouched — no regression.

## v1 Limitations (deferred to a follow-up plan)

- ❌ **No tool calls on OpenAI sessions.** The model is invoked with `tools: []` — it cannot read files, run commands, or use any Solo tools. The UX should convey this somehow (Plan 4 UI work) but the runtime just won't surface tool_use events.
- ❌ **No MCP support on OpenAI.**
- ❌ **Commit-message / session-title / refine-transcript utilities stay Anthropic-only.** The `agent_commands.rs` hardcoded sites remain — a later plan will generalize them. This does NOT block chat routing.
- ❌ **No cross-provider session resumption.** Switching providers mid-session requires the user to start a new chat.

These limitations must be clearly flagged in the UI by Plan 4. Until then, users who pick an OpenAI model will get text-only chat and will hit "I can't use tools" if they ask for file edits.

---

## File Structure

**New files:**
- `agent-bridge/src/providers/types.ts` — `ProviderSession` interface + `ProviderEvent` discriminated union.
- `agent-bridge/src/providers/anthropic.ts` — thin adapter wrapping existing `OrbitAgent`.
- `agent-bridge/src/providers/openai.ts` — new minimal text-only adapter.

**Modified files:**
- `agent-bridge/package.json` — add `openai` dependency.
- `agent-bridge/src/session-manager.ts` — extend `SessionConfig` with `provider`/`credentials`; dispatch in `createSession`; replace internal `OrbitAgent` usage with `ProviderSession`.
- `agent-bridge/src/protocol.ts` — no change (protocol already carries `config: SessionConfig`; new fields ride inside).
- `apps/desktop/src-tauri/src/agent/protocol.rs` — add `provider` and `credentials` fields to Rust `SessionConfig`.
- `apps/desktop/src-tauri/src/agent_commands.rs` — `agent_create_session` resolves provider/credentials from `ProviderAuthState` and fills them into the config before forwarding.

**Unchanged:**
- Frontend: no changes (ModelPicker already passes `model` through; that's sufficient for v1). Plan 4 will add the UX polish.
- `agent-bridge/src/agent.ts` (the `OrbitAgent` class) — stays as-is; `providers/anthropic.ts` just wraps it.
- All `*Store.ts`, `*Panel.tsx`, etc.

---

## Task 1: Define the internal `ProviderSession` interface

Create a minimal contract that both adapters will implement. Keep it Anthropic-shaped internally because the existing `StreamManager`, `PermissionManager`, and stdout event emitter are all built for that shape — matching the existing internal contract costs us nothing.

**Files:**
- Create: `agent-bridge/src/providers/types.ts`

- [ ] **Step 1: Create the file with the interface and event type**

```typescript
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
```

- [ ] **Step 2: Confirm it compiles (no implementation yet — just types)**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth/agent-bridge
bun run build 2>&1 | tail -5
```

Expected: clean typecheck. No emit files change outside `dist/providers/types.js`.

- [ ] **Step 3: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
git add agent-bridge/src/providers/types.ts
git commit -m "feat(agent-bridge): ProviderSession interface + event shape

Defines the internal contract both Anthropic and OpenAI adapters will
implement. Shape is deliberately Anthropic-like so the existing
StreamManager and stdout event emitter don't need to change."
```

No Claude attribution. No `--no-verify`.

---

## Task 2: Extend `SessionConfig` with `provider` and `credentials` (Rust + TS)

Both sides need new optional fields. Keep them optional so existing callers compile and behave unchanged. The TypeScript side is authoritative for what ships on the wire; the Rust side must serialize to the same camelCase names.

**Files:**
- Modify: `apps/desktop/src-tauri/src/agent/protocol.rs` — Rust `SessionConfig`.
- Modify: `agent-bridge/src/session-manager.ts` — TS `SessionConfig`.

- [ ] **Step 1: Add the Rust side types**

Open `apps/desktop/src-tauri/src/agent/protocol.rs`. Find the `SessionConfig` struct (around line 60). Add new fields at the end, just before the closing brace:

```rust
    /// Provider for this session. When absent, defaults to "anthropic" —
    /// preserves backward-compat with clients that don't know about multi-provider.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,

    /// Credentials passed explicitly from Rust to the sidecar. When absent,
    /// the Anthropic adapter falls back to reading ~/.claude/.credentials.json
    /// or ANTHROPIC_API_KEY. The OpenAI adapter REQUIRES this field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credentials: Option<SessionCredentials>,
```

Above the `SessionConfig` struct (or in a logical place in the file), add the new `SessionCredentials` type:

```rust
/// Credentials handed to the sidecar for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SessionCredentials {
    #[serde(rename = "oauth")]
    OAuth {
        token: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        account_id: Option<String>,
    },
    #[serde(rename = "api_key")]
    ApiKey { token: String },
}
```

- [ ] **Step 2: Add the TypeScript side types**

Open `agent-bridge/src/session-manager.ts`. Find the `SessionConfig` interface (around line 87). Add two new optional fields:

```typescript
  /**
   * Provider for this session. When absent, defaults to 'anthropic'.
   */
  provider?: 'anthropic' | 'openai';

  /**
   * Credentials handed from Rust. When absent, the Anthropic adapter falls
   * back to ClaudeCredentials.getCredentials(). The OpenAI adapter errors
   * if this is missing.
   */
  credentials?:
    | { kind: 'oauth'; token: string; accountId?: string }
    | { kind: 'api_key'; token: string };
```

- [ ] **Step 3: Confirm both sides compile**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
cargo check -p solo-desktop 2>&1 | tail -10 || echo "expected to fail if dist/ is absent"
mkdir -p apps/desktop/dist && touch apps/desktop/dist/index.html
cargo check -p solo-desktop 2>&1 | tail -10
rm -rf apps/desktop/dist
git checkout -- apps/desktop/src-tauri/gen/ 2>/dev/null || true
cd agent-bridge && bun run build 2>&1 | tail -5
cd ..
```

Expected: Rust and TS both compile cleanly. No runtime behavior has changed yet — we only added optional fields.

- [ ] **Step 4: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
git add apps/desktop/src-tauri/src/agent/protocol.rs \
        agent-bridge/src/session-manager.ts
git commit -m "feat(solo-desktop,agent-bridge): SessionConfig gains provider + credentials

Both optional for backward compatibility. Runtime semantics unchanged —
existing callers continue to work. Sidecar dispatch logic comes in the
next commits."
```

---

## Task 3: Wrap existing Anthropic logic behind `ProviderSession`

Create `agent-bridge/src/providers/anthropic.ts` as a thin adapter that delegates to `OrbitAgent` (the existing implementation in `agent.ts`). No behavior change — this is pure refactoring that gives us a symmetric provider interface.

The existing `OrbitAgent` is complex and battle-tested. We do NOT rewrite it. We write a wrapper that delegates everything.

**Files:**
- Create: `agent-bridge/src/providers/anthropic.ts`

- [ ] **Step 1: Inspect the existing OrbitAgent shape**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
grep -n 'class OrbitAgent\|async sendMessage\|async interrupt\|async close\|async \*receiveResponse\|receiveResponse()' agent-bridge/src/agent.ts | head -20
```

Note the method names — they're what the wrapper will forward to.

- [ ] **Step 2: Create the adapter**

Create `agent-bridge/src/providers/anthropic.ts`:

```typescript
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
  // reads ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN from the env).
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
  await agent.init();

  const session: ProviderSession = {
    provider: 'anthropic',

    sendMessage(text: string, attachments?: AttachmentContentBlock[]): void {
      agent.sendMessage(text, attachments);
    },

    async *receiveResponse(): AsyncIterable<ProviderEvent> {
      // OrbitAgent exposes an async iterator over SDK messages. We don't
      // translate them here because the existing session-manager already
      // expects the SDK shape. Instead, we yield a synthetic `done` event
      // when the iterator drains.
      //
      // IMPORTANT: this adapter is used from session-manager via a special
      // path that still talks directly to OrbitAgent. The generic
      // `receiveResponse()` contract here is only what the OpenAI adapter
      // needs; the Anthropic path in session-manager bypasses it.
      //
      // We implement it anyway for symmetry / future use.
      for await (const raw of agent.receiveResponse()) {
        // Minimal projection — the session-manager uses OrbitAgent's raw
        // shape directly. This projection exists only if some future caller
        // wants a normalized view.
        void raw;
      }
      yield { type: 'done', stopReason: 'end_turn' };
    },

    async interrupt(): Promise<void> {
      await agent.interrupt();
    },

    async close(): Promise<void> {
      await agent.close();
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
```

**Note on design:** this adapter is a "transparent wrapper" — the session-manager during the Anthropic path pulls the underlying `OrbitAgent` back out via `getOrbitAgent()` and talks to it directly. We don't rewrite the Anthropic flow to go through `ProviderEvent` because that would force us to rewrite the entire `StreamManager` (out of scope). The wrapper exists so `createSession()` has a single entry point that returns a `ProviderSession`, and the OpenAI path can genuinely use the iterator. This is a pragmatic trade-off.

- [ ] **Step 3: Confirm it compiles**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth/agent-bridge
bun run build 2>&1 | tail -5
```

Expected: clean typecheck.

- [ ] **Step 4: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
git add agent-bridge/src/providers/anthropic.ts
git commit -m "feat(agent-bridge): Anthropic adapter wrapping OrbitAgent

Thin wrapper providing the ProviderSession interface. The existing
Anthropic execution path in session-manager pulls the OrbitAgent back
out via getOrbitAgent() helper rather than going through the iterator —
the iterator contract exists primarily so OpenAI sessions have a
symmetric entry point."
```

---

## Task 4: Add the `openai` npm package

Small standalone task — install the dependency and regenerate the lockfile.

**Files:**
- Modify: `agent-bridge/package.json`
- Modify: `bun.lock` (workspace root)

- [ ] **Step 1: Install the package**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth/agent-bridge
bun add openai@^5.0.0
cd ..
```

- [ ] **Step 2: Verify the install**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
grep -A 2 '"openai"' agent-bridge/package.json
```

Expected: `"openai": "^5.x.x"` (or similar) in the `dependencies` block.

- [ ] **Step 3: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
git add agent-bridge/package.json bun.lock
git commit -m "chore(agent-bridge): add openai dependency"
```

---

## Task 5: Implement the OpenAI text-only adapter

This is the meaty task. Create `agent-bridge/src/providers/openai.ts` with a minimal adapter that:
- Uses OpenAI's Responses API (`client.responses.create({ stream: true })`).
- Switches base URL based on credential kind (ChatGPT OAuth → `chatgpt.com/backend-api/codex`, API key → `api.openai.com/v1`).
- Adds `chatgpt-account-id` header when using OAuth.
- Streams `response.output_text.delta` events as `text_delta`.
- Streams `response.reasoning_summary_text.delta` (or similar — verify against API) as `thinking_delta`.
- Does NOT handle tool calls (v1 limitation).

**Files:**
- Create: `agent-bridge/src/providers/openai.ts`

- [ ] **Step 1: Create the adapter file with imports and types**

Create `agent-bridge/src/providers/openai.ts` with this initial scaffold. We'll fill in the body in Step 2.

```typescript
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
 *
 * See Plan 3 spec §5.8 for the full dispatch contract.
 */

import OpenAI from 'openai';

import { createLogger } from '../logger.js';

import type { ResponseStreamEvent } from 'openai/resources/responses/responses.js';
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

  // Build the OpenAI client with the right base URL and auth.
  const client = buildClient(credentials);

  // Pending user input, flushed when receiveResponse() is called.
  // The OpenAI Responses API is request/response per turn (not a persistent
  // socket), so we buffer the latest message and send it on drain.
  let pendingUserText: string | null = null;
  let currentStream: AsyncIterable<ResponseStreamEvent> | null = null;
  let abortController: AbortController | null = null;
  let closed = false;

  const session: ProviderSession = {
    provider: 'openai',

    sendMessage(text: string, _attachments?: AttachmentContentBlock[]): void {
      // v1: attachments are silently dropped. Plan 4 UX should communicate this.
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
        const requestBody: Parameters<typeof client.responses.create>[0] = {
          model,
          input: userText,
          stream: true,
          // v1: no tools.
          tools: [],
        };

        if (maxTokens !== undefined) {
          // @ts-expect-error — Responses API's max_output_tokens field name
          // may drift; accept the SDK's typed slot.
          requestBody.max_output_tokens = maxTokens;
        }

        if (thinkingEnabled === true) {
          // @ts-expect-error — the reasoning field is model-specific; tolerate
          // SDK typing variance. Models that don't support it will ignore it.
          requestBody.reasoning = { effort: 'medium' };
        }

        currentStream = (await client.responses.create(
          requestBody as Parameters<typeof client.responses.create>[0]
        )) as unknown as AsyncIterable<ResponseStreamEvent>;

        let inputTokens = 0;
        let outputTokens = 0;

        for await (const event of currentStream) {
          if (abortController?.signal.aborted) {
            yield { type: 'done', stopReason: 'interrupted' };
            return;
          }
          const ev = translateEvent(event);
          if (ev) {
            if (ev.type === 'usage') {
              inputTokens = ev.inputTokens;
              outputTokens = ev.outputTokens;
            }
            yield ev;
          }
        }

        // Most SSE streams already end with a final `response.completed`
        // event that translateEvent renders as `done`. If we fall through,
        // emit a synthetic done.
        yield {
          type: 'done',
          stopReason: 'end_turn',
          totalCostUsd: undefined, // v1: no cost calculation
          durationMs: undefined,
        };
        void inputTokens;
        void outputTokens;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, 'OpenAI Responses API error');
        throw err;
      } finally {
        currentStream = null;
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
      currentStream = null;
    },
  };

  return session;
}

function buildClient(credentials: SessionCredentials): OpenAI {
  const defaultHeaders: Record<string, string> = {};

  switch (credentials.kind) {
    case 'oauth':
      if (credentials.accountId) {
        defaultHeaders['chatgpt-account-id'] = credentials.accountId;
      }
      return new OpenAI({
        apiKey: credentials.token,
        baseURL: CHATGPT_BASE_URL,
        defaultHeaders,
      });
    case 'api_key':
      return new OpenAI({
        apiKey: credentials.token,
        baseURL: API_BASE_URL,
      });
  }
}

/**
 * Translate an OpenAI Responses API SSE event into an internal ProviderEvent.
 * Returns null for events we don't surface (e.g. response.created, response.in_progress).
 */
function translateEvent(event: ResponseStreamEvent): ProviderEvent | null {
  // Response stream event shape: { type: "response.output_text.delta", delta: "...", ... }
  // Reference: https://platform.openai.com/docs/api-reference/responses-streaming
  const evAny = event as unknown as Record<string, unknown>;
  const type = evAny.type as string | undefined;

  switch (type) {
    case 'response.output_text.delta': {
      const delta = evAny.delta as string | undefined;
      return typeof delta === 'string' && delta !== ''
        ? { type: 'text_delta', text: delta }
        : null;
    }
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta': {
      const delta = evAny.delta as string | undefined;
      return typeof delta === 'string' && delta !== ''
        ? { type: 'thinking_delta', text: delta }
        : null;
    }
    case 'response.completed': {
      const response = evAny.response as Record<string, unknown> | undefined;
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
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth/agent-bridge
bun run build 2>&1 | tail -15
```

Expected: clean typecheck. If you see errors about `ResponseStreamEvent` — that's the canonical type from `openai/resources/responses/responses`. The import path may drift across openai SDK versions. If the import fails, replace it with `any` as a fallback:

```typescript
type ResponseStreamEvent = Record<string, unknown>;
```

(And drop the `openai/resources/responses/responses.js` import line.) The `translateEvent` function already defensively casts to `Record<string, unknown>`, so runtime behavior is unchanged.

- [ ] **Step 3: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
git add agent-bridge/src/providers/openai.ts
git commit -m "feat(agent-bridge): OpenAI text-only provider adapter

Implements ProviderSession using OpenAI's Responses API with streaming.
Switches base URL and headers based on credential kind (ChatGPT OAuth
vs API key). v1 is text-only — tools are not registered; attachments
are silently dropped. translateEvent maps response.output_text.delta
to text_delta and reasoning deltas to thinking_delta. Limitations are
documented in the module doc."
```

---

## Task 6: Dispatch in SessionManager

Wire the two adapters into `SessionManager.createSession`. When `config.provider === 'openai'`, build an OpenAI session; otherwise (`'anthropic'` or absent), build an Anthropic session. For Anthropic, keep all the existing code paths — we just wrap the OrbitAgent in the adapter so the stored session has a uniform handle.

**Files:**
- Modify: `agent-bridge/src/session-manager.ts`

- [ ] **Step 1: Locate the existing createSession logic**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
grep -n 'async createSession\|new OrbitAgent\|OrbitAgent(\|class SessionManager' agent-bridge/src/session-manager.ts | head -10
```

Read the existing `createSession` method — it constructs an `OrbitAgent`, stores it in `this.sessions`, and wires up the stream loop.

- [ ] **Step 2: Add OpenAI-specific stream loop**

The Anthropic path is complex and continues to use the raw `OrbitAgent` API. The OpenAI path is simpler: we drive it through the `ProviderSession.receiveResponse()` iterator and emit `AgentMessage` events directly. Add this helper method to the `SessionManager` class (near the bottom, before `dispose()`):

```typescript
  /**
   * Drive an OpenAI session's receiveResponse() loop and emit AgentMessage
   * events to the stdout emitter. Much simpler than the Anthropic path —
   * no tool calls, no permissions, no hooks.
   */
  private async runOpenAILoop(
    sessionId: string,
    session: import('./providers/types.js').ProviderSession
  ): Promise<void> {
    try {
      for await (const ev of session.receiveResponse()) {
        switch (ev.type) {
          case 'text_delta':
            this.agentMessageEmitter.emit({
              sessionId,
              message: { type: 'text', content: ev.text },
            });
            break;
          case 'thinking_delta':
            this.agentMessageEmitter.emit({
              sessionId,
              message: { type: 'thinking', content: ev.text },
            });
            break;
          case 'usage':
            this.agentMessageEmitter.emit({
              sessionId,
              message: {
                type: 'text',
                content: '',
                usage: {
                  inputTokens: ev.inputTokens,
                  outputTokens: ev.outputTokens,
                },
              },
            });
            break;
          case 'done':
            this.agentMessageEmitter.emit({
              sessionId,
              message: {
                type: 'result',
                content: '',
                resultSubtype: ev.stopReason,
                totalCostUsd: ev.totalCostUsd,
                durationMs: ev.durationMs,
              },
            });
            break;
          // v1 doesn't emit tool_call / tool_result from OpenAI.
          default:
            break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.agentMessageEmitter.emit({
        sessionId,
        message: { type: 'error', content: msg },
      });
    }
  }
```

(Adjust the `this.agentMessageEmitter.emit(...)` shape to match what SessionManager actually uses — check `grep -n 'agentMessageEmitter\|onAgentMessage' agent-bridge/src/session-manager.ts` to see the exact method names. If the emitter uses a different name like `emitAgentMessage`, use that.)

- [ ] **Step 3: Add a dispatch branch in createSession**

Find the existing `async createSession(sessionId: string, config?: SessionConfig): Promise<void>` method. Near the top of its body (after any initial argument validation), add a provider check:

```typescript
    const provider = config?.provider ?? 'anthropic';

    if (provider === 'openai') {
      if (!config?.credentials) {
        throw new Error(
          'OpenAI session requires credentials — Rust side must pass them via SessionConfig.credentials'
        );
      }
      if (!config?.model) {
        throw new Error('OpenAI session requires a model');
      }

      const { createOpenAISession } = await import('./providers/openai.js');
      const openaiSession = await createOpenAISession({
        model: config.model,
        credentials: config.credentials,
        maxTokens: config.maxTokens,
        thinkingEnabled: config.thinkingEnabled,
      });

      // Store under the same map the Anthropic path uses, tagged so
      // downstream methods can branch.
      this.openAISessions.set(sessionId, openaiSession);

      // Session init — reuse the existing event for parity.
      this.sessionInitEmitter.emit({
        sessionId,
        sdkSessionId: sessionId, // no separate SDK id for OpenAI
        isResumed: false,
        isForked: false,
      });
      return;
    }

    // ... existing Anthropic path continues unchanged below ...
```

Add a new field to the `SessionManager` class at the top:

```typescript
  private readonly openAISessions = new Map<string, import('./providers/types.js').ProviderSession>();
```

- [ ] **Step 4: Add OpenAI dispatch to `sendMessage` and `deleteSession`**

Find `async sendMessage(sessionId: string, text: string, attachments?: ...)`. At the top of the method, add:

```typescript
    const openaiSession = this.openAISessions.get(sessionId);
    if (openaiSession) {
      openaiSession.sendMessage(text, attachments);
      // Fire the run loop without awaiting — it emits events as it streams.
      void this.runOpenAILoop(sessionId, openaiSession);
      return;
    }

    // ... existing Anthropic path unchanged ...
```

Find `async deleteSession(sessionId: string)`. At the top:

```typescript
    const openaiSession = this.openAISessions.get(sessionId);
    if (openaiSession) {
      await openaiSession.close();
      this.openAISessions.delete(sessionId);
      return;
    }

    // ... existing Anthropic path unchanged ...
```

Do the same for `interrupt(sessionId: string)`:

```typescript
    const openaiSession = this.openAISessions.get(sessionId);
    if (openaiSession) {
      await openaiSession.interrupt();
      return;
    }

    // ... existing Anthropic path unchanged ...
```

For other methods (`setThinkingMode`, `setModel`, `setPlanMode`, `setAcceptMode`, etc.), if the sessionId is in `openAISessions`, silently return / log a warning — v1 doesn't support those on OpenAI:

```typescript
    if (this.openAISessions.has(sessionId)) {
      logger.warn({ sessionId, method: 'setThinkingMode' }, 'not supported on OpenAI sessions');
      return;
    }
```

(Apply the same pattern to `setModel`, `setPlanMode`, `setAcceptMode`, `setDebugMode`, `setToolPolicy`, `isSessionReady` (return true if OpenAI session exists), `getSDKSessionId` (return sessionId as-is).)

- [ ] **Step 5: Typecheck**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth/agent-bridge
bun run build 2>&1 | tail -20
```

Fix any compile errors. Expected issues:
- Emitter method names may differ (`emit` vs `notify` vs similar) — match what the file actually uses.
- The field `sessionInitEmitter` may have a different name.

Resolve by grepping the existing file for the actual method names. Do NOT rename existing fields.

- [ ] **Step 6: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
git add agent-bridge/src/session-manager.ts
git commit -m "feat(agent-bridge): dispatch OpenAI sessions in SessionManager

createSession branches on config.provider. OpenAI sessions live in a
parallel openAISessions map; sendMessage/deleteSession/interrupt all
check both maps and dispatch accordingly. Anthropic path is unchanged.

Methods that don't apply to OpenAI (setThinkingMode, setPlanMode, ...)
log a warning and return early — v1 limitation."
```

---

## Task 7: Rust side — resolve provider + credentials in `agent_create_session`

When the frontend calls `agent_create_session`, the Rust side must now look at the active provider / model / profile, resolve the credential, and push everything into the `SessionConfig` before forwarding to the sidecar.

**Files:**
- Modify: `apps/desktop/src-tauri/src/agent_commands.rs`

- [ ] **Step 1: Extend `agent_create_session` signature + body**

Find the existing `agent_create_session` (around line 36). Add a `provider_state` arg so we can read the active provider. Replace the whole function:

```rust
/// Create a new agent session.
///
/// Resolves the active provider + credentials from ProviderAuthState and
/// attaches them to the SessionConfig before forwarding to the sidecar.
/// Backward-compatible: if the caller passed provider/credentials in
/// `config` already, those take precedence.
#[tauri::command]
pub async fn agent_create_session(
    session_id: String,
    config: Option<SessionConfig>,
    state: State<'_, Arc<SessionManager>>,
    provider_state: State<'_, ProviderAuthState>,
    stats: State<'_, crate::stats_commands::StatsState>,
) -> Result<()> {
    let mut config = config.unwrap_or_default();

    // If the caller didn't specify a provider, use the currently-active one.
    if config.provider.is_none() {
        let active = provider_state.active_provider.read().await;
        config.provider = Some(active.as_str().to_string());
    }

    // Resolve credentials iff the caller didn't already pass them.
    if config.credentials.is_none() {
        let provider_str = config.provider.as_deref().unwrap_or("anthropic");
        let provider_type = ProviderType::from_str(provider_str)
            .ok_or_else(|| format!("unknown provider {:?}", provider_str))?;

        match provider_type {
            ProviderType::OpenAI => {
                // Prefer OAuth, fall back to API key, fall back to env.
                let resolved = provider_state
                    .credentials
                    .get_credentials_with_source(provider_type)
                    .await
                    .map_err(to_error)?;

                if let Some(info) = resolved {
                    // Determine if it's an OAuth token (SoloOAuth source) or an API key.
                    use solo_auth::credentials::CredentialSource as CS;
                    let account_id = provider_state
                        .credentials
                        .get_openai_account_id()
                        .await
                        .map_err(to_error)?;

                    config.credentials = Some(match info.source {
                        CS::SoloOAuth => crate::agent::SessionCredentials::OAuth {
                            token: info.api_key,
                            account_id,
                        },
                        _ => crate::agent::SessionCredentials::ApiKey { token: info.api_key },
                    });
                } else {
                    return Err(format!(
                        "No credentials configured for {}",
                        provider_type.as_str()
                    ));
                }
            }
            ProviderType::Anthropic => {
                // For Anthropic we leave credentials unset — the sidecar
                // has its own ClaudeCredentials resolver (file, keychain,
                // env) that works well and we don't want to break it.
            }
            ProviderType::Gemini | ProviderType::ElevenLabs => {
                return Err(format!(
                    "{} is not supported by the chat agent",
                    provider_type.as_str()
                ));
            }
        }
    }

    state.create_session(&session_id, Some(config)).map_err(to_error)?;
    stats.record(solo_stats::StatsEvent::SessionCreated).await;
    Ok(())
}
```

- [ ] **Step 2: Fix the import of `SessionCredentials`**

At the top of the file, add `SessionCredentials` to the existing `use crate::agent::{...}` import block:

```rust
use crate::agent::{
    AttachmentContentBlock, PermissionDecision, PermissionResponse, SessionConfig,
    SessionCredentials, SessionManager,
};
```

- [ ] **Step 3: Re-export `SessionCredentials` from the agent module**

Open `apps/desktop/src-tauri/src/agent/mod.rs`. Add `SessionCredentials` to whatever `pub use ...::{...}` block already re-exports `SessionConfig`. If you can't find such a re-export, add:

```rust
pub use protocol::{SessionConfig, SessionCredentials};
```

- [ ] **Step 4: Compile**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
mkdir -p apps/desktop/dist && touch apps/desktop/dist/index.html
cargo check -p solo-desktop 2>&1 | tail -15
rm -rf apps/desktop/dist
git checkout -- apps/desktop/src-tauri/gen/ 2>/dev/null || true
```

Expected: clean compile (pre-existing dead_code warnings in `solo-embeddings` are unrelated).

- [ ] **Step 5: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
git add apps/desktop/src-tauri/src/agent_commands.rs \
        apps/desktop/src-tauri/src/agent/mod.rs
git commit -m "feat(solo-desktop): agent_create_session resolves provider+credentials

When the frontend creates a session without specifying provider or
credentials, the Rust side reads the active provider from
ProviderAuthState, resolves the credential (OAuth preferred for
OpenAI), and attaches both to the SessionConfig before forwarding to
the sidecar. Backward-compatible — callers that pre-fill the config
are untouched. Anthropic sessions still rely on the sidecar's own
credential resolver (file → keychain → env)."
```

---

## Task 8: Manual smoke test — chat with both providers

Human-gated. Prove the routing works end-to-end against real APIs.

**Prerequisites:**
- ChatGPT Plus/Pro OAuth already signed in (from Plan 2's smoke test).
- Solo dev mode running from the worktree.

- [ ] **Step 1: Launch Solo from the worktree**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
bun run dev
```

Hard refresh the window (⌘R) once the dev server is ready so the updated frontend and sidecar are both loaded.

- [ ] **Step 2: Confirm Anthropic still works**

- Open a chat, send "Hello". Expect a streamed Claude response exactly as before.
- Try a tool-heavy prompt: "Read README.md and summarize it." Expect the file read + summary to happen as before.

If either regresses, stop — Plan 3 broke Anthropic and must be fixed before OpenAI.

- [ ] **Step 3: Switch to an OpenAI model**

- In the chat header (or wherever the model picker lives), pick `gpt-5.4-medium`.
- Send "Hello." Expect:
  - A streamed text response from OpenAI (visibly shorter / different tone than Claude).
  - No errors in the dev terminal about missing credentials.
  - Network tab in DevTools shows a request to `chatgpt.com/backend-api/codex/responses` (if OAuth) or `api.openai.com/v1/responses` (if API key).

- [ ] **Step 4: Confirm the expected v1 limitation**

- Send "Read README.md and summarize it." Expect: the model responds in text but does NOT actually read any file — it will make things up or say it can't see files. This proves the v1 "no tools on OpenAI" limitation is working as designed. (Plan 4 adds UX to warn the user before they hit this.)

- [ ] **Step 5: Switch back to Anthropic mid-session**

- Switch the model back to `claude-sonnet-4-6`.
- Send "Now read README.md." Expect: Claude correctly reads the file. Anthropic path is still intact.

- [ ] **Step 6: Report**

If all steps pass → Plan 3 complete. If chat breaks on either provider or the routing silently falls back to Anthropic, paste the error and terminal logs for triage.

---

## Plan 3 complete — what's shipped

At the end of Plan 3:
- OpenAI chat works for `gpt-5.4-*` models via Responses API streaming.
- Anthropic chat is untouched — no regression.
- Rust auto-resolves provider + credentials at `create_session` time based on the active provider.
- The sidecar has a `ProviderSession` abstraction, so adding a third provider later is additive.

**Remaining gaps (Plan 4 or beyond):**
- UI warns users that OpenAI = text-only (no file reads, no tools) — Plan 4.
- Grouped model picker, multi-account rows, dual-provider onboarding — Plan 4.
- Tool calling on OpenAI (would require a new plan — it's a substantial chunk of work).
- Commit-message / session-title / refine-transcript generalized across providers — can be a small follow-up plan.
