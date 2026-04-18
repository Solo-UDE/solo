# Solo Plugins — Foundation Crate Design Specification

**Date:** 2026-04-17
**Status:** Approved (pending user review of this doc)
**Scope:** Sub-project 1 of 7 in the broader Solo Plugins initiative
**Estimated effort:** 1–2 weeks

---

## Context

Solo IDE is adding a plugin system modeled closely on codex's `core-plugins` crate. The end-state vision is full parity with the ChatGPT-style Plugins surface (the Plugins tab screenshot that kicked off this design): a top-level sidebar item with a grid of installable plugins, each of which can bundle skills, MCP servers, and OAuth-backed app connectors (Slack, Gmail, Google Drive, etc).

That full vision has been decomposed into seven sub-projects. This document specifies **only sub-project 1**: the foundation `solo-plugins` crate. Later sub-projects build on this foundation without changing it.

### Seven-sub-project decomposition (for reference)

1. **Foundation `solo-plugins` crate** — *this document*. Manifest parsing, local store, toggles, adapter discovery, Tauri command surface. No UI.
2. **Skills leg wiring.** Unify `skills_commands.rs`'s plugin-skill discovery through the new crate.
3. **Plugins UI v1.** Promote Skills-in-Settings to a top-level sidebar item with Plugins/Skills sub-tabs.
4. **MCP runtime.** New `solo-mcp` crate; plugins with `mcpServers` spawn real MCP clients and register tools into the agent loop.
5. **App-connectors runtime.** New `solo-connectors` crate; OAuth-backed Slack/Gmail/Drive connectors.
6. **Remote install + marketplace.** `remote.rs`, `marketplace.rs`, `marketplace_upgrade.rs`, install-from-git flow, marketplace browse UI.
7. **Create / author flow.** Scaffolder for "Create" button in the UI.

Dependencies: `1 → 2 → 3`, `1 → 4`, `1 → 5`, `1 → 6`, `1, 3 → 7`.

### Why hard-fork codex's `core-plugins`

Codex's `core-plugins` crate is the right architectural starting point, but its Cargo.toml pulls in 11 internal codex crates, including heavy ones (`codex-config`, `codex-login`, `codex-exec-server`). The decision — validated with the user on 2026-04-17 — is to **hard-fork the small set of modules we actually need** (`manifest.rs`, `store.rs`, `toggles.rs`, plus the `PluginId` from `codex-plugin` and the path utilities from `codex-utils-absolute-path` / `codex-utils-plugins`) into a new self-contained crate. No codex-prefixed types, no codex-prefixed crate dependencies. Licensing is fine (codex is Apache-2.0); provenance will be documented in the crate's README.

---

## On-disk layout

Three distinct directory categories, all live on the user's machine:

### Solo's own plugin store (read-write)

```
~/.solo/plugins/
├── cache/
│   └── <marketplace>/              # "local" for user-authored; later, real marketplace names
│       └── <plugin-name>/
│           ├── local/              # sentinel: dev-time local installs win over versioned ones
│           │   └── .solo-plugin/plugin.json
│           └── 1.2.3/              # semver-keyed directory for marketplace installs (sub-project 6)
│               └── .solo-plugin/plugin.json
└── toggles.json                    # { "<marketplace>/<name>": { "enabled": bool } }
```

The `local` version-sentinel rule (from codex's `store.rs:60-81`) is preserved: if a directory literally named `local` exists for a plugin, it wins over all other versions. This makes `plugins_install_local` a simple directory copy and gives plugin authors a fluid dev-time flow.

### Read-only adapter roots (discovered, never written)

```
~/.claude/plugins/installed_plugins.json      # existing manifest Solo already reads in skills_commands.rs:210-247
~/.claude/plugins/<marketplace>/<plugin>/     # plugin dirs referenced by that manifest
~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/
```

These are walked for discovery but never written to.

### Manifest formats accepted

Three filenames, checked in priority order inside each plugin root:

1. `.solo-plugin/plugin.json` — Solo-native
2. `.codex-plugin/plugin.json` — codex-native (cross-read)
3. `.claude-plugin/plugin.json` — Claude-native (cross-read)

This mirrors codex's own multi-filename acceptance (`manifest.rs:393-544` in codex's tree). Consequence: any existing Claude or codex plugin directory on a user's machine shows up in Solo's Plugins tab on day one with zero author effort.

### Synthetic marketplace names for adapter-discovered plugins

Four reserved marketplace-segment names used when constructing `PluginId`:

- `local` — plugins in Solo's own cache (non-adapter)
- `claude-user` — plugins from the `user` scope in `~/.claude/plugins/installed_plugins.json`
- `claude-plugins` — plugins from any other scope in the same index (fallback when the index doesn't name a marketplace)
- `codex-user` — plugins from `~/.codex/plugins/`

Note: these four marketplace *identifiers* are gated by only **two** user-level adapter toggles (see `PluginsConfig` below). `adapter_claude_plugins` controls both `claude-user` and `claude-plugins` marketplaces; `adapter_codex_user` controls the single `codex-user` marketplace. Finer-grained toggling (e.g., user-scope-only vs all Claude plugins) is deferred to sub-project 3 if the UX demands it.

---

## Crate layout

A new workspace member `crates/solo-plugins/`:

```
crates/solo-plugins/
├── Cargo.toml           # No codex-* deps. Uses serde, serde_json, tokio, tracing, thiserror, dirs, chrono (if needed).
├── README.md            # License attribution to codex (Apache-2.0).
├── tests/
│   └── round_trip.rs    # End-to-end integration test.
└── src/
    ├── lib.rs           # Public API.
    ├── id.rs            # PluginId + validate_plugin_segment + PluginIdError. Forked from codex-plugin/src/plugin_id.rs.
    ├── path.rs          # AbsolutePathBuf + safe-relative-path resolver. Forked from codex-utils-absolute-path + codex-utils-plugins.
    ├── manifest.rs      # plugin.json parser. Forked from codex-rs/core-plugins/src/manifest.rs (~545 lines).
    ├── store.rs         # Local cache: install, uninstall, active_version lookup. Forked from codex-rs/core-plugins/src/store.rs (~345 lines).
    ├── adapters.rs      # NEW. Read-only discovery of ~/.claude/plugins/** and ~/.codex/plugins/.
    ├── toggles.rs       # Enabled/disabled state persisted to toggles.json. Forked from codex-rs/core-plugins/src/toggles.rs (~100 lines).
    └── loader.rs        # Orchestrator: enumerate store + adapters, merge, dedupe. NEW (codex's loader is MCP/app-heavy and not ported).
```

Codex's `remote.rs`, `marketplace.rs`, `marketplace_upgrade.rs` are **not** ported in sub-project 1.

---

## Protocol types

All new types live in `crates/solo-protocol/src/lib.rs`, derive `ts_rs::TS + serde::Serialize + serde::Deserialize`, and regenerate into `apps/desktop/src/bindings/` via `bun run gen:bindings`.

### `PluginId`

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug, Hash, PartialEq, Eq)]
#[ts(export)]
pub struct PluginId {
    pub marketplace: String,
    pub name: String,
}
```

Validation rules (enforced in `solo-plugins::id`): both segments match `[a-z0-9_-]+`, length ≤ 64, not `.` or `..`. Stringified form `marketplace/name` used for display and for `toggles.json` keys; never used as canonical for parsing because marketplace names may themselves contain `-` or `_`.

### `PluginSource`

```rust
#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PluginSource {
    Local,
    Marketplace,   // reserved; populated starting in sub-project 6
    ClaudeAdapter,
    CodexAdapter,
}
```

Derivable from `PluginId.marketplace` on the Rust side but surfaced explicitly so the frontend doesn't string-match reserved names. Uninstall is gated on `Local | Marketplace` — we never delete files we don't own.

### `PluginSummary` (list view)

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub struct PluginSummary {
    pub id: PluginId,
    pub version: String,
    pub display_name: String,            // falls back to id.name if no interface block
    pub short_description: Option<String>,
    pub logo: Option<String>,            // absolute path on disk
    pub brand_color: Option<String>,     // "#rrggbb"
    pub enabled: bool,
    pub source: PluginSource,
}
```

Eight fields (including id). This is what powers the grid tile in the Plugins tab.

### `PluginDetail` (detail view)

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub struct PluginDetail {
    pub id: PluginId,
    pub version: String,
    pub source: PluginSource,
    pub enabled: bool,
    pub root_path: String,
    pub description: Option<String>,
    pub interface: Option<PluginInterface>,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub struct PluginInterface {
    pub display_name: Option<String>,
    pub short_description: Option<String>,
    pub long_description: Option<String>,
    pub developer_name: Option<String>,
    pub category: Option<String>,
    pub capabilities: Vec<String>,
    pub website_url: Option<String>,
    pub privacy_policy_url: Option<String>,
    pub terms_of_service_url: Option<String>,
    pub default_prompts: Vec<String>,       // max 3, max 128 chars each (matching codex caps)
    pub brand_color: Option<String>,
    pub composer_icon: Option<String>,      // absolute path
    pub logo: Option<String>,               // absolute path
    pub screenshots: Vec<String>,           // absolute paths
}
```

Mirrors codex's `PluginManifestInterface` (`manifest.rs:48-64`), with two deliberate simplifications: `default_prompt: Option<Vec<String>>` becomes `default_prompts: Vec<String>` (empty vec = no prompts), and all `AbsolutePathBuf` become `String` at the wire boundary (ts-rs can't express Rust newtypes).

### `PluginInstallResult`

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub struct PluginInstallResult {
    pub id: PluginId,
    pub version: String,
    pub root_path: String,
}
```

### `PluginListOutcome` and `PluginLoadError`

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub struct PluginListOutcome {
    pub plugins: Vec<PluginSummary>,
    pub errors: Vec<PluginLoadError>,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub struct PluginLoadError {
    pub path: String,
    pub message: String,
}
```

This shape is load-bearing: one malformed plugin must never cause the full list to fail. Users with 40 working Claude plugins and 1 malformed one see 40 plugins and 1 warning, not a blank tab.

### `PluginsConfig`

Stored in `solo_core::settings` (same mechanism as `SkillsConfig`), not in `toggles.json`.

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug, Default)]
#[ts(export)]
pub struct PluginsConfig {
    #[serde(default = "default_true")]
    pub adapter_claude_plugins: bool,
    #[serde(default = "default_true")]
    pub adapter_codex_user: bool,
}
```

Two-layer toggle model: coarse adapter on/off lives in settings, fine per-plugin on/off lives in `toggles.json`.

### Internal error type (Rust-only, not on wire)

```rust
#[derive(thiserror::Error, Debug)]
pub enum PluginError {
    #[error("invalid plugin id: {0}")]
    InvalidId(#[from] PluginIdError),
    #[error("invalid manifest at {path}: {message}")]
    InvalidManifest { path: PathBuf, message: String },
    #[error("plugin not found: {0}/{1}")]
    NotFound(String, String),
    #[error("plugin {0}/{1} is already installed")]
    AlreadyInstalled(String, String),
    #[error("cannot modify adapter-discovered plugin {0}/{1}")]
    AdapterReadOnly(String, String),
    #[error("io error at {path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
}
```

Flattened to `String` only at the Tauri boundary.

---

## Tauri command surface

Five commands in a new `apps/desktop/src-tauri/src/plugins_commands.rs`, registered in `lib.rs`. Matching TS wrapper at `apps/desktop/src/lib/tauri/plugins.ts`. No `BackendEvent` variants in sub-project 1.

```rust
/// Enumerate every plugin visible from every enabled source.
#[tauri::command]
async fn plugins_list(cwd: String, state: State<'_, PluginsState>)
    -> Result<PluginListOutcome, String>;

/// Full manifest detail. Reparses plugin.json on each call so local edits show up without restart.
#[tauri::command]
async fn plugins_get_detail(id: PluginId, state: State<'_, PluginsState>)
    -> Result<PluginDetail, String>;

/// Flip enabled=true/false in toggles.json. Returns new summary so frontend can update without full list refresh.
#[tauri::command]
async fn plugins_set_enabled(id: PluginId, enabled: bool, state: State<'_, PluginsState>)
    -> Result<PluginSummary, String>;

/// Copy a directory into ~/.solo/plugins/cache/local/<name>/local/. Validates manifest first;
/// <name> is taken from the manifest's `name` field, falling back to the source directory's basename
/// if the manifest name is empty (matches codex manifest.rs:131-136 behavior).
/// Rejects if `local/<name>` already exists; the caller is expected to uninstall first.
#[tauri::command]
async fn plugins_install_local(source_path: String, state: State<'_, PluginsState>)
    -> Result<PluginInstallResult, String>;

/// Delete a plugin from Solo's own cache. Refuses for adapter-discovered plugins.
#[tauri::command]
async fn plugins_uninstall(id: PluginId, state: State<'_, PluginsState>)
    -> Result<(), String>;
```

### State management

```rust
pub struct PluginsState {
    solo_home: PathBuf,
    cache: RwLock<Option<Vec<PluginSummary>>>,
}
```

Managed via `.manage(PluginsState::new(...))` in `lib.rs`. The cache is a simple staleness optimization; every write command invalidates by setting `cache = None`.

### TS wrapper

```typescript
// apps/desktop/src/lib/tauri/plugins.ts
import { invoke } from '@tauri-apps/api/core';
import type {
  PluginId, PluginSummary, PluginDetail,
  PluginListOutcome, PluginInstallResult,
} from '@/bindings';

export const pluginsApi = {
  list: (cwd: string) =>
    invoke<PluginListOutcome>('plugins_list', { cwd }),
  getDetail: (id: PluginId) =>
    invoke<PluginDetail>('plugins_get_detail', { id }),
  setEnabled: (id: PluginId, enabled: boolean) =>
    invoke<PluginSummary>('plugins_set_enabled', { id, enabled }),
  installLocal: (sourcePath: string) =>
    invoke<PluginInstallResult>('plugins_install_local', { sourcePath }),
  uninstall: (id: PluginId) =>
    invoke<void>('plugins_uninstall', { id }),
};
```

No Zustand store in sub-project 1 — that's sub-project 3's work.

---

## Discovery pipeline

`solo_plugins::loader::list_plugins(config: &PluginsConfig, solo_home: &Path) -> PluginListOutcome`:

1. **Scan Solo's own cache** at `~/.solo/plugins/cache/<marketplace>/<name>/<version>/`. For each discovered plugin dir, construct `PluginId { marketplace, name }`, determine active version via the `local`-wins rule from `store.rs`, and tag `source` as `Local` (if `marketplace == "local"`) or `Marketplace` otherwise. In sub-project 1 the `Marketplace` branch is effectively unreachable since no marketplace install path exists yet — the enum variant is reserved for sub-project 6.

2. **If `config.adapter_claude_plugins`**: parse `~/.claude/plugins/installed_plugins.json`. For each install entry, derive `PluginId { marketplace: <from index or "claude-plugins" fallback; "claude-user" if the scope is "user">, name: <dir-name> }`, tag `source = ClaudeAdapter`. Version is read from the manifest's top-level `version` field if present; otherwise the constant `"local"`. Adapter plugins live in their own directory (not a version-subdir), so there's no version-directory to scan.

3. **If `config.adapter_codex_user`**: walk `~/.codex/plugins/cache/<marketplace>/<name>/<version>/` using codex's own layout. Tag `source = CodexAdapter`. Version is the directory segment.

4. **For each discovered root**, call `manifest::load_plugin_manifest`. On success → produce `PluginSummary`. On parse failure → produce `PluginLoadError` with the manifest path and error message.

5. **Merge by `PluginId`**. Collision rule: **first-wins in discovery order**. Solo-native beats Claude beats Codex. Same name across marketplaces doesn't collide (different `marketplace` segment = different `PluginId`).

6. **Load `toggles.json`**. For each plugin, set `enabled = toggles.get(&id).unwrap_or(true)`. Adapter plugins default-enabled; this matches user expectation ("plugins I installed in Claude are already chosen, keep them on").

7. **Sort**: enabled first, then alphabetical by `display_name`.

### Claude plugins adapter specifics

`installed_plugins.json` format (as of 2026-04):

```json
{
  "plugins": {
    "<scope>": [
      { "installPath": "/path/to/plugin-dir", "marketplaceName": "<mk>", ... }
    ]
  }
}
```

`solo-plugins` parses this independently of `skills_commands.rs` (no shared code path). `marketplaceName` from the index is preserved in `PluginId.marketplace`; if absent, falls back to `claude-plugins`.

---

## Error handling

Three tiers, each with a distinct audience:

1. **IPC boundary** — `Result<T, String>` via `format!("{err}")`. Frontend renders as toast.
2. **Per-plugin load errors** — surfaced in `PluginListOutcome.errors`. Never fatal for the list operation.
3. **Rust-internal `PluginError`** — structured `thiserror` enum, flattened to `String` only at the Tauri boundary.

**Non-error absences**: missing `~/.solo/plugins/cache/` → empty list. Missing `toggles.json` → empty map. Missing `~/.claude/plugins/` → adapter contributes zero plugins.

### Logging

`tracing` crate with three levels:

- `debug!` — "scanned <root>, found N plugins"
- `warn!` — per-plugin parse failure, recoverable errors
- `error!` — state that blocks the crate from functioning (e.g., cannot create `~/.solo/plugins/`)

---

## Testing strategy

### Unit tests (co-located, `#[cfg(test)]`)

- **`manifest.rs`** — port the input strings from codex's `manifest.rs::tests`: `write_manifest` helper, default-prompt edge cases (legacy string, array, normalization, length caps, invalid shapes), trimmed-version behavior, alternate-path discovery. Add Solo-specific cases: the `.solo-plugin/` path accepted, plugin name validation.
- **`id.rs`** — exhaustive validation: valid segments, rejected characters, max length, reserved names, traversal attempts (`../evil`).
- **`store.rs`** — port codex's `store_tests.rs` patterns: tempdir-based install → list → uninstall cycle; `local` version-sentinel precedence; multi-version coexistence.
- **`toggles.rs`** — persist-and-reload; missing-file tolerance; unknown-plugin entries silently ignored on load.
- **`adapters.rs`** — fake `installed_plugins.json` in tempdir; malformed JSON produces zero plugins plus one `PluginLoadError`; missing directory produces empty list silently.
- **`loader.rs`** — the merge rule. Construct tempdirs standing in for Solo cache + Claude adapter, put the same plugin name in both, assert Solo wins. Different plugins in each → both appear.

### Integration test (`crates/solo-plugins/tests/round_trip.rs`)

Build a temp `SOLO_HOME`, install a fixture plugin directory, list, toggle, get detail, uninstall, list-is-empty.

### Not tested in sub-project 1

- Concurrent `toggles.json` writes (single-writer assumption; revisit if multi-window).
- Real Claude plugin directories (all adapter tests use synthetic fixtures).
- Windows-specific behavior beyond what codex tests already cover. Manual smoke test on Windows before sub-project 6 ships.

---

## Out of scope (deferred to later sub-projects)

1. **No UI.** Skills tab unchanged. No Plugins sidebar item, no `PluginsView`. Sub-project 1 is exercisable only via devtools `invoke(...)` and unit/integration tests.
2. **No skill unification.** `skills_commands.rs::discover_claude_plugins` keeps running. Sub-project 2 replaces it with a call into `solo-plugins::loader`.
3. **No MCP runtime.** The `mcpServers` field in `plugin.json` is parsed into the manifest (for forward-compat) but ignored by the loader. No `McpServerConfig` in `solo-protocol`.
4. **No app connectors.** Same treatment as MCP: `apps` field parsed, ignored.
5. **No remote install.** `plugins_install_local` is the only install path.
6. **No marketplace discovery.** `marketplace.json` files ignored; `PluginId.marketplace` is just a string for now.
7. **No Create / author flow.** Sub-project 7.
8. **No telemetry.** No analytics events, no usage counters.

---

## Acceptance criteria

Sub-project 1 is "done" when all of the following are true:

- `bun run check` (cargo check + tsc) passes.
- `cargo test -p solo-plugins` passes, including the integration test.
- `cargo clippy --workspace` is clean (no new warnings).
- `bun run gen:bindings` has been run; `apps/desktop/src/bindings/` contains the new types with no hand-edits.
- From the app's devtools console, with a fixture plugin directory on disk:
  - `await window.__TAURI__.core.invoke('plugins_list', {cwd: '/…'})` returns the fixture.
  - `plugins_set_enabled` flips the state and subsequent `plugins_list` reflects it.
  - `plugins_uninstall` removes it.
- The existing Skills tab and agent loop are byte-identical in behavior (no regressions).

---

## Open questions (for implementation phase)

1. Workspace-scoped plugin dirs (`{cwd}/.solo/plugins/`) — include in sub-project 1 or push to sub-project 3? Leaning push, but callable cheaply if it emerges as a natural split point.
2. Whether to emit a `BackendEvent::PluginsChanged` when `set_enabled`/`install`/`uninstall` succeed, to support future multi-view consistency. Currently: no events in sub-project 1, frontend polls via `list`.
