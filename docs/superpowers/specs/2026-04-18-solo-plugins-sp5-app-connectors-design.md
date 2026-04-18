# Solo Plugins — SP5: App Connectors Design Specification

**Date:** 2026-04-18
**Status:** Draft (for user review)
**Scope:** Sub-project 5 of 7 in the broader Solo Plugins initiative
**Estimated effort:** 2–3 weeks
**Depends on:** SP1 (foundation crate) ✓, SP4 (MCP runtime) — tools registration path
**Prior docs:**
- SP1 design: `specs/2026-04-17-solo-plugins-foundation-design.md`
- SP4 design: `specs/2026-04-18-solo-plugins-sp4-mcp-design.md`

---

## Context

SP5 lets plugins declare third-party integrations (Slack, Gmail, Google Drive, Linear, GitHub — any OAuth-backed SaaS) and expose them as tools the agent can call. Plugin manifests already parse an `apps` path field (`crates/solo-plugins/src/manifest.rs:35`), reserved in SP1 and still ignored through SP4.

### Prior art — what we have and don't have

- **Codex's `core-plugins` has no OAuth or connector code.** The `.app.json` file format only carries connector IDs (e.g. `{ "apps": { "slack": { "id": "slack" } } }`); codex does not implement authentication or token management. (Verified via grep: zero matches for `oauth`, `slack`, `gmail`, `drive`, `connector` in codex's core-plugins crate.)
- **Solo's existing auth flow** (`apps/desktop/src-tauri/src/auth_commands.rs`) is AWS Cognito-specific: PKCE flow through Cognito Hosted UI, callback via Tauri deep-link handler, tokens stored in macOS Keychain via `/usr/bin/security` shell-out (`crates/solo-auth/src/credentials.rs`). **Not generalizable as-is** — it federates Google/GitHub as IdPs *into* Cognito; it does not produce provider-specific tokens usable against Slack/Gmail/Drive APIs.
- **GitHub token pattern exists in auto-memory, not in code.** Durable preference: DynamoDB + KMS CMK server-side, macOS Keychain as local cache, never per-user Secrets Manager. No existing code implements this yet; SP5 is the first place this pattern lands.

### The critical framing question

The MCP ecosystem in April 2026 already has production Slack, Gmail, and Drive connectors that ship as MCP servers with OAuth. If SP5 duplicates that ecosystem, we build-and-maintain a parallel runtime. If SP5 *extends SP4's MCP runtime* with OAuth token injection into environment variables (which is exactly how those MCP servers consume tokens), we get Slack/Gmail/Drive tool integration essentially for free.

**Chosen framing:** SP5 is "OAuth token management for plugins," not "parallel connector runtime." Plugins declare providers they need; Solo owns the OAuth flow and refresh; tokens are injected into MCP servers' env at startup. Tools remain visible to the agent through SP4's MCP path.

This is a strictly smaller SP5 than the original design note suggested, and it collapses the old "new `solo-connectors` crate" into a thin OAuth-orchestration module inside `solo-plugins` plus a token-store module in `solo-auth`.

### Where SP5 lands in the roadmap

```
SP1 foundation ✓ → SP2 skills wiring ✓ → SP3 plugins UI ✓
                    ↓
                  SP4 MCP runtime ─→ SP5 app connectors ← (this doc)
                                      (OAuth tokens feed into SP4's env injection)
```

SP6 (marketplace) and SP7 (create flow) are independent.

---

## Scope decision

| Scope | What's in | What's out | Effort |
|---|---|---|---|
| **Small (chosen)** | OAuth for one provider (Google — unlocks Gmail + Drive), token store, env injection into MCP servers | Slack, GitHub, Linear; multi-account; mid-session rebroker; UI for disconnect | ~1.5 weeks |
| **Medium** | Small + Slack + GitHub providers + Provider tab UI (connected/disconnect) + mid-session refresh | Multi-account per provider, fine-grained scope toggling | ~3 weeks |
| **Large** | Medium + custom-provider registration (plugin authors declare arbitrary OAuth providers) + per-scope consent | — | ~5+ weeks |

**Why small:** Google covers Gmail, Drive, Calendar, and Docs — the highest-value connectors in the original ask. One provider exercises the full end-to-end path (OAuth, refresh, revoke, env injection, MCP tool enabled). Slack/GitHub follow as additive work without protocol churn. Custom providers are a clear SP5.5 later.

**Rejected alternatives:**

- **"Just ship the MCP servers directly" (no Solo OAuth).** Users would hand-paste tokens into environment variables. Works, but the whole point of the Plugins UI is a chat-first experience where "connect Google" is one click.
- **"Build a parallel connector runtime" (original design note).** Duplicates MCP ecosystem work. Only justifiable if OAuth-free connectors emerge as a real need, which we haven't seen.

---

## What ships in SP5

1. **Token storage** — `solo-auth::token_store::ProviderTokenStore` with three backends:
   - macOS Keychain (local cache, primary on desktop)
   - DynamoDB + KMS CMK (server-side cloud sync — matches the established pattern for GitHub)
   - Environment variable fallback (dev convenience)
2. **OAuth orchestration** — `solo-auth::oauth::flow` with one concrete provider (`GoogleProvider`), pluggable trait interface for adding Slack/GitHub later.
3. **Callback surface** — Tauri deep-link handler path extended for provider callbacks, mirroring the Cognito pattern.
4. **Plugin manifest `apps` wiring** — SP1 already parses the `apps` path; SP5 loads `.app.json` and translates it into "provider tokens needed."
5. **Env injection into MCP runtime** — SP4's config builder is extended to resolve `${provider:google:accessToken}` variable in `.mcp.json` before spawn.
6. **Tauri command surface** — four commands: `providers_list`, `providers_connect`, `providers_disconnect`, `providers_get_status`.
7. **Provider-status badges** in `PluginDetailDrawer` — "Connected / Not connected / Needs re-auth."
8. **Smoke test** — Connect Google → install a Gmail MCP plugin → agent reads a test email.

---

## On-disk surface

### `.app.json` format (inside plugin root)

The `apps` field in `plugin.json` points to this file. Format:

```json
{
  "apps": {
    "gmail": {
      "provider": "google",
      "scopes": ["https://www.googleapis.com/auth/gmail.readonly"]
    },
    "drive": {
      "provider": "google",
      "scopes": [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly"
      ]
    }
  }
}
```

- `provider` — one of the provider IDs Solo knows about (SP5 ships only `google`).
- `scopes` — OAuth scopes needed for this plugin's use. Union across all enabled plugins is requested when the user first connects.
- Keys (`gmail`, `drive`) are **plugin-local app IDs**, used for display and to disambiguate when a single plugin talks to two surfaces of the same provider.

**Variable exposure:** if the plugin's `.mcp.json` wants the token, it references `${provider:google:accessToken}`. SP5 resolves this at MCP-server spawn time (feeds into SP4's existing expansion pipeline).

### Token store (local)

macOS Keychain service `"com.solo-ide.providers"` (parallel to existing `"com.solo-ide.credentials"`). One entry per `(provider_id, account_id)` tuple:

```
key:   google:sa9082@nyu.edu
value: { "access_token": "...", "refresh_token": "...", "expires_at": "2026-04-18T15:00:00Z", "scopes": ["gmail.readonly","drive.readonly"] }
```

Rationale for Keychain-per-provider (not merging into the single Cognito blob): provider refresh tokens have different lifecycle and revocation semantics than Cognito session tokens. A single compromised Cognito secret should not also leak provider tokens.

### Cloud token store (DynamoDB)

Table: `solo-provider-tokens-{stage}`
- **Partition key:** `solo_user_id` (Cognito sub)
- **Sort key:** `provider_id:account_id`
- **Encrypted fields:** `access_token`, `refresh_token` — encrypted client-side with a KMS CMK (`alias/solo-provider-tokens`) before write. Server sees ciphertext only.
- **Plaintext fields:** `scopes`, `expires_at`, `connected_at`, `last_used_at`, `revoked_at?`.

**Consistency model:** local Keychain is the hot path; cloud is a warm cache for multi-device sync. On app start, cloud wins if it has a newer `connected_at` than local.

### No new plugin directory layout

SP5 reuses SP1's layout entirely. App configs live *inside* plugins at the path declared by `plugin.json::apps`.

---

## Protocol types

All new types in `crates/solo-protocol/src/lib.rs`, regenerate bindings after.

### Provider identity

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug, Hash, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProviderId(pub String);   // "google", "slack", "github", ...

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnection {
    pub provider: ProviderId,
    pub account_id: String,           // email for Google, team/user for Slack
    pub display_name: String,         // shown in UI
    pub granted_scopes: Vec<String>,
    pub connected_at: String,         // RFC3339
    pub expires_at: Option<String>,   // for access token; refresh handled transparently
    pub status: ProviderStatus,
}

#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ProviderStatus {
    Connected,
    NeedsReauth,      // refresh failed; user must re-consent
    Revoked,          // token was revoked server-side
    Expired,          // access token expired, refresh in flight
}
```

### Plugin `apps` declaration (loaded from `.app.json`)

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PluginAppDeclaration {
    pub app_id: String,          // local to the plugin, e.g. "gmail"
    pub provider: ProviderId,
    pub scopes: Vec<String>,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug, Default)]
#[ts(export)]
pub struct PluginAppsOutcome {
    pub apps: Vec<PluginAppDeclaration>,
    pub errors: Vec<AppsLoadError>,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub struct AppsLoadError {
    pub plugin_id: PluginId,
    pub config_path: String,
    pub message: String,
}
```

### Extension to `PluginSummary`

```rust
pub struct PluginSummary {
    // ... SP1 + SP4 fields ...
    pub app_provider_count: u32,      // 0 if no .app.json
    pub needs_auth: bool,             // true if any required provider is NOT Connected
}
```

`needs_auth` is the load-bearing UI hook — it drives the "Connect to enable" banner on tile.

### OAuth flow types (Rust-only; not on wire)

```rust
pub trait OAuthProvider: Send + Sync {
    fn id(&self) -> ProviderId;
    fn authorization_url(&self, scopes: &[String], state: &str, code_challenge: &str) -> String;
    async fn exchange_code(&self, code: &str, code_verifier: &str) -> Result<TokenResponse, ProviderError>;
    async fn refresh(&self, refresh_token: &str) -> Result<TokenResponse, ProviderError>;
    async fn revoke(&self, token: &str) -> Result<(), ProviderError>;
    async fn userinfo(&self, access_token: &str) -> Result<ProviderUserInfo, ProviderError>;
}

pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub granted_scopes: Vec<String>,
}
```

Ship one implementation: `GoogleProvider`. Slack/GitHub follow the same trait without protocol churn.

---

## OAuth flow

### Registration (one-time, at app startup)

`OrbitProviderRegistry` is built in Solo's `lib.rs` and `.manage()`d:

```rust
ProviderRegistry::new()
    .with(GoogleProvider::from_env())
    // SP5.5: .with(SlackProvider::from_env())
    // SP5.5: .with(GithubProvider::from_env())
```

OAuth client IDs / secrets are **baked into the app at build time** from environment variables (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`). For Google, the "installed app" OAuth client type is used (no client secret required for PKCE; keep the secret variable for providers that still require it).

### Connect flow (`providers_connect`)

1. **Frontend:** user clicks "Connect Google" in the Plugins tab.
2. **Rust:** generate `code_verifier` + `code_challenge` (same SHA256 PKCE pattern as `auth_commands.rs:137-148`). Mint a per-request `state` (UUID). Store `(state → code_verifier)` in an in-memory map with 5-min TTL.
3. **Rust:** open the provider's authorization URL in the user's default browser via `tauri::shell::open`. Example Google URL:
   ```
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=…
     &redirect_uri=solo://providers/google/callback
     &response_type=code
     &scope=<space-separated union of all needed scopes>
     &code_challenge=…
     &code_challenge_method=S256
     &state=<uuid>
     &access_type=offline
     &prompt=consent          # always ask, so refresh_token is issued
   ```
4. **Browser:** user consents; Google redirects to `solo://providers/google/callback?code=…&state=…`.
5. **Tauri deep-link handler:** routes `solo://providers/*` to `handle_provider_callback`, which:
   - Looks up `state` → `code_verifier`; 404s the request if missing or expired.
   - Calls `provider.exchange_code(code, verifier)`.
   - Calls `provider.userinfo(access_token)` to get the account identifier.
   - Persists `ProviderConnection` to Keychain + DynamoDB.
   - Emits `BackendEvent::ProviderConnected { provider, account_id }`.
6. **Frontend:** listens for the event, refreshes the provider status view.

### Refresh (transparent)

Before any MCP server spawn that needs a token, SP5 checks `expires_at`. If within 60s of expiry, refresh. If refresh fails, mark status `NeedsReauth` and surface in UI; MCP server spawn fails with a clear error that says "Reconnect Google to enable this plugin."

### Disconnect (`providers_disconnect`)

1. Call `provider.revoke(refresh_token)`.
2. Delete from Keychain + DynamoDB.
3. Emit `BackendEvent::ProviderDisconnected`.
4. Any MCP server with env injection referencing that provider fails to start on next session.

---

## Tauri command surface

```rust
/// List every provider known to the registry, plus connection status for this user.
#[tauri::command]
async fn providers_list(state: State<'_, ProvidersState>)
    -> Result<Vec<ProviderStatus>, String>;

/// Kick off OAuth. Returns the URL so the frontend can show a "waiting" state;
/// the browser is also opened via tauri::shell::open.
#[tauri::command]
async fn providers_connect(
    provider: ProviderId,
    scopes: Vec<String>,
    state: State<'_, ProvidersState>,
) -> Result<ProviderConnectPending, String>;

/// Revoke and forget. Idempotent.
#[tauri::command]
async fn providers_disconnect(
    provider: ProviderId,
    account_id: String,
    state: State<'_, ProvidersState>,
) -> Result<(), String>;

/// Current connections, for polling. Prefer the `ProviderConnected/Disconnected` events.
#[tauri::command]
async fn providers_get_status(provider: ProviderId, state: State<'_, ProvidersState>)
    -> Result<Option<ProviderConnection>, String>;
```

### BackendEvent extensions

```rust
pub enum BackendEvent {
    // ... existing ...
    ProviderConnected { provider: ProviderId, account_id: String },
    ProviderDisconnected { provider: ProviderId, account_id: String },
    ProviderNeedsReauth { provider: ProviderId, account_id: String, reason: String },
}
```

---

## SP4 integration: env injection

SP4 resolves `${PLUGIN_ROOT}`, `${workspaceFolder}`, `${env:NAME}` in `.mcp.json` strings. SP5 adds one variable: `${provider:<id>:accessToken}`.

**Resolution rule.** For each `${provider:<id>:accessToken}` in a plugin's `.mcp.json`:

1. Find the plugin's `.app.json` and collect the provider IDs it declares.
2. If `<id>` is not declared in `.app.json` → **load error**: "Plugin references provider `<id>` without declaring it in apps."
3. Look up the `ProviderConnection` for `<id>` in the token store. If missing → load error with `status = NeedsAuth`.
4. If token expired, attempt refresh (blocking, with 5s timeout). On failure → mark `NeedsReauth`, load error.
5. Substitute the access token into the string.

Tokens are substituted at the **final moment before spawn**, never logged, and never written to the `.mcp.json` file on disk.

### Refresh mid-session behavior

An MCP server spawned with a token that subsequently expires keeps running until the SDK reports an auth failure. SP5 does not preemptively restart MCP servers — that would be user-visible churn. The next session picks up the fresh token. This is consistent with SP4's "startup-only registration" stance.

---

## Frontend surface

### Plugins tab — new badges

- Tile: if `summary.needs_auth`, show "Connect to enable" chip instead of the toggle.
- Detail drawer: new "Connected apps" section listing each provider, account, and a Disconnect button.

### Settings → Providers tab (new, optional — SP5.5 if pushed)

Spec does not require a standalone Providers tab in the first SP5 cut. Everything goes through the Plugins tab's detail drawer. A dedicated tab can come later if users have many disconnected accounts.

### Connect UX details

When the user clicks "Connect Google":

1. Browser opens to Google consent screen.
2. The Plugins tab shows an inline spinner next to the provider: "Waiting for browser consent…"
3. On success (event received): spinner → green dot, banner fades, the relevant plugin tiles un-gate.
4. On timeout (5 min): "Consent window timed out. Try again?" with a retry button.

---

## Error handling

Four tiers, mirroring SP4:

1. **IPC boundary** — `Result<T, String>`. Only fails on catastrophic issues (no token store, no network).
2. **Per-plugin apps load errors** — malformed `.app.json`, unknown provider — in `PluginAppsOutcome.errors`, surfaced on the plugin tile.
3. **OAuth flow errors** — user denied consent, state mismatch, code exchange failed — surfaced as toasts with actionable messages. State-mismatch errors specifically log `warn!` with the mismatched state for security telemetry.
4. **Token refresh errors** — marked `NeedsReauth` in the store, emitted as `ProviderNeedsReauth` event. UI surfaces a re-connect prompt.

### Security-sensitive logging rules

- **Never log access tokens, refresh tokens, or `code` / `code_verifier`.**
- `debug!` may include account IDs, scopes, expiry timestamps.
- `warn!` may include provider errors verbatim (Google returns structured JSON — safe).
- `error!` for anything requiring an operator to act (e.g., KMS CMK unavailable on cloud sync).

---

## Security considerations

**Authorization code interception.** Deep-link callbacks on macOS could theoretically be intercepted by another app also registering `solo://`. Mitigations:
- PKCE is mandatory — interception of the code alone does not grant a token without the verifier.
- State parameter is always checked; mismatches abort the flow.
- `access_type=offline` + `prompt=consent` ensures a refresh token is issued fresh each connect, so a stolen old code gives no long-term access.

**Token-at-rest.** Access tokens live in macOS Keychain (OS-level encryption) locally and KMS-encrypted blobs in DynamoDB. Neither ever touches `~/.solo/` on disk.

**Token-in-flight to MCP servers.** Tokens are injected into environment variables of the subprocess at spawn. Environment variables are visible to the process but not to other users on the same machine (standard Unix semantics). A malicious plugin with MCP access could exfiltrate tokens; SP5 does not sandbox that. Mitigation: source disclosure in Plugins UI + user opt-in gating.

**Provider client-secret storage.** Baked into the binary at build time. Low-sensitivity for "installed app" flows that use PKCE (the secret alone is not sufficient to impersonate the app). Higher-sensitivity for providers that require client_secret in token exchange; revisit if that becomes a concern.

**Scope creep.** Consent request is the **union** of all currently-enabled plugins' scopes. Users sometimes react to "Google wants access to Drive and Gmail and Contacts" by disconnecting entirely. Mitigation: on Connect, show a scope breakdown by plugin ("Gmail access is used by: Email Summarizer plugin"). Not in SP5 — noted for UX polish.

**KMS CMK lifecycle.** The GitHub token memory mandates KMS CMK + DynamoDB. SP5 is the first implementation of that pattern. The CMK must be provisioned in both `dev` and `prod` Cognito stages before SP5 can ship to real users. Flagged for the infra team.

---

## Testing strategy

### Unit tests

- **`token_store`** — round-trip write/read/delete; expired-detection; migration of legacy-shape entries (none yet, but forward-compat).
- **`google_provider`** — authorization URL construction; token response parsing (valid / malformed / missing fields); refresh error mapping.
- **`apps.rs`** — `.app.json` parsing (valid / malformed / unknown provider ID / empty apps object).
- **`env_injection`** (SP4 extension) — `${provider:google:accessToken}` substitutes when connected, errors when missing or expired.

### Integration test (`crates/solo-plugins/tests/apps_round_trip.rs`)

Use a fake `OAuthProvider` (synchronous, returns canned tokens). Install a fixture plugin with `.app.json` + `.mcp.json` that references `${provider:fake:accessToken}`. Connect → assert `PluginSummary.needs_auth == false`. Call `merged_mcp_config` → assert the token was substituted. Disconnect → assert `needs_auth` flips back to `true`.

### Smoke test (manual, pre-merge)

1. Run the app with `GOOGLE_OAUTH_CLIENT_ID` set.
2. Install a fixture plugin (e.g. `@modelcontextprotocol/server-gmail` wrapped with a `.app.json` + `.mcp.json`).
3. Click Connect on the Plugins tab → go through real Google consent.
4. Create a new chat session → ask "read my latest email."
5. Verify the MCP server starts with the token and the agent completes the task.
6. Click Disconnect → verify the MCP server fails to start on next session with a "Reconnect Google" error.

### Not tested in SP5

- Slack/GitHub providers (add later with the same harness).
- DynamoDB + KMS CMK cloud sync end-to-end — stubbed in tests; exercised manually before prod.
- Multi-account per provider (SP5.5).
- Token theft / phishing scenarios — out of scope; belongs in a security review.

---

## Out of scope

1. **Provider variety** — only Google in the first cut; Slack/GitHub/Linear slated for SP5.5.
2. **Multi-account per provider** — one account per provider in SP5; collision on connect replaces the prior account.
3. **Scope fine-tuning UI** — scopes are union-of-plugins; no per-plugin toggle UI.
4. **Mid-session refresh propagation to running MCP servers** — expired tokens only re-inject on next session.
5. **Custom provider registration by plugin authors** — providers are baked into the Solo app; plugins can declare usage but not new provider types.
6. **Web-based OAuth flow from solo.web** — desktop app only. Web follow-on is a separate design.
7. **OAuth device-code flow** — standard browser redirect only. Device-code is useful for headless Solo but not in SP5.

---

## Acceptance criteria

- `bun run check` + `cargo test -p solo-plugins` + `cargo test -p solo-auth` pass.
- `cargo clippy --workspace` clean.
- `bun run gen:bindings` has been run.
- With `GOOGLE_OAUTH_CLIENT_ID` set and a fixture Gmail plugin installed:
  - Plugins tab shows "Connect Google" chip on the plugin tile.
  - Clicking Connect opens a browser, consents, closes; within 10s the tile un-gates.
  - Creating a new chat session, the Gmail MCP tool is available to the agent and returns real data.
  - Clicking Disconnect → tile re-gates; new sessions fail to start the MCP server with a clear re-connect message.
- KMS CMK + DynamoDB write path works against `dev` stage (smoke test, manual).
- No regression: plugins without `.app.json` behave identically to SP4.
- No access tokens appear in any log at any level.

---

## Open questions (for implementation phase)

1. **Provider-client-secret handling.** Baked into binary is adequate for Google's installed-app PKCE flow but less so for GitHub (which requires the secret). Decision to make in SP5.5; SP5 can ship without.
2. **Cloud sync conflict resolution.** Two devices connect to Google as different accounts. Which wins? Proposed: last-write-wins with a user-visible warning; flagged for review.
3. **Expiry handling for long-lived sessions.** A 30-minute chat with an MCP server that has a 30-minute token — the SDK will eventually fail tool calls. Not SP5's job to preempt, but worth a UI surface for "token expired mid-session; restart to continue" at polish time.
4. **Does SP5 ship a standalone "Providers" settings tab, or fold into Plugins tab only?** Spec proposes the latter. Revisit if the UI gets cluttered.

---

## Open questions the user should answer before implementation

- **OAuth client ID policy.** Do we register one Google OAuth app per Solo install environment (dev, staging, prod), or share prod across dev? First option is cleaner; needs Google Cloud console setup.
- **DynamoDB/KMS provisioning.** Who owns provisioning `solo-provider-tokens-{stage}` and `alias/solo-provider-tokens`? Same owner as the existing `solo-user-stats-{stage}` table? Needs an explicit handoff.
- **Gating in free tier.** Are app connectors a Pro-only feature, or free? Affects whether the "Connect" flow also checks entitlement.

---

## Follow-on roadmap after SP5

- **SP5.5** — Slack + GitHub + Linear providers; multi-account; scope breakdown UI
- **SP5.6** — Web-based OAuth flow from `solo-web` for the future browser product
- **SP5.7** — Custom-provider plugin extension (plugin authors register new OAuth providers)

These are intentionally factored out so SP5 ships in one PR.
