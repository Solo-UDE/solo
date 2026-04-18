# Solo Plugins — SP6: Remote Install + Marketplace Design Specification

**Date:** 2026-04-18
**Status:** Draft (for user review)
**Scope:** Sub-project 6 of 7 in the broader Solo Plugins initiative
**Estimated effort:** 3–4 weeks
**Depends on:** SP1 (foundation crate) ✓, SP3 (plugins UI) ✓
**Parallel with:** SP4 ✓, SP5 (no dependency either way)
**Prior docs:**
- SP1 design: `specs/2026-04-17-solo-plugins-foundation-design.md`
- SP4 design: `specs/2026-04-18-solo-plugins-sp4-mcp-design.md`
- SP5 design: `specs/2026-04-18-solo-plugins-sp5-app-connectors-design.md`

---

## Context

SP1 shipped local plugin installs (`plugins_install_local` copies a directory into `~/.solo/plugins/cache/local/<name>/local/`). The `PluginSource::Marketplace` enum variant exists but is unreachable. SP6 makes it reachable: users install plugins from git URLs, browse a catalog, and upgrade to new versions.

### Prior art — what we port, what we skip

Codex's `core-plugins` crate has three relevant modules (verified 2026-04-18 subagent scan of `Inspirations/codex/codex-rs/core-plugins/`):

- **`marketplace.rs`** (580 lines) — reads `marketplace.json` index files at `.agents/plugins/marketplace.json` or `.claude-plugin/marketplace.json`. Entry format: `{ name, interface?, plugins: [{ name, source, policy, category? }] }`. Plugin entries carry installation policy (`NOT_AVAILABLE | AVAILABLE | INSTALLED_BY_DEFAULT`) and authentication policy (`ON_INSTALL | ON_USE`).
- **`marketplace_upgrade.rs`** (298 lines) + `git.rs` (239 lines) — git-based upgrade semantics. Uses `git rev-parse HEAD` + `git ls-remote <source> <ref>` to detect new revisions. Supports sparse-checkout for large repos. Shells out to `git` binary, not a Rust library. One-shot polling (no background service).
- **`remote.rs`** (317 lines) — **not relevant to SP6**. Codex's `remote.rs` is a ChatGPT-specific status sync against OpenAI's plugin API (Bearer auth, `reqwest`). It is not git install. **SP6 does not port it.** Skipping it is a deliberate and load-bearing choice — keep this crate Solo-sovereign, not tied to any vendor backend.

### Scope framing

There are three distinct capabilities sometimes conflated as "marketplace":

1. **Install from URL** — one-off git clone of a plugin repo.
2. **Marketplace index** — a curated list of plugins (from a JSON index at a git URL or HTTP URL) users can browse.
3. **Upgrade** — move an installed plugin to a newer revision.

SP6 ships all three, but the indirection matters: (1) is the primitive, (2) is a browse UI on top of (1), and (3) is a re-exec of (1) with a diff check.

### Where SP6 lands

```
SP1 foundation ✓ → SP2 wiring ✓ → SP3 UI ✓
                                    ↓
                                  SP6 marketplace + remote install ← (this doc)
                    ↓
                  SP4 MCP ✓   SP5 app connectors
```

SP6 has **no dependency on SP4 or SP5**. Plugins installed via SP6 light up MCP (SP4) and apps (SP5) automatically because those run on plugin-enable, not on install-origin.

---

## Scope decision

| Scope | What's in | What's out | Effort |
|---|---|---|---|
| **Small** | Install-from-git only (one-off), no browse, no upgrade | Marketplace index, upgrade, built-in catalog | ~1 week |
| **Medium (chosen)** | Install-from-git + `marketplace.json` index browsing + one-shot upgrade | Multiple-index federation, auto-update background service, version pinning | ~3 weeks |
| **Large** | Medium + background upgrade polling + pinning + index federation + signed plugins | — | ~6+ weeks |

**Why medium:** Install-from-git alone is useful but anemic; users want to discover plugins without hunting GitHub. The `marketplace.json` index format is codex-compatible, so existing Claude/codex marketplaces work out of the box. Upgrade is small once git plumbing exists. Signed plugins + background polling are real-user features but the wrong priority for sub-project 6.

**Rejected alternatives:**

- **"Just install from URL, no marketplace"** — user-unfriendly; pushes discovery back to Discord/Twitter.
- **"Background auto-update service"** — creeping complexity for edge-case value. One-shot "Check for updates" button is fine in SP6.
- **"Code-signing / signature verification"** — sensible, but requires key infrastructure and a trust model we haven't settled. Noted as SP6.5.

---

## What ships in SP6

1. **`remote.rs`** — *new module* in `solo-plugins`. Git transport (shells out to `git`), repo-to-plugin-root probing, install-to-cache, basic validation.
2. **`marketplace.rs`** — ports codex's module with two Solo-specific changes: marketplace sources are local files *or* git URLs (codex reads local only); marketplace metadata includes a `icon` for the UI tile.
3. **`marketplace_upgrade.rs`** — ports codex's git upgrade logic.
4. **Protocol types** — `MarketplaceIndex`, `MarketplaceEntry`, `InstallFromGitRequest`, `UpgradeOutcome`, `MarketplaceSource`.
5. **Tauri command surface** — seven commands.
6. **Zustand store** — `marketplaceStore.ts` (parallel to `pluginsStore.ts`).
7. **UI** — new "Browse" tab in the Plugins panel: grid of marketplace entries, install button, installed-state badges. Existing Plugins tab gets an "Upgrade available" chip.
8. **Built-in Solo marketplace** — one curated index at `https://github.com/Solo-UDE/solo-marketplace` (or similar). Ships pre-subscribed.
9. **"Install from URL" entry point** — modal in Plugins tab: paste a git URL, install.
10. **Promotion to top-level sidebar** (deferred from SP3) — the Plugins panel becomes a first-class sidebar item, with Installed / Browse sub-tabs. Optional polish; can also stay inside Settings.

---

## On-disk surface (extends SP1's)

```
~/.solo/plugins/
├── cache/
│   └── <marketplace>/
│       └── <plugin-name>/
│           ├── local/                         # SP1 dev installs
│           │   └── .solo-plugin/plugin.json
│           └── <version>/                     # SP6 — git-installed versions
│               ├── .solo-plugin/plugin.json
│               └── .solo-install.json         # SP6 — install provenance (NEW)
├── marketplaces/
│   ├── subscriptions.json                     # SP6 — which marketplace indexes the user subscribes to (NEW)
│   └── cache/
│       └── <marketplace-name>/
│           └── marketplace.json               # SP6 — cached index copy (NEW)
└── toggles.json                               # SP1 unchanged
```

### `<version>` directory naming

Version is the **git ref's resolved commit SHA (first 12 chars)**, not the tag or branch name. Rationale:

- Two different SHAs shouldn't share a directory even if they were both tagged `v1.0`.
- Tag renames/force-pushes would cause silent drift if tag-named.
- The `.solo-install.json` preserves the human-readable `requested_ref` separately.

### `.solo-install.json` — install provenance

```json
{
  "source": {
    "kind": "git",
    "url": "https://github.com/example/my-plugin.git",
    "requested_ref": "v1.2.3",
    "resolved_sha": "abcd1234ef56"
  },
  "marketplace": "solo-official",
  "installed_at": "2026-04-18T14:30:00Z",
  "installed_by": "user",
  "last_upgrade_check": "2026-04-18T14:30:00Z"
}
```

This file is **owned by Solo**, not the plugin. It enables:
- Upgrade checks (know what ref to query).
- Source disclosure in the Plugins tab detail drawer.
- Reproducible reinstall if the cache is wiped.

### Subscriptions

```json
{
  "subscriptions": [
    {
      "name": "solo-official",
      "source": {
        "kind": "git",
        "url": "https://github.com/Solo-UDE/solo-marketplace.git",
        "ref": "main",
        "manifest_path": ".solo-marketplace/marketplace.json"
      },
      "subscribed_at": "2026-04-18T10:00:00Z",
      "last_synced_at": "2026-04-18T14:00:00Z"
    }
  ]
}
```

The Solo-official marketplace is added to this file at app first-run (code-migrated).

### Marketplace cache

A subscribed marketplace's index is mirrored locally so the Browse tab is instant (no network on open). Refreshed on demand via a "Refresh" button and on app start (async, non-blocking).

---

## Protocol types

### Marketplace source

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MarketplaceSource {
    #[serde(rename = "git")]
    Git {
        url: String,
        /// Branch, tag, or SHA. Defaults to the repo's default branch.
        #[serde(default)]
        r#ref: Option<String>,
        /// Path inside the repo where the marketplace.json lives.
        /// Defaults to ".solo-marketplace/marketplace.json".
        #[serde(default)]
        manifest_path: Option<String>,
    },
    #[serde(rename = "local")]
    Local {
        path: String,       // absolute path to a directory containing marketplace.json
    },
}
```

### Marketplace index & entry

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceIndex {
    pub name: String,                           // globally unique marketplace name
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,                   // absolute path after local cache
    pub plugins: Vec<MarketplaceEntry>,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceEntry {
    pub name: String,                            // becomes PluginId.name on install
    pub source: PluginInstallSource,             // where to clone from
    pub category: Option<String>,
    pub short_description: Option<String>,
    pub author: Option<String>,
    pub website_url: Option<String>,
    pub icon: Option<String>,                    // URL or relative path
    pub policy: MarketplaceEntryPolicy,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PluginInstallSource {
    #[serde(rename = "git")]
    Git {
        url: String,
        #[serde(default)]
        r#ref: Option<String>,
        /// Path inside the repo where the plugin root is.
        /// Defaults to "." (repo root).
        #[serde(default)]
        subpath: Option<String>,
    },
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceEntryPolicy {
    pub installation: MarketplaceInstallationPolicy,
    pub authentication: MarketplaceAuthPolicy,
}

#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum MarketplaceInstallationPolicy {
    NotAvailable,               // listed for awareness, not installable by user
    Available,
    InstalledByDefault,         // Solo ships with this one; auto-installed on first run
}

#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum MarketplaceAuthPolicy {
    OnInstall,                   // SP5 providers auth at install time
    OnUse,                       // auth deferred until first use
}
```

### Install, list, upgrade IO

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct InstallFromGitRequest {
    pub url: String,
    #[serde(default)]
    pub r#ref: Option<String>,
    #[serde(default)]
    pub subpath: Option<String>,
    /// Marketplace attribution for the install. Defaults to "url" for ad-hoc installs.
    #[serde(default)]
    pub marketplace: Option<String>,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeOutcome {
    pub plugin_id: PluginId,
    pub previous_version: String,
    pub new_version: String,
    pub was_noop: bool,               // true if the remote ref was unchanged
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceListOutcome {
    pub indexes: Vec<MarketplaceIndex>,
    pub errors: Vec<MarketplaceLoadError>,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub struct MarketplaceLoadError {
    pub marketplace_name: String,
    pub message: String,
}
```

### Extension to `PluginSummary`

```rust
pub struct PluginSummary {
    // ... SP1 + SP4 + SP5 fields ...
    /// For marketplace-installed plugins: the git URL + ref they came from.
    pub origin: Option<PluginOrigin>,
    /// `Some(newVersion)` if an upgrade is available; `None` otherwise.
    pub upgrade_available: Option<String>,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PluginOrigin {
    pub marketplace: String,
    pub url: String,
    pub requested_ref: Option<String>,
    pub resolved_sha: String,
}
```

---

## Module layout inside `solo-plugins`

```
crates/solo-plugins/src/
├── (SP1 files unchanged)
├── mcp.rs                   # SP4
├── apps.rs                  # SP5
├── remote.rs                # SP6 — git transport + install-from-url
├── marketplace.rs           # SP6 — index reading + subscriptions
└── marketplace_upgrade.rs   # SP6 — upgrade checks + apply
```

The `remote.rs` name is reused from codex for continuity, but its **meaning is different**: Solo's `remote.rs` is git-install; codex's was ChatGPT-status-sync.

---

## Git transport

**Shells out to `git` binary** (matching codex's approach). Rationale:

- Users already have `git` on any dev box.
- Rust git libraries (`gix`, `git2`) are heavy and their API surface is larger than needed here.
- Shelling out gives native credential-helper integration (users' existing GitHub/GitLab creds just work).

Core operations:

```rust
pub(crate) async fn git_clone(url: &str, r#ref: Option<&str>, dest: &Path) -> Result<String, GitError>;
pub(crate) async fn git_ls_remote(url: &str, r#ref: Option<&str>) -> Result<String, GitError>;
pub(crate) async fn git_rev_parse_head(dir: &Path) -> Result<String, GitError>;
```

Each is a `tokio::process::Command` invocation of `git` with a 60s default timeout (30s matched codex; bumped for flaky network robustness). Stderr is captured for error messages.

### Clone-then-probe flow

Install-from-git works in four steps:

1. **Clone to a staging directory** under `~/.solo/plugins/cache/.tmp/<uuid>/` at the requested ref.
2. **Run `git rev-parse HEAD`** in the staging dir to resolve the full SHA.
3. **Probe the plugin root**: if `subpath` is given, use that; else use the repo root. Validate `.solo-plugin/plugin.json` (or `.codex-plugin/` or `.claude-plugin/`) exists by calling `find_plugin_manifest_path` from SP1.
4. **Move** staging → `~/.solo/plugins/cache/<marketplace>/<plugin-name>/<sha12>/`. Delete the staging tree on any failure path.

### Authentication for private repos

- HTTPS with stored credentials — `git`'s credential helper handles it transparently.
- SSH URLs — `ssh-agent` handles it transparently.
- OAuth tokens for git hosts — **not in SP6.** If a user needs OAuth-backed GitHub installs, they fall back to HTTPS-with-PAT via credential helper. SP5's token store could in principle be extended, but it's out of scope here.

---

## Marketplace flow

### Subscribing

On app first-run, `solo-official` is seeded in `subscriptions.json`. Users can add more via a "Add marketplace" modal that accepts a git URL. Subscriptions are user-editable JSON, not magic.

### Sync

`marketplace::sync_subscription(name)`:

1. Git-clone (or pull) the subscription into `~/.solo/plugins/marketplaces/cache/<name>/`.
2. Read `<manifest_path>` from the cloned tree.
3. Validate index structure; reject (with `MarketplaceLoadError`) if malformed.
4. Copy validated `marketplace.json` to a stable spot.
5. Update `last_synced_at`.

**Sync runs:**
- On `marketplace_refresh` command (user clicked refresh).
- On app start, async, non-blocking.
- Never as a background timer (deliberate; keeps the model simple).

### Browse

`marketplace_list` returns all cached indexes + per-plugin install state (installed / installable / installed-with-upgrade). The UI grid renders tiles from this data.

### Install (via marketplace tile)

Thin wrapper around `remote::install_from_git`:

```rust
plugins_install_from_marketplace(marketplace: String, entry_name: String) → PluginInstallResult
```

Looks up the entry in the cached index, reads its `source`, and hands off to `install_from_git`.

### Install (ad-hoc by URL)

```rust
plugins_install_from_url(request: InstallFromGitRequest) → PluginInstallResult
```

No index involvement. `marketplace` in `.solo-install.json` defaults to `"url"` to disambiguate from curated marketplaces.

---

## Upgrade flow

`marketplace_upgrade::check_upgrade(plugin_id) → Option<String>`:

1. Read `.solo-install.json` for the plugin.
2. If `source.kind != git`, return `None` (ad-hoc / local plugins don't upgrade).
3. Call `git_ls_remote(url, requested_ref)`.
4. If the remote SHA equals `resolved_sha`, return `None` (nothing to upgrade).
5. Else return `Some(new_sha_short)`.

`marketplace_upgrade::apply_upgrade(plugin_id) → UpgradeOutcome`:

1. Re-run `install_from_git` with the same `url + ref` (pulls the new SHA).
2. New install lands under a new `<sha12>` directory; both old and new coexist briefly.
3. Flip `active_plugin_version` via the SP1 `store.rs` logic (semver-sort picks the new SHA — but SHAs aren't semver-comparable, so see the gotcha below).
4. Optionally prune the old version directory after a grace period (not in SP6 — manual cleanup is fine).

### Gotcha: SHA-versioned directories break semver sort

SP1's `active_plugin_version` picks the highest-semver directory name (falling back to `local` sentinel). `abcd1234ef56` is not semver-orderable against `deadbeef1234`. Two fixes considered:

- **A (proposed):** store a `current_version` pointer in `.solo-install.json` and have the SP1 store preferentially read that. Falls back to semver-sort for locally-installed (non-SP6) plugins.
- **B:** use a monotonic counter (`v1`, `v2`, …) instead of SHA. Loses traceability, wins simplicity.

**Chosen A.** It requires a small change to SP1's `active_plugin_version` to consult the pointer file, but keeps SHA-named directories for traceability. The SP1 interface stays source-compatible for local installs.

---

## Tauri command surface

Seven new commands:

```rust
#[tauri::command]
async fn plugins_install_from_url(request: InstallFromGitRequest, state: …)
    -> Result<PluginInstallResult, String>;

#[tauri::command]
async fn plugins_install_from_marketplace(marketplace: String, entry_name: String, state: …)
    -> Result<PluginInstallResult, String>;

#[tauri::command]
async fn plugins_check_upgrade(id: PluginId, state: …)
    -> Result<Option<String>, String>;

#[tauri::command]
async fn plugins_apply_upgrade(id: PluginId, state: …)
    -> Result<UpgradeOutcome, String>;

#[tauri::command]
async fn marketplace_list(state: …)
    -> Result<MarketplaceListOutcome, String>;

#[tauri::command]
async fn marketplace_refresh(name: Option<String>, state: …)
    -> Result<(), String>;     // name=None refreshes all

#[tauri::command]
async fn marketplace_subscribe(source: MarketplaceSource, state: …)
    -> Result<MarketplaceIndex, String>;
```

### BackendEvent extensions

```rust
pub enum BackendEvent {
    // ...
    MarketplaceSyncStarted { name: String },
    MarketplaceSyncCompleted { name: String, entry_count: u32 },
    MarketplaceSyncFailed { name: String, error: String },
    PluginInstallStarted { url: String },
    PluginInstallProgress { url: String, stage: InstallStage },
    PluginInstallCompleted { plugin_id: PluginId },
    PluginInstallFailed { url: String, error: String },
}

pub enum InstallStage {
    Cloning,
    Probing,
    Validating,
    Finalizing,
}
```

Progress events let the UI show a meaningful indicator during the ~5–15s a git clone can take.

---

## Frontend

### Tab structure

Two sub-tabs inside the Plugins panel:

- **Installed** (default) — the existing SP3 grid, augmented with "Upgrade available" chips.
- **Browse** — marketplace tiles. Category filter on the left, search bar on top, install buttons.

A "Add marketplace" pill at the bottom of the Browse view opens the subscribe modal. A "Install from URL" button in the Installed view opens the ad-hoc install modal.

### Sidebar promotion (optional)

Originally planned for SP3 but deferred. SP6 is the natural moment: with Browse + Installed + marketplace management, Plugins deserves top-level sidebar real estate instead of nesting inside Settings. If the sidebar nav is tight, this can stay in Settings — decision can defer to implementation.

### Install UX

1. User clicks "Install" on a marketplace tile.
2. Tile flips to a progress state with the stage (Cloning… → Probing… → Done).
3. On success: the plugin appears in Installed tab, toast "Installed X. Enable it in Plugins."
4. On failure: tile returns to pre-install state with a red banner (details in Toast).

Installed plugins aren't auto-enabled. (Aligned with SP1's toggle model.)

### Upgrade UX

- The Installed tile shows an "Upgrade available → v<new>" chip when `upgrade_available.is_some()`.
- Clicking the chip opens a confirm dialog (with a changelog link if the plugin author provided one via repo tags — out of scope; stub).
- On confirm, run `plugins_apply_upgrade`, stream progress events, refresh the tile.

Upgrade checks run:
- On app start (async, non-blocking, rate-limited — one `git ls-remote` per installed plugin with a 30-minute local cache of the last check).
- When the user clicks "Check for updates" in the Plugins tab header.

---

## Error handling

Six distinct failure classes:

1. **Network/git errors** — `git clone` / `git ls-remote` failures. Surfaced to the user in plain language ("Couldn't reach GitHub"); stderr attached as a "Details" fold-out.
2. **Invalid plugin root** — clone succeeded but no manifest found at the subpath. Clear error: "Not a Solo plugin (no plugin.json)." Staging directory cleaned up.
3. **Malformed marketplace index** — JSON parse error, invalid plugin entries. Recorded in `MarketplaceListOutcome.errors`, never fatal for the list operation.
4. **Collisions** — install-from-git of a plugin that's already installed at the same SHA → return the existing `PluginInstallResult` as no-op. Different SHA → allow (SP1's multi-version coexistence applies). Different source URL but same PluginId → error: "Different plugin than the one installed under this name; uninstall first."
5. **Subscription management errors** — can't reach marketplace repo on add → error, not added. On refresh → keep stale cache, record error.
6. **Upgrade errors** — if `apply_upgrade` fails mid-way, the old version is unharmed (new version landed under a fresh SHA dir that gets cleaned up). User can retry.

### Non-errors (silent handling)

- Marketplace's `marketplace.json` missing fields → permissive parse, warn at `debug!`.
- Upgrade check on an ad-hoc URL-installed plugin with no `.solo-install.json` → skip (no provenance to use).
- Git clone of a very large repo → proceeds but with sparse-checkout hint in docs (not enforced automatically).

---

## Security considerations

**Arbitrary command execution in a cloned repo.** Cloning a git repo is safe (git itself has been hardened for decades against malicious repos — `core.fsmonitor`, `core.hooksPath`, etc., are all no-op on clone). SP6 inherits git's threat model, which is well-studied.

**`plugin.json` + MCP = code execution.** A marketplace plugin can declare MCP servers that execute arbitrary commands on enable (SP4). This is the real attack surface. Mitigations:

1. **Curation of the Solo-official marketplace** — human review of every PR adding a plugin entry. Explicit in the marketplace repo's contribution guide.
2. **Source disclosure in the UI** — every plugin tile shows "From marketplace: X" and every install shows the git URL being cloned. User can inspect before installing.
3. **Enable gating** — installed ≠ enabled. User must explicitly turn on each plugin before any code runs (SP1's `toggles.json` invariant holds).
4. **No auto-install of MCP tools** — plugins with MCP never run on install; they run on first enable + session create (SP4).
5. **No auto-update** — upgrades are user-initiated. Supply-chain attacks via compromised repo don't silently land.

**Cross-site cookie leakage on git clone.** Git credential-helper can be configured to hand credentials to any URL; malicious redirects theoretically could harvest creds. Mitigation: no special config — inherits the user's existing git trust decisions.

**Deferred to SP6.5:** code signing, attestation of the marketplace index (signed by Solo for the official index), Sigstore-style provenance.

---

## Testing strategy

### Unit tests

- **`remote.rs::install_from_git`** — tempdir clone from a local bare repo; SHA resolution; invalid-plugin rejection; staging cleanup on failure.
- **`remote.rs` failure paths** — nonexistent URL, ref not found, invalid plugin root. Each produces a clean error with no orphaned directories.
- **`marketplace.rs::parse_index`** — valid, malformed JSON, invalid fields, missing fields (tolerant), unknown fields (tolerant).
- **`marketplace.rs::subscribe + sync`** — round-trip with a local bare repo standing in for a marketplace.
- **`marketplace_upgrade.rs`** — no-op case (SHA unchanged), upgrade-available case, apply-upgrade happy path, apply-upgrade rollback.
- **`store.rs` pointer integration** — `active_plugin_version` reads `.solo-install.json`'s pointer if present, falls back to semver-sort.

### Integration test (`crates/solo-plugins/tests/marketplace_round_trip.rs`)

Use `tempfile::tempdir()` to stand up both a local bare git repo (as a plugin) and another local bare repo (as a marketplace index pointing to the first). Subscribe to the marketplace, list it, install the plugin, verify it appears in `plugins_list` with correct origin. Upgrade it (force-push the bare repo to a new SHA) and verify `check_upgrade` + `apply_upgrade` behave correctly.

### Smoke test (manual, pre-merge)

1. Add `https://github.com/Solo-UDE/solo-marketplace` as a subscription (or use the seeded default).
2. Browse → install the first plugin listed.
3. Enable it, run a session, verify its MCP/skills work (SP4/SP2 path).
4. Force a new revision in the marketplace plugin repo.
5. Click "Check for updates" → chip appears → click upgrade → new version installed, old version still on disk, active pointer flipped.
6. Install an ad-hoc plugin via "Install from URL" (any small public Solo plugin repo).
7. Uninstall that → verify both the cache dir and `.solo-install.json` removed.

### Not tested in SP6

- Private-repo auth (manual test on a private fixture).
- Extremely large repos (>100 MB) — sparse-checkout heuristic needed, out of scope.
- Background upgrade polling — SP6 has no background service.
- Index federation / search across marketplaces — single-marketplace UI only.

---

## Out of scope

1. **Background upgrade polling** — user-initiated only.
2. **Code signing / attestation** — SP6.5.
3. **Version pinning / lockfile** — all installs float at whatever ref was requested; if `ref=main`, upgrades follow main.
4. **Multi-account git credentials** — inherits whatever `git` already has configured.
5. **Search across marketplaces** — each marketplace is browsed independently.
6. **Plugin bundles / groups** — marketplace entries are flat.
7. **Telemetry on installs** — no analytics events in SP6.
8. **OAuth-based git hosts** (install plugins from private repos using SP5's token store) — not in SP6.

---

## Acceptance criteria

- `bun run check` + `cargo test -p solo-plugins` pass.
- `cargo clippy --workspace` clean.
- `bun run gen:bindings` has been run; new types in `apps/desktop/src/bindings/`.
- Devtools smoke with the Solo-official marketplace seeded:
  - `marketplace_list()` returns the index with one or more plugins.
  - `plugins_install_from_marketplace(...)` completes; the plugin appears in `plugins_list`.
  - `plugins_check_upgrade(id)` returns `None` for a just-installed plugin.
  - Forcing a new SHA in the repo, `plugins_check_upgrade` returns `Some(newSha)`; `plugins_apply_upgrade` applies it.
  - `plugins_install_from_url` works for an ad-hoc URL.
- UI:
  - Browse tab renders the marketplace grid.
  - Install flow shows progress and succeeds.
  - Upgrade chip appears when applicable.
- No regressions: SP1 local installs still work; SP4 MCP still works; SP5 apps still work.

---

## Open questions (for implementation phase)

1. **SHA-pointer vs semver-sort in `active_plugin_version`.** Proposed pointer-first. Requires changing SP1 code — is that acceptable, or do we duplicate the logic in a SP6-specific resolver?
2. **Where does the Solo-official marketplace repo live?** `https://github.com/Solo-UDE/solo-marketplace` proposed; needs an owner decision + initial curation.
3. **How many plugins ship in the Solo-official marketplace at SP6 launch?** Minimum useful catalog: 3–5 genuinely useful plugins. Who owns assembling this?
4. **Progress events granularity.** Clone-only progress (3 stages) vs. live percentage from `git`'s `--progress` output. Proposed: stages only. Revisit if users complain.
5. **Promotion to top-level sidebar** — SP3 deferred this. Do we ship it in SP6 (natural given the new Browse tab) or leave for later? Proposed: ship it.

---

## Open questions the user should answer before implementation

- **Marketplace governance.** Is the Solo-official marketplace a vendor-curated list (human review) or a community PR pipeline? Affects infra and process design.
- **Attribution / licensing** in marketplace entries. Should each entry require a license field? Proposed yes (warn at parse if missing).
- **Telemetry.** Do we want anonymous install counts per plugin for the marketplace (to surface "popular" plugins)? If yes, that's an opt-in telemetry addition that belongs in SP6 rather than bolted on later.

---

## Follow-on roadmap after SP6

- **SP6.5** — Code signing, Sigstore provenance, attestation of the official marketplace index.
- **SP6.6** — Background upgrade polling + auto-install for `InstalledByDefault` entries.
- **SP6.7** — Plugin search across subscribed marketplaces; popular/trending sort.
- **SP6.8** — Private-repo support via SP5's GitHub provider tokens.

Each is a clean additive change on top of SP6's protocol types.
