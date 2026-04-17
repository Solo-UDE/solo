# OpenAI OAuth + Multi-Provider Routing — Design Spec

**Date:** 2026-04-17
**Author:** sa9082@nyu.edu
**Status:** Approved (brainstorm) — pending implementation plan

## 1. Goal

Add OpenAI (ChatGPT) OAuth login to Solo alongside the existing Anthropic OAuth, so that:

1. Users with a ChatGPT subscription can sign in and use OpenAI models in Solo without installing any external CLI.
2. Users who prefer API keys can paste one into Settings for either provider.
3. When a user selects a model in the picker, the request is routed to the correct provider/endpoint with the correct credential.
4. The first-run experience shows both providers as equal peers — the user can sign in with Claude, ChatGPT, or both.
5. Multiple accounts per provider are supported (profile-keyed auth store).

Everything lands in one PR. Three phases — auth, routing, UX — ship together.

## 2. Non-goals

- MCP tool support on OpenAI sessions (deferred; Anthropic-only in v1).
- Cross-provider session resumption — switching providers mid-chat starts a new session.
- Dynamic model discovery via `/v1/models`; model list stays static in `crates/solo-auth/src/models.rs`.
- Proactive plan-based gating of OpenAI models (we accept whatever the ChatGPT backend returns and surface 429s to the UI).
- Windows or Linux parity testing in this round — macOS keychain flow is the bar for v1.

## 3. Context

**What already exists in Solo:**
- `crates/solo-auth/src/models.rs` has placeholder OpenAI model entries (`gpt-5.2-*`).
- `apps/desktop/src/stores/provider-store.ts` is multi-provider-shaped already (`activeProvider`, `providerStatus`, `authMethodInfo`).
- `crates/solo-auth/src/credentials.rs` has vault slots for `openai.oauth` and `openai.apiKey` with partial refresh logic.
- Cognito OAuth for Solo user identity (`apps/desktop/src-tauri/src/auth_commands.rs`) is unrelated to provider auth and stays untouched.

**What blocks OpenAI today:**
- `apps/desktop/src-tauri/src/agent_commands.rs` hardcodes `ProviderType::Anthropic` in three utility commands (commit message generation, transcript refinement, session title generation).
- `agent-bridge/` sidecar is deeply coupled to `@anthropic-ai/claude-agent-sdk` — no provider dispatch, no OpenAI SDK, tool-use harness parses Anthropic's field names (`tool_use_id`, `input`) exclusively.
- No multi-account layer anywhere; vault blobs assume single-token-per-provider.

**Reference implementations consulted:**
- OpenAI Codex CLI (`Inspirations/codex/codex-rs/login/`) — ChatGPT OAuth flow, PKCE, `auth.json` format, JWT parsing, refresh mechanics, `chatgpt-account-id` header usage.
- openclaw (`Inspirations/openclaw/`) — profile-keyed auth store pattern, provider-id normalization, provider transport dispatch.

## 4. Architecture

Four layers change:

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (apps/desktop/src)                             │
│  ┌─ ProvidersPanel ─┐  ┌─ Onboarding ─┐  ┌─ ModelPicker │
│  │ multi-account    │  │ dual-provider│  │ grouped by   │
│  │ rows per provider│  │ first-run    │  │ provider     │
│  └──────────────────┘  └──────────────┘  └──────────────┘
│              ▲                                           │
└──────────────┼───────────────────────────────────────────┘
               │ invoke(provider_*) / listen(backend-event)
┌──────────────┼───────────────────────────────────────────┐
│  Tauri / Rust (apps/desktop/src-tauri + crates/solo-*)   │
│  ┌─ provider_commands.rs (generic over provider)────────┐│
│  │  start_oauth, set_api_key, list_profiles,            ││
│  │  set_active_profile, sign_out, remove_profile        ││
│  └──────────┬───────────────────────────────────────────┘│
│  ┌─ solo-auth/oauth/openai.rs (new) ────────────────────┐│
│  │  PKCE, Hyper callback server, token exchange/refresh ││
│  └──────────┬───────────────────────────────────────────┘│
│  ┌─ solo-auth/credentials.rs (profile-aware) ──────────┐│
│  │  get_credentials(provider, profile?)                ││
│  └──────────┬───────────────────────────────────────────┘│
│             │                                             │
│             ▼ stdin JSON (session.create + credentials)  │
└─────────────┼─────────────────────────────────────────────┘
┌─────────────┼─────────────────────────────────────────────┐
│  agent-bridge (Node sidecar)                              │
│  ┌─ session-manager.ts ─┐                                 │
│  │ provider dispatch    │                                 │
│  └────┬─────────┬───────┘                                 │
│       ▼         ▼                                         │
│  ┌────────┐ ┌────────┐                                    │
│  │Anthropic│ │OpenAI │    both emit same ProviderEvent   │
│  │adapter  │ │adapter│    shape → StreamManager          │
│  └────────┘ └────────┘                                    │
└───────────────────────────────────────────────────────────┘
```

## 5. Detailed design

### 5.1 OpenAI OAuth flow

Standard OAuth2 PKCE against `auth.openai.com`. Mirrors Codex CLI's flow.

**Constants** (`crates/solo-auth/src/oauth/openai.rs`):
- Issuer: `https://auth.openai.com`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann` (Codex's public client; see §9 risks)
- Redirect URI: `http://localhost:1455/auth/callback`
- Scopes: `openid profile email offline_access`
- Authorize endpoint: `{issuer}/authorize`
- Token endpoint: `{issuer}/oauth/token`

**Flow:**
1. `provider_start_oauth("openai", profile_name?)` Tauri command spawns Hyper on `localhost:1455`, generates PKCE verifier + S256 challenge + random state.
2. Returns `{ auth_url, flow_id }` — frontend opens browser via `@tauri-apps/plugin-shell`.
3. User completes consent; browser redirects to `localhost:1455/auth/callback?code=...&state=...`.
4. Hyper handler verifies state, extracts code, responds with a simple success page, shuts down.
5. Rust exchanges code → tokens: `POST /oauth/token` with `grant_type=authorization_code`, code, PKCE verifier, client_id, redirect_uri.
6. Decodes `id_token` JWT payload (base64-decode middle segment, no signature verification — transport-trusted) to extract `email`, `chatgpt_account_id`, `chatgpt_plan_type`.
7. Writes profile to `openai.oauth` vault blob, sets as active if it's the first profile.
8. Emits `BackendEvent::OAuthFlowCompleted`.

**Refresh** — invoked lazily in `credentials.rs::get_credentials` when `expires_at - now < 300s`:
- `POST /oauth/token` with `grant_type=refresh_token&refresh_token=...&client_id=...`.
- Updates profile's `access_token`, `refresh_token` (if rotated), `expires_at`, `last_refresh` atomically.
- Mutex per `(provider, profile)` prevents concurrent refresh.

**Error paths** surfaced to UI: port-in-use, user-cancelled, network failure, `refresh_token_expired/reused/invalidated` — each maps to a distinct string fed through `OAuthFlowFailed`.

### 5.2 API key path

Stored as plain string in `{provider}.apiKey` vault slot. No profile layer (single key per provider).

Validation on paste: `provider_set_api_key(provider, key)` does a trivial auth-check ping before storing:
- Anthropic: `POST https://api.anthropic.com/v1/messages` with a 1-token throwaway request; `401` → reject, anything else → accept.
- OpenAI: `GET https://api.openai.com/v1/models`; `401` → reject, `200` → accept.

### 5.3 Credential resolution order

`credentials.rs::get_credentials(provider, profile?)`:

1. OAuth active profile (if `profile` arg is None) or named profile — returns tokens, refreshing if needed.
2. API key from vault (`{provider}.apiKey`).
3. Env var (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).
4. Provider-specific CLI credentials — **Anthropic only** reads `~/.claude/.credentials.json` as legacy fallback. No `~/.codex/auth.json` fallback for v1 (per user: "not necessary if codex-cli is installed or not").

Returns `ResolvedCredential { kind: Oauth | ApiKey, token, account_id? }`.

### 5.4 Vault schema

Single-service keychain (`com.solo-ide.credentials`), JSON-valued keys:

| Key | Shape | Notes |
|---|---|---|
| `anthropic.oauth` | `ProviderOAuthStore` | Migrated from legacy single-token shape on first launch |
| `anthropic.apiKey` | `string` | Unchanged |
| `openai.oauth` | `ProviderOAuthStore` | **NEW** |
| `openai.apiKey` | `string` | **NEW** |

`ProviderOAuthStore` (new type in `crates/solo-auth/src/types.rs`):

```rust
#[derive(Serialize, Deserialize, TS)]
pub struct ProviderOAuthStore {
    pub active_profile: String,
    pub profiles: HashMap<String, OAuthProfile>,
}

#[derive(Serialize, Deserialize, TS)]
pub struct OAuthProfile {
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: Option<String>,          // OpenAI
    pub expires_at: i64,                   // unix seconds
    pub last_refresh: i64,
    pub email: String,                     // display label
    pub account_id: Option<String>,        // OpenAI chatgpt-account-id
    pub plan_type: Option<String>,
}
```

### 5.5 Migration

Runs once on app startup, before any credential read:

```
for provider in ["anthropic"]:  # existing providers only
    blob = vault.read("{provider}.oauth")
    if blob is None: continue
    if "profiles" in blob: continue            # already migrated
    email = decode_jwt_email(blob.id_token) or blob.email or "default"
    new = ProviderOAuthStore {
      active_profile: "default",
      profiles: { "default": OAuthProfile::from_legacy(blob, email) }
    }
    vault.write("{provider}.oauth", new)
```

Idempotent. Safe to run on every launch. Logs a single info line when migration runs.

### 5.6 New Tauri commands

In `apps/desktop/src-tauri/src/provider_commands.rs`. All generic over provider.

| Command | Signature | Notes |
|---|---|---|
| `provider_start_oauth` | `(provider: String, profile_name: Option<String>) -> { auth_url, flow_id }` | Spawns Hyper server; result `flow_id` lets frontend correlate BackendEvents |
| `provider_cancel_oauth` | `(flow_id: String) -> ()` | Tears down Hyper server if user closes onboarding early |
| `provider_list_profiles` | `(provider: String) -> Vec<ProfileSummary>` | `ProfileSummary = { name, email, is_active, expires_at }` |
| `provider_set_active_profile` | `(provider: String, profile_name: String) -> ()` | |
| `provider_remove_profile` | `(provider: String, profile_name: String) -> ()` | If removed profile was active, auto-picks another or clears `active_profile` |
| `provider_set_api_key` | `(provider: String, key: String) -> ()` | Validates via auth-check ping before storing |
| `provider_delete_api_key` | `(provider: String) -> ()` | |
| `provider_sign_out` | `(provider: String, profile_name: Option<String>) -> ()` | If `profile_name` is None, clears all profiles for that provider |

The OAuth callback is handled entirely inside the Hyper server spawned by `provider_start_oauth` — no separate `provider_complete_oauth` command surfaces to the frontend. Frontend awaits the `OAuthFlowCompleted` event.

### 5.7 BackendEvent additions

In `crates/solo-protocol/src/lib.rs`:

```rust
pub enum BackendEvent {
    // ... existing variants ...
    OAuthFlowStarted   { provider: String, flow_id: String },
    OAuthFlowCompleted { provider: String, flow_id: String, profile: String, email: String },
    OAuthFlowFailed    { provider: String, flow_id: String, error: String },
    ProviderProfilesChanged { provider: String },
}
```

`ProviderProfilesChanged` fires on any profile add/remove/active-switch so the provider store can re-read the authoritative list without tracking mutations manually.

### 5.8 Agent-bridge provider dispatch

Structural change minimized. New files:

```
agent-bridge/src/
├── providers/
│   ├── types.ts         # ProviderSession interface + ProviderEvent union
│   ├── anthropic.ts     # existing agent.ts logic extracted, unchanged behavior
│   └── openai.ts        # new adapter
└── session-manager.ts   # adds provider dispatch on session create
```

**Internal event shape (the contract):**

```ts
interface ProviderSession {
  sendMessage(text: string, attachments?: Attachment[]): void;
  receiveResponse(): AsyncIterable<ProviderEvent>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

type ProviderEvent =
  | { type: 'text_delta';     text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call';      id: string; name: string; input: unknown }
  | { type: 'tool_result';    toolCallId: string; output: unknown }
  | { type: 'usage';          inputTokens: number; outputTokens: number }
  | { type: 'done';           stopReason: string };
```

Anthropic-shaped internally (because that harness exists); the OpenAI adapter translates.

**OpenAI adapter (`providers/openai.ts`):**

- Uses `openai` npm package (v4+).
- Base URL selection at session construction:
  - OAuth credential → `https://chatgpt.com/backend-api/codex` + `chatgpt-account-id` header.
  - API-key credential → `https://api.openai.com/v1` (no account header).
- Calls `client.responses.create({ model, input, stream: true, tools })`.
- Consumes the SSE stream; maps events:
  - `response.output_text.delta` → `text_delta`
  - `response.reasoning.delta` → `thinking_delta`
  - `response.function_call_arguments.delta` → accumulate
  - `response.output_item.done` for a function call → emit `tool_call`
  - `response.completed` → `usage` + `done`
- Tool permissions: when a `tool_call` arrives, adapter awaits `PermissionManager.check(name, input)` before emitting to the harness / before invoking the tool. Denied tools are replied with a rejection tool result on the next turn.
- Tool results: injected as `{ role: "tool", tool_call_id, content }` items in the next `responses.create` input array.

**`session.create` stdin message (protocol addition):**

```jsonc
{
  "type": "session.create",
  "sessionId": "...",
  "provider": "openai",                // or "anthropic"
  "model": "gpt-5.4-medium",
  "credentials": {
    "kind": "oauth",                   // or "api_key"
    "token": "...",
    "accountId": "..."                 // OpenAI OAuth only
  },
  "cwd": "...",
  "mcpServers": [...]                  // ignored on OpenAI sessions for v1
}
```

Credentials now flow Rust → sidecar explicitly; sidecar no longer resolves credentials itself. This replaces `agent-bridge/src/credentials.ts`'s current lookup logic with a no-op that just reads what Rust sent.

### 5.9 Un-hardcoding agent_commands.rs

Three sites in `apps/desktop/src-tauri/src/agent_commands.rs` currently call `get_credentials(ProviderType::Anthropic)`:

- Line ~248: commit message generation
- Line ~312: transcript refinement
- Line ~345: session title generation

Each becomes:

```rust
let active = provider_state.active_provider()?;    // "anthropic" | "openai"
let profile = provider_state.active_profile(&active);
let model = provider_state.selected_model_for(&active);
let creds = provider_state.credentials
    .get_credentials(&active, profile.as_deref()).await?;
session_manager.create_session(active, model, creds, ...);
```

The session manager (sidecar caller) accepts the new `session.create` message shape. These utility commands use the currently-active provider/model — not user-selectable per-call, since they're triggered by UI actions like "generate commit message" that don't expose a model picker.

### 5.10 Model registry

`crates/solo-auth/src/models.rs` — replace the three `gpt-5.2-*` placeholder entries with:

```rust
ModelInfo {
  id: "gpt-5.4-extra-high",
  display_name: "GPT-5.4 (Extra High)",
  alias: "gpt-5.4-extra-high",
  provider: "openai",
  capabilities: { context: 1_000_000, max_output: 100_000,
                  vision: true, tools: true, streaming: true, thinking: true },
  is_default: false,
  description: "Highest-reasoning GPT-5.4 tier.",
},
ModelInfo {
  id: "gpt-5.4-medium",
  display_name: "GPT-5.4 (Medium)",
  alias: "gpt-5.4-medium",
  provider: "openai",
  capabilities: { context: 1_000_000, max_output: 64_000,
                  vision: true, tools: true, streaming: true, thinking: true },
  is_default: true,
  description: "Balanced default.",
},
ModelInfo {
  id: "gpt-5.4-low",
  display_name: "GPT-5.4 (Low)",
  alias: "gpt-5.4-low",
  provider: "openai",
  capabilities: { context: 400_000, max_output: 32_000,
                  vision: true, tools: true, streaming: true, thinking: false },
  is_default: false,
  description: "Fast, cost-optimized.",
}
```

Capability numbers are provisional; refined during implementation if OpenAI's published limits differ.

### 5.11 Frontend

**Onboarding (`src/components/onboarding/`)** — new dual-provider card. Replaces single "Sign in with Claude" screen. Either or both providers may be signed in; at least one required to proceed. "Or use API key" expands an inline masked input per card.

**Settings → Providers panel (`src/components/settings/ProvidersPanel.tsx`)** — becomes a vertical list of collapsible provider rows. Each row:
- Header: provider name, `● Active` pill if this is `activeProvider`.
- Accounts sub-list: one row per profile with radio for active-profile selection, `⋯` menu (Remove account, Copy email).
- "+ Add another account" — triggers OAuth flow with user-editable `profile_name` (defaults to `account-N`).
- API Key field below accounts: masked input with `[Update]` / `[Remove]` buttons.

**Model picker** — grouped-by-provider dropdown. Selecting a model atomically sets `selectedModel` + `activeProvider` in `useProviderStore`. Trigger label shows `<model> · <active-profile-email>` for clarity in multi-account scenarios. Greyed rows for providers with no valid credentials link back to Settings → Providers.

**Provider store additions (`src/stores/provider-store.ts`):**
- State: `profiles: Record<provider, ProfileSummary[]>`, `activeProfile: Record<provider, string>`.
- Actions: `addProfile(provider)`, `removeProfile(provider, name)`, `setActiveProfile(provider, name)`, `refreshProfiles(provider)`.
- Listener on `ProviderProfilesChanged` → `refreshProfiles(event.provider)`.

### 5.12 Files touched summary

**New files:**
- `crates/solo-auth/src/types.rs`
- `crates/solo-auth/src/oauth/openai.rs`
- `agent-bridge/src/providers/types.ts`
- `agent-bridge/src/providers/anthropic.ts`
- `agent-bridge/src/providers/openai.ts`

**Modified files:**
- `crates/solo-auth/src/models.rs`
- `crates/solo-auth/src/credentials.rs`
- `crates/solo-protocol/src/lib.rs`
- `apps/desktop/src-tauri/src/provider_commands.rs`
- `apps/desktop/src-tauri/src/agent_commands.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src/stores/provider-store.ts`
- `apps/desktop/src/lib/tauri/provider.ts`
- `apps/desktop/src/components/settings/ProvidersPanel.tsx`
- `apps/desktop/src/components/onboarding/*`
- `apps/desktop/src/components/chat/ModelPicker.tsx` (or equivalent)
- `agent-bridge/src/session-manager.ts`
- `agent-bridge/src/credentials.ts`
- `agent-bridge/package.json` — add `openai` dependency

**Generated (never hand-edited):**
- `apps/desktop/src/bindings/*` — regenerated via `bun run gen:bindings` after protocol changes.

## 6. Testing plan

- **Unit (Rust):** PKCE verifier/challenge correctness; `ProviderOAuthStore` serialization round-trip; legacy-blob migration idempotency; credential resolution priority order.
- **Integration (Rust):** end-to-end OAuth against a mock OIDC server (Hyper-based test fixture) for both Anthropic and OpenAI shapes; token refresh mutex under concurrent access.
- **Sidecar:** adapter-level snapshot tests for OpenAI SSE → `ProviderEvent` translation (fixture SSE streams captured from real `chatgpt.com/backend-api` responses).
- **Manual UX:** first-run shows both cards; sign in with ChatGPT completes end-to-end on a real account; switching models in picker routes to correct endpoint; API-key paste validates and rejects bad keys; multi-account add/remove/switch flows.

## 7. Open questions / risks

1. **Client ID ownership** — reusing Codex's public `app_EMoamEEZ73f0CkXaXp7hrann` means OpenAI's consent screen may display "Codex" or similar. If OpenAI revokes the client, Solo's ChatGPT OAuth breaks with no recourse until we switch to API-key-only. No mitigation in v1 — accepted risk.
2. **ChatGPT plan limits** — Free/Plus plans will hit quota errors faster than Pro. Surface `429` responses as toast; no proactive plan-based filtering in v1.
3. **MCP on OpenAI** — OpenAI Responses API lacks first-class MCP support. Users switching to an OpenAI session lose MCP tools. Documented limitation.
4. **Token refresh race** — guarded by per-`(provider, profile)` mutex; if we see contention bugs in practice, revisit.
5. **Port 1455 conflicts** — if user has Codex CLI running a concurrent login, we collide. Surface a clean error; no auto-port-selection in v1.
6. **JWT signature not verified** — we trust the TLS transport from `auth.openai.com`. Matches Codex CLI's behavior. A compromised network path could inject fake claims, but they couldn't mint a valid `access_token` without the signing key, so the practical attack surface is limited to display-label spoofing.

## 8. Phasing

Single PR, but implementation order matters:

1. Protocol types + migration + vault schema.
2. `solo-auth/oauth/openai.rs` + `provider_commands.rs` OAuth commands.
3. `credentials.rs` profile-aware resolution + `agent_commands.rs` un-hardcoding.
4. Sidecar refactor: extract Anthropic into `providers/anthropic.ts`, add `providers/openai.ts`, wire dispatch in `session-manager.ts`.
5. Frontend: provider store profile additions, Settings panel, Model picker, Onboarding.
6. End-to-end testing against real accounts for both providers.

Each step compiles and passes tests before the next begins.
