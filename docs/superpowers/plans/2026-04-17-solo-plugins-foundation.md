# Solo Plugins Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `solo-plugins` foundation crate — manifest parsing, local store, toggles, multi-root adapter discovery, and Tauri command surface — without introducing any UI, MCP runtime, or app connectors.

**Architecture:** Hard-fork the minimal surface of codex's `core-plugins` (manifest/store patterns + `PluginId` validation) into a new `crates/solo-plugins/` workspace member. Expose 5 Tauri commands and a two-tier protocol (`PluginSummary` / `PluginDetail`). Read-only adapters discover plugins from `~/.claude/plugins/**` and `~/.codex/plugins/`; Solo-native installs write to `~/.solo/plugins/cache/<marketplace>/<name>/<version>/`.

**Tech Stack:** Rust (edition 2021, `serde`, `serde_json`, `tokio`, `tracing`, `thiserror`, `dirs`, `tempfile` for tests), `ts-rs` for TypeScript binding generation, Tauri 2 command surface.

**Spec:** `docs/superpowers/specs/2026-04-17-solo-plugins-foundation-design.md`

---

## Prerequisites & conventions

Every shell command in this plan assumes CWD is `/Users/sachin/Developer/Orbit_Main/solo` unless stated otherwise. The branch is the user's current branch (`feat/ui-skill-application`); no worktree is required for this plan, but the engineer may create one if preferred.

Commit-message convention: no Claude attribution, imperative first line, type-prefix (`feat(plugins):`, `test(plugins):`, `refactor(plugins):`). The user's memory mandates these. One commit per logical unit of work — per file where possible, otherwise per task.

Reference source for forked code: `/Users/sachin/Developer/Orbit_Main/Inspirations/codex/codex-rs/`. Specific source files are named in each task.

Checks run at key milestones:

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo check -p solo-plugins                    # after crate skeleton lands
cargo test -p solo-plugins                     # after each module's tests are written
cargo clippy -p solo-plugins -- -D warnings    # catches lint issues in the new crate
bun run check                                  # full cargo check + tsc
bun run gen:bindings                           # after solo-protocol changes
```

---

## File structure

### New files

```
crates/solo-plugins/
├── Cargo.toml
├── README.md
├── src/
│   ├── lib.rs
│   ├── id.rs
│   ├── path.rs
│   ├── manifest.rs
│   ├── store.rs
│   ├── adapters.rs
│   ├── toggles.rs
│   └── loader.rs
└── tests/
    └── round_trip.rs

apps/desktop/src-tauri/src/plugins_commands.rs
apps/desktop/src/lib/tauri/plugins.ts
```

### Modified files

```
Cargo.toml                                     # add solo-plugins to workspace members (already wildcard, but confirm)
apps/desktop/src-tauri/Cargo.toml              # add solo-plugins dependency
apps/desktop/src-tauri/src/lib.rs              # register PluginsState + plugins_commands::*
crates/solo-protocol/src/lib.rs                # add PluginId, PluginSource, PluginSummary, PluginDetail, etc.
crates/solo-core/src/settings.rs               # add load_plugins_config / update_plugins_adapters
```

### One-per-module responsibility

- **`id.rs`** — `PluginId`, `PluginIdError`, `validate_plugin_segment`. Stateless, no IO. Forked from `codex-rs/plugin/src/plugin_id.rs`.
- **`path.rs`** — `AbsolutePathBuf` newtype (minimal subset) + `resolve_relative_inside` helper that rejects `..` and absolute paths. Forked + simplified from `codex-rs/utils/absolute-path/src/lib.rs`.
- **`manifest.rs`** — `PluginManifest`, `PluginManifestInterface`, `load_plugin_manifest`, `find_plugin_manifest_path`. Parses `plugin.json` from three accepted filenames. Forked from `codex-rs/core-plugins/src/manifest.rs`.
- **`toggles.rs`** — `PluginToggles` wrapping `HashMap<String, bool>`, backed by `~/.solo/plugins/toggles.json`. Written from scratch; codex's `toggles.rs` is a different concept.
- **`store.rs`** — `PluginStore` with `install`, `uninstall`, `active_plugin_version`, `plugin_root`. Writes under `~/.solo/plugins/cache/`. Forked from `codex-rs/core-plugins/src/store.rs`.
- **`adapters.rs`** — `discover_claude_adapter`, `discover_codex_adapter`. Read-only walks of `~/.claude/plugins/**` and `~/.codex/plugins/`. Written from scratch.
- **`loader.rs`** — Orchestrator: `list_plugins`, `get_plugin_detail`. Merges store + adapters, applies toggles, sorts. Written from scratch.
- **`lib.rs`** — Public API surface. Re-exports the public types from the modules above.
- **`plugins_commands.rs`** — 5 Tauri commands (`plugins_list`, `plugins_get_detail`, `plugins_set_enabled`, `plugins_install_local`, `plugins_uninstall`). Holds `PluginsState`.
- **`plugins.ts`** — TS wrapper calling `invoke('plugins_*', ...)` with typed arguments.
- **`tests/round_trip.rs`** — One end-to-end integration test.

---

## Task ordering rationale

Tasks are ordered so every task produces something compilable and tested. The ordering:

1–2. **Crate skeleton & id.rs** — smallest piece, no deps on anything else in the crate.
3. **path.rs** — depends only on std; needed by manifest and store.
4–7. **manifest.rs** — split into 4 tasks (skeleton + types, top-level loader, interface parsing, default_prompt normalization). Needed by adapters, store, loader.
8. **toggles.rs** — independent of manifest; only needs id.rs.
9–10. **store.rs** — depends on manifest.
11–12. **adapters.rs** — depends on manifest.
13–14. **loader.rs** — depends on everything above.
15. **Protocol types** — in solo-protocol, wire-visible types.
16. **Settings wiring** — `PluginsConfig` in `solo-core::settings`.
17. **plugins_commands.rs** — Tauri commands.
18. **Register in lib.rs** — wire commands into the handler.
19. **TS wrapper** — frontend binding file.
20. **Integration test** — end-to-end round-trip.
21. **Final verification** — `bun run check`, `cargo clippy`, manual devtools smoke.

---

## Task 1: Create `solo-plugins` crate skeleton

**Files:**
- Create: `crates/solo-plugins/Cargo.toml`
- Create: `crates/solo-plugins/README.md`
- Create: `crates/solo-plugins/src/lib.rs`

- [ ] **Step 1: Create `Cargo.toml`**

```toml
[package]
name = "solo-plugins"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
tokio = { workspace = true }
tracing = { workspace = true }
thiserror = { workspace = true }
dirs = "5"
ts-rs = { workspace = true }

[dev-dependencies]
tempfile = "3.10"
```

- [ ] **Step 2: Create `README.md`**

```markdown
# solo-plugins

Plugin manifest parsing, local store, toggles, and multi-root adapter discovery
for Solo IDE.

## Provenance

Portions of this crate (`manifest.rs`, `store.rs`, `id.rs`, `path.rs`) are
hard-forked from [codex-rs](https://github.com/openai/codex) `core-plugins`
and related utility crates, which are licensed under Apache-2.0. See the
module-level doc comments for the specific upstream source file each module
originated from. The fork drops all `codex-*` crate dependencies by inlining
the minimal subset Solo actually needs.
```

- [ ] **Step 3: Create `src/lib.rs` with empty module stubs**

```rust
//! Plugin discovery, cache, and toggle management for Solo IDE.
//!
//! See `docs/superpowers/specs/2026-04-17-solo-plugins-foundation-design.md`
//! for the full design. Module provenance is documented per-module.

pub mod adapters;
pub mod id;
pub mod loader;
pub mod manifest;
pub mod path;
pub mod store;
pub mod toggles;

pub use id::{PluginId, PluginIdError, validate_plugin_segment};
pub use manifest::{PluginManifest, PluginManifestInterface, PluginManifestPaths, load_plugin_manifest};
pub use path::AbsolutePathBuf;
pub use store::{PluginStore, PluginStoreError, PluginInstallResult};
pub use toggles::PluginToggles;
pub use loader::{list_plugins, get_plugin_detail};
```

- [ ] **Step 4: Add empty module files so `cargo check` will find them**

Create each of these files with a single module-doc comment so the crate compiles:

```rust
// crates/solo-plugins/src/id.rs
//! Stable plugin identifier parsing and validation.
```

```rust
// crates/solo-plugins/src/path.rs
//! Absolute-path newtype and safe-relative-path resolver.
```

```rust
// crates/solo-plugins/src/manifest.rs
//! plugin.json parser.
```

```rust
// crates/solo-plugins/src/store.rs
//! Local plugin cache under ~/.solo/plugins/cache/.
```

```rust
// crates/solo-plugins/src/adapters.rs
//! Read-only discovery of Claude and codex plugin directories.
```

```rust
// crates/solo-plugins/src/toggles.rs
//! Per-plugin enable/disable state persisted to ~/.solo/plugins/toggles.json.
```

```rust
// crates/solo-plugins/src/loader.rs
//! Plugin discovery orchestrator.
```

The `pub use` re-exports in `lib.rs` will fail to resolve at this stage. That's expected — they'll start resolving as each module's types are added in the following tasks. For Task 1, comment out the `pub use` lines temporarily:

Replace the `pub use` block in `src/lib.rs` with:

```rust
// Re-exports are added module-by-module in later tasks.
```

- [ ] **Step 5: Verify `cargo check -p solo-plugins` passes**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo check -p solo-plugins
```

Expected: `Checking solo-plugins v0.1.0 ... Finished`. No warnings, no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
git add crates/solo-plugins/Cargo.toml crates/solo-plugins/README.md crates/solo-plugins/src
git commit -m "feat(plugins): scaffold solo-plugins crate

Empty module stubs for id, path, manifest, store, adapters, toggles, loader.
README documents the hard-fork provenance from codex-rs core-plugins."
```

---

## Task 2: `id.rs` — `PluginId` + validation

**Files:**
- Modify: `crates/solo-plugins/src/id.rs`

Source reference: `codex-rs/plugin/src/plugin_id.rs`. The fork changes exactly two things: (1) drop the `@`-based `parse`/`as_key` methods (Solo uses marketplace/name as separate fields on the wire), (2) rename field `plugin_name` to `name` for brevity in the Solo namespace. `validate_plugin_segment` is ported verbatim.

- [ ] **Step 1: Write failing tests**

Replace the contents of `crates/solo-plugins/src/id.rs` with:

```rust
//! Stable plugin identifier parsing and validation.
//!
//! Forked and adapted from codex-rs/plugin/src/plugin_id.rs.

#[derive(Debug, thiserror::Error)]
pub enum PluginIdError {
    #[error("{0}")]
    Invalid(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PluginId {
    pub marketplace: String,
    pub name: String,
}

impl PluginId {
    pub fn new(marketplace: String, name: String) -> Result<Self, PluginIdError> {
        validate_plugin_segment(&marketplace, "marketplace name")
            .map_err(PluginIdError::Invalid)?;
        validate_plugin_segment(&name, "plugin name").map_err(PluginIdError::Invalid)?;
        Ok(Self { marketplace, name })
    }

    /// Stringified form used for display and as toggles.json keys.
    pub fn as_key(&self) -> String {
        format!("{}/{}", self.marketplace, self.name)
    }
}

pub fn validate_plugin_segment(segment: &str, kind: &str) -> Result<(), String> {
    if segment.is_empty() {
        return Err(format!("invalid {kind}: must not be empty"));
    }
    if !segment
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(format!(
            "invalid {kind}: only ASCII letters, digits, `_`, and `-` are allowed"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_id_constructs() {
        let id = PluginId::new("local".into(), "github-1".into()).unwrap();
        assert_eq!(id.as_key(), "local/github-1");
    }

    #[test]
    fn empty_segment_rejected() {
        assert!(PluginId::new(String::new(), "x".into()).is_err());
        assert!(PluginId::new("x".into(), String::new()).is_err());
    }

    #[test]
    fn invalid_characters_rejected() {
        assert!(PluginId::new("local".into(), "a b".into()).is_err());
        assert!(PluginId::new("local".into(), "../evil".into()).is_err());
        assert!(PluginId::new("local".into(), "dot.name".into()).is_err());
        assert!(PluginId::new("slash/name".into(), "x".into()).is_err());
        assert!(PluginId::new("local".into(), "name@marketplace".into()).is_err());
    }

    #[test]
    fn uppercase_and_digits_allowed() {
        assert!(PluginId::new("OpenAI".into(), "Github_1".into()).is_ok());
    }

    #[test]
    fn validate_segment_returns_descriptive_error() {
        let err = validate_plugin_segment("a b", "plugin name").unwrap_err();
        assert!(err.contains("plugin name"), "error was: {err}");
    }
}
```

- [ ] **Step 2: Run tests, verify they pass**

```bash
cargo test -p solo-plugins id::tests
```

Expected: all 5 tests pass. (Yes, this is TDD inverted — tests and impl were written together because the impl is directly forked from codex. The test suite is the acceptance gate.)

- [ ] **Step 3: Restore the `pub use` for `id` in `lib.rs`**

Open `crates/solo-plugins/src/lib.rs` and add back:

```rust
pub use id::{PluginId, PluginIdError, validate_plugin_segment};
```

- [ ] **Step 4: Verify crate still compiles**

```bash
cargo check -p solo-plugins
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/solo-plugins/src/id.rs crates/solo-plugins/src/lib.rs
git commit -m "feat(plugins): PluginId with segment validation

Forked from codex-rs plugin_id.rs. Segments must be ASCII
alphanumeric plus '_' and '-'; dots, slashes, and '@' are all rejected."
```

---

## Task 3: `path.rs` — minimal `AbsolutePathBuf` + safe relative resolver

**Files:**
- Modify: `crates/solo-plugins/src/path.rs`

The codex version of `AbsolutePathBuf` is ~575 lines; we port only what `manifest.rs` and `store.rs` need: construct-from-absolute, `as_path`, `join`, `display`. No tilde-expansion, no deserialize-guard, no canonicalization.

We also need a helper `resolve_relative_inside(root, raw)` that enforces the `./relative/path` discipline codex's manifest uses when resolving asset paths in `plugin.json`. This rejects `..` components and bare-absolute paths.

- [ ] **Step 1: Write the test + implementation**

Replace `crates/solo-plugins/src/path.rs` with:

```rust
//! Absolute-path newtype and safe-relative-path resolver.
//!
//! Minimal subset of codex-rs/utils/absolute-path/src/lib.rs — Solo does not
//! need tilde expansion, a deserialize guard, or `dunce` canonicalization at
//! the foundation layer.

use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AbsolutePathBuf(PathBuf);

impl AbsolutePathBuf {
    /// Returns `Err(std::io::Error)` if `path` is not already absolute.
    pub fn try_from_absolute<P: AsRef<Path>>(path: P) -> std::io::Result<Self> {
        let p = path.as_ref();
        if !p.is_absolute() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("path is not absolute: {}", p.display()),
            ));
        }
        Ok(Self(p.to_path_buf()))
    }

    pub fn as_path(&self) -> &Path {
        &self.0
    }

    pub fn into_path_buf(self) -> PathBuf {
        self.0
    }

    pub fn join<P: AsRef<Path>>(&self, rel: P) -> std::io::Result<Self> {
        let joined = self.0.join(rel);
        if !joined.is_absolute() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "join result must remain absolute",
            ));
        }
        Ok(Self(joined))
    }

    pub fn display(&self) -> std::path::Display<'_> {
        self.0.display()
    }
}

impl AsRef<Path> for AbsolutePathBuf {
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

impl TryFrom<PathBuf> for AbsolutePathBuf {
    type Error = std::io::Error;
    fn try_from(value: PathBuf) -> Result<Self, Self::Error> {
        Self::try_from_absolute(value)
    }
}

/// Resolve a manifest-declared relative path (`./foo/bar.png`) inside `root`,
/// rejecting empty paths, paths without the `./` prefix, and any `..` component.
///
/// Equivalent to codex-rs core-plugins/manifest.rs `resolve_manifest_path`,
/// lifted into a shared helper.
pub fn resolve_relative_inside(
    root: &Path,
    raw: &str,
) -> Result<AbsolutePathBuf, RelativePathError> {
    if raw.is_empty() {
        return Err(RelativePathError::Empty);
    }
    let relative = raw
        .strip_prefix("./")
        .ok_or(RelativePathError::MissingDotSlashPrefix)?;
    if relative.is_empty() {
        return Err(RelativePathError::Empty);
    }

    let mut normalized = PathBuf::new();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(c) => normalized.push(c),
            Component::ParentDir => return Err(RelativePathError::ContainsParentDir),
            _ => return Err(RelativePathError::EscapesRoot),
        }
    }

    let joined = root.join(normalized);
    AbsolutePathBuf::try_from_absolute(joined).map_err(RelativePathError::NotAbsolute)
}

#[derive(Debug, thiserror::Error)]
pub enum RelativePathError {
    #[error("path must not be empty")]
    Empty,
    #[error("path must start with './' relative to plugin root")]
    MissingDotSlashPrefix,
    #[error("path must not contain '..'")]
    ContainsParentDir,
    #[error("path must stay within the plugin root")]
    EscapesRoot,
    #[error("resolved path is not absolute: {0}")]
    NotAbsolute(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn absolute_constructs() {
        let tmp = tempdir().unwrap();
        let abs = AbsolutePathBuf::try_from_absolute(tmp.path()).unwrap();
        assert_eq!(abs.as_path(), tmp.path());
    }

    #[test]
    fn relative_rejected() {
        assert!(AbsolutePathBuf::try_from_absolute("relative/path").is_err());
    }

    #[test]
    fn resolve_relative_inside_ok() {
        let tmp = tempdir().unwrap();
        let out = resolve_relative_inside(tmp.path(), "./assets/logo.png").unwrap();
        assert_eq!(out.as_path(), tmp.path().join("assets/logo.png").as_path());
    }

    #[test]
    fn resolve_rejects_missing_prefix() {
        let tmp = tempdir().unwrap();
        let err = resolve_relative_inside(tmp.path(), "assets/logo.png").unwrap_err();
        assert!(matches!(err, RelativePathError::MissingDotSlashPrefix));
    }

    #[test]
    fn resolve_rejects_parent_traversal() {
        let tmp = tempdir().unwrap();
        let err = resolve_relative_inside(tmp.path(), "./../../etc/passwd").unwrap_err();
        assert!(matches!(err, RelativePathError::ContainsParentDir));
    }

    #[test]
    fn resolve_rejects_empty() {
        let tmp = tempdir().unwrap();
        let err = resolve_relative_inside(tmp.path(), "./").unwrap_err();
        assert!(matches!(err, RelativePathError::Empty));
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cargo test -p solo-plugins path::tests
```

Expected: all 6 tests pass.

- [ ] **Step 3: Add re-export to `lib.rs`**

Append to the re-exports block in `crates/solo-plugins/src/lib.rs`:

```rust
pub use path::AbsolutePathBuf;
```

- [ ] **Step 4: Verify**

```bash
cargo check -p solo-plugins
```

- [ ] **Step 5: Commit**

```bash
git add crates/solo-plugins/src/path.rs crates/solo-plugins/src/lib.rs
git commit -m "feat(plugins): minimal AbsolutePathBuf + safe-relative resolver

Simplified port of codex's utils/absolute-path — drops tilde expansion,
canonicalization, and the deserialize guard. Adds resolve_relative_inside
lifted from codex core-plugins/manifest.rs."
```

---

## Task 4: `manifest.rs` — types and module skeleton

**Files:**
- Modify: `crates/solo-plugins/src/manifest.rs`

Source: `codex-rs/core-plugins/src/manifest.rs`. This task lands the public types only — the parsing logic comes in Tasks 5–7. Splitting keeps each task under ~100 lines of code.

- [ ] **Step 1: Replace `manifest.rs` with types only**

```rust
//! plugin.json parser.
//!
//! Forked from codex-rs/core-plugins/src/manifest.rs. Solo accepts three
//! manifest filenames (solo-plugin, codex-plugin, claude-plugin) in that
//! priority order — see find_plugin_manifest_path.

use crate::path::AbsolutePathBuf;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use std::path::{Path, PathBuf};

pub const MAX_DEFAULT_PROMPT_COUNT: usize = 3;
pub const MAX_DEFAULT_PROMPT_LEN: usize = 128;

pub const DISCOVERABLE_MANIFEST_PATHS: &[&str] = &[
    ".solo-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginManifest {
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub paths: PluginManifestPaths,
    pub interface: Option<PluginManifestInterface>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PluginManifestPaths {
    pub skills: Option<AbsolutePathBuf>,
    pub mcp_servers: Option<AbsolutePathBuf>,
    pub apps: Option<AbsolutePathBuf>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PluginManifestInterface {
    pub display_name: Option<String>,
    pub short_description: Option<String>,
    pub long_description: Option<String>,
    pub developer_name: Option<String>,
    pub category: Option<String>,
    pub capabilities: Vec<String>,
    pub website_url: Option<String>,
    pub privacy_policy_url: Option<String>,
    pub terms_of_service_url: Option<String>,
    pub default_prompts: Vec<String>,
    pub brand_color: Option<String>,
    pub composer_icon: Option<AbsolutePathBuf>,
    pub logo: Option<AbsolutePathBuf>,
    pub screenshots: Vec<AbsolutePathBuf>,
}

// Raw types used only for deserialization. Made private because consumers
// always get the processed `PluginManifest`.

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPluginManifest {
    #[serde(default)]
    name: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    skills: Option<String>,
    #[serde(default)]
    mcp_servers: Option<String>,
    #[serde(default)]
    apps: Option<String>,
    #[serde(default)]
    interface: Option<RawPluginManifestInterface>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPluginManifestInterface {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    short_description: Option<String>,
    #[serde(default)]
    long_description: Option<String>,
    #[serde(default)]
    developer_name: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    #[serde(alias = "websiteURL")]
    website_url: Option<String>,
    #[serde(default)]
    #[serde(alias = "privacyPolicyURL")]
    privacy_policy_url: Option<String>,
    #[serde(default)]
    #[serde(alias = "termsOfServiceURL")]
    terms_of_service_url: Option<String>,
    #[serde(default)]
    default_prompt: Option<RawPluginManifestDefaultPrompt>,
    #[serde(default)]
    brand_color: Option<String>,
    #[serde(default)]
    composer_icon: Option<String>,
    #[serde(default)]
    logo: Option<String>,
    #[serde(default)]
    screenshots: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawPluginManifestDefaultPrompt {
    String(String),
    List(Vec<RawPluginManifestDefaultPromptEntry>),
    Invalid(JsonValue),
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawPluginManifestDefaultPromptEntry {
    String(String),
    Invalid(JsonValue),
}

/// Walk the discoverable filenames in priority order, returning the first
/// that exists as a file under `plugin_root`.
pub fn find_plugin_manifest_path(plugin_root: &Path) -> Option<PathBuf> {
    DISCOVERABLE_MANIFEST_PATHS
        .iter()
        .map(|rel| plugin_root.join(rel))
        .find(|p| p.is_file())
}

// load_plugin_manifest is stubbed here; implemented in Task 5.
pub fn load_plugin_manifest(_plugin_root: &Path) -> Option<PluginManifest> {
    None
}
```

- [ ] **Step 2: Verify compilation**

```bash
cargo check -p solo-plugins
```

Expected: clean. No tests yet in this task.

- [ ] **Step 3: Add re-exports to `lib.rs`**

Append to `crates/solo-plugins/src/lib.rs`:

```rust
pub use manifest::{
    PluginManifest, PluginManifestInterface, PluginManifestPaths, find_plugin_manifest_path,
    load_plugin_manifest,
};
```

- [ ] **Step 4: Commit**

```bash
git add crates/solo-plugins/src/manifest.rs crates/solo-plugins/src/lib.rs
git commit -m "feat(plugins): manifest types and filename discovery

Types-only commit for PluginManifest + interface. load_plugin_manifest
is stubbed; actual parsing lands in the next three tasks."
```

---

## Task 5: `manifest.rs` — top-level loader, name fallback, version trim

**Files:**
- Modify: `crates/solo-plugins/src/manifest.rs`

- [ ] **Step 1: Write failing tests**

Append to `crates/solo-plugins/src/manifest.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_manifest(root: &Path, relative: &str, body: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    #[test]
    fn missing_manifest_returns_none() {
        let tmp = tempdir().unwrap();
        assert!(load_plugin_manifest(&tmp.path().join("missing")).is_none());
    }

    #[test]
    fn solo_plugin_path_takes_priority() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(&root, ".solo-plugin/plugin.json", r#"{"name":"from-solo"}"#);
        write_manifest(&root, ".claude-plugin/plugin.json", r#"{"name":"from-claude"}"#);
        let manifest = load_plugin_manifest(&root).unwrap();
        assert_eq!(manifest.name, "from-solo");
    }

    #[test]
    fn claude_plugin_path_accepted_as_fallback() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(&root, ".claude-plugin/plugin.json", r#"{"name":"from-claude"}"#);
        let manifest = load_plugin_manifest(&root).unwrap();
        assert_eq!(manifest.name, "from-claude");
    }

    #[test]
    fn name_falls_back_to_dir_when_empty() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample-dir");
        write_manifest(&root, ".solo-plugin/plugin.json", r#"{"name":""}"#);
        let manifest = load_plugin_manifest(&root).unwrap();
        assert_eq!(manifest.name, "sample-dir");
    }

    #[test]
    fn version_trimmed() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","version":"  1.2.3-beta+7  "}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        assert_eq!(manifest.version.as_deref(), Some("1.2.3-beta+7"));
    }

    #[test]
    fn empty_version_becomes_none() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(&root, ".solo-plugin/plugin.json", r#"{"name":"x","version":"  "}"#);
        let manifest = load_plugin_manifest(&root).unwrap();
        assert_eq!(manifest.version, None);
    }

    #[test]
    fn malformed_json_returns_none() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(&root, ".solo-plugin/plugin.json", r#"{not json"#);
        assert!(load_plugin_manifest(&root).is_none());
    }
}
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cargo test -p solo-plugins manifest::tests
```

Expected: 5 failures (stub returns None for all cases that should succeed). The two `returns_none` cases pass.

- [ ] **Step 3: Implement `load_plugin_manifest`**

Replace the stub in `manifest.rs` with:

```rust
pub fn load_plugin_manifest(plugin_root: &Path) -> Option<PluginManifest> {
    let manifest_path = find_plugin_manifest_path(plugin_root)?;
    let contents = std::fs::read_to_string(&manifest_path).ok()?;
    let raw: RawPluginManifest = match serde_json::from_str(&contents) {
        Ok(r) => r,
        Err(err) => {
            tracing::warn!(
                path = %manifest_path.display(),
                "failed to parse plugin manifest: {err}"
            );
            return None;
        }
    };

    let RawPluginManifest {
        name: raw_name,
        version,
        description,
        skills,
        mcp_servers,
        apps,
        interface,
    } = raw;

    let name = if raw_name.trim().is_empty() {
        plugin_root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string()
    } else {
        raw_name
    };

    let version = version.and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    Some(PluginManifest {
        name,
        version,
        description,
        paths: PluginManifestPaths {
            skills: resolve_manifest_path(plugin_root, "skills", skills.as_deref()),
            mcp_servers: resolve_manifest_path(plugin_root, "mcpServers", mcp_servers.as_deref()),
            apps: resolve_manifest_path(plugin_root, "apps", apps.as_deref()),
        },
        interface: process_interface(plugin_root, interface),
    })
}

fn resolve_manifest_path(
    plugin_root: &Path,
    field: &'static str,
    raw: Option<&str>,
) -> Option<AbsolutePathBuf> {
    let raw = raw?;
    match crate::path::resolve_relative_inside(plugin_root, raw) {
        Ok(p) => Some(p),
        Err(err) => {
            tracing::warn!("ignoring {field}: {err}");
            None
        }
    }
}

// Stub — implemented in Task 6.
fn process_interface(
    _plugin_root: &Path,
    _raw: Option<RawPluginManifestInterface>,
) -> Option<PluginManifestInterface> {
    None
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cargo test -p solo-plugins manifest::tests
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/solo-plugins/src/manifest.rs
git commit -m "feat(plugins): load_plugin_manifest with name/version handling

Parses plugin.json, falls back to directory name when manifest 'name' is
blank, trims version strings, logs and swallows parse errors. Interface
parsing remains stubbed; lands in next task."
```

---

## Task 6: `manifest.rs` — interface parsing

**Files:**
- Modify: `crates/solo-plugins/src/manifest.rs`

- [ ] **Step 1: Write failing tests**

Append inside the existing `#[cfg(test)] mod tests` block in `manifest.rs`:

```rust
    #[test]
    fn interface_display_name_parses() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"displayName":"My Plugin","shortDescription":"short","brandColor":"#336699"}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(interface.display_name.as_deref(), Some("My Plugin"));
        assert_eq!(interface.short_description.as_deref(), Some("short"));
        assert_eq!(interface.brand_color.as_deref(), Some("#336699"));
    }

    #[test]
    fn interface_asset_paths_resolve_under_root() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"logo":"./assets/logo.png","screenshots":["./s1.png","./s2.png"]}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(interface.logo.unwrap().as_path(), root.join("assets/logo.png"));
        assert_eq!(interface.screenshots.len(), 2);
    }

    #[test]
    fn interface_rejects_unsafe_asset_paths() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"logo":"../evil.png"}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert!(interface.logo.is_none());
    }

    #[test]
    fn empty_interface_object_returns_none() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(&root, ".solo-plugin/plugin.json", r#"{"name":"x","interface":{}}"#);
        let manifest = load_plugin_manifest(&root).unwrap();
        assert!(manifest.interface.is_none());
    }

    #[test]
    fn no_interface_block_returns_none() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(&root, ".solo-plugin/plugin.json", r#"{"name":"x"}"#);
        let manifest = load_plugin_manifest(&root).unwrap();
        assert!(manifest.interface.is_none());
    }
```

- [ ] **Step 2: Run tests — expect 4 failures**

```bash
cargo test -p solo-plugins manifest::tests
```

The empty-interface and no-interface tests pass (stub returns None); the three asserting populated fields fail.

- [ ] **Step 3: Replace `process_interface` stub**

Replace the `process_interface` function in `manifest.rs` with:

```rust
fn process_interface(
    plugin_root: &Path,
    raw: Option<RawPluginManifestInterface>,
) -> Option<PluginManifestInterface> {
    let raw = raw?;
    let RawPluginManifestInterface {
        display_name,
        short_description,
        long_description,
        developer_name,
        category,
        capabilities,
        website_url,
        privacy_policy_url,
        terms_of_service_url,
        default_prompt,
        brand_color,
        composer_icon,
        logo,
        screenshots,
    } = raw;

    let interface = PluginManifestInterface {
        display_name,
        short_description,
        long_description,
        developer_name,
        category,
        capabilities,
        website_url,
        privacy_policy_url,
        terms_of_service_url,
        default_prompts: resolve_default_prompts(default_prompt).unwrap_or_default(),
        brand_color,
        composer_icon: resolve_manifest_path(plugin_root, "interface.composerIcon", composer_icon.as_deref()),
        logo: resolve_manifest_path(plugin_root, "interface.logo", logo.as_deref()),
        screenshots: screenshots
            .iter()
            .filter_map(|s| resolve_manifest_path(plugin_root, "interface.screenshots", Some(s)))
            .collect(),
    };

    let has_any = interface.display_name.is_some()
        || interface.short_description.is_some()
        || interface.long_description.is_some()
        || interface.developer_name.is_some()
        || interface.category.is_some()
        || !interface.capabilities.is_empty()
        || interface.website_url.is_some()
        || interface.privacy_policy_url.is_some()
        || interface.terms_of_service_url.is_some()
        || !interface.default_prompts.is_empty()
        || interface.brand_color.is_some()
        || interface.composer_icon.is_some()
        || interface.logo.is_some()
        || !interface.screenshots.is_empty();

    has_any.then_some(interface)
}

// Stub — implemented in Task 7.
fn resolve_default_prompts(
    _raw: Option<RawPluginManifestDefaultPrompt>,
) -> Option<Vec<String>> {
    None
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cargo test -p solo-plugins manifest::tests
```

Expected: all tests in this task's set pass.

- [ ] **Step 5: Commit**

```bash
git add crates/solo-plugins/src/manifest.rs
git commit -m "feat(plugins): manifest interface parsing

Maps the 14 RawPluginManifestInterface fields to PluginManifestInterface.
Asset paths (logo, composerIcon, screenshots) are resolved relative to the
plugin root via resolve_relative_inside, rejecting traversal. Returns None
when every interface field is empty."
```

---

## Task 7: `manifest.rs` — default_prompt normalization

**Files:**
- Modify: `crates/solo-plugins/src/manifest.rs`

This is the most adversarially-tested part of the manifest — codex handles legacy string form, array form, length caps, count caps, and invalid shapes. We port their tests and their behavior.

- [ ] **Step 1: Write failing tests**

Append to the `mod tests` block:

```rust
    #[test]
    fn default_prompt_legacy_string() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"defaultPrompt":"  Summarize   my inbox  "}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(interface.default_prompts, vec!["Summarize my inbox".to_string()]);
    }

    #[test]
    fn default_prompt_array_caps_at_three() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"defaultPrompt":["one","two","three","four","five"]}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(interface.default_prompts, vec!["one", "two", "three"]);
    }

    #[test]
    fn default_prompt_drops_entries_over_128_chars() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        let too_long = "x".repeat(129);
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            &format!(r#"{{"name":"x","interface":{{"defaultPrompt":["short","{too_long}"]}}}}"#),
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(interface.default_prompts, vec!["short".to_string()]);
    }

    #[test]
    fn default_prompt_drops_empty_entries() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"defaultPrompt":["one","   ","two"]}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(interface.default_prompts, vec!["one", "two"]);
    }

    #[test]
    fn default_prompt_invalid_shape_returns_empty() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"defaultPrompt":{"text":"nope"}}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        // With only a mistyped defaultPrompt, the interface should be None
        // (has_any is false because default_prompts is empty).
        assert!(manifest.interface.is_none());
    }
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cargo test -p solo-plugins manifest::tests
```

Expected: the five default_prompt tests fail (stub returns None, meaning `default_prompts` is always empty).

- [ ] **Step 3: Replace `resolve_default_prompts` stub**

Replace the stub in `manifest.rs` with:

```rust
fn resolve_default_prompts(
    raw: Option<RawPluginManifestDefaultPrompt>,
) -> Option<Vec<String>> {
    let raw = raw?;
    let mut prompts = Vec::new();

    match raw {
        RawPluginManifestDefaultPrompt::String(s) => {
            if let Some(p) = normalize_prompt(&s) {
                prompts.push(p);
            }
        }
        RawPluginManifestDefaultPrompt::List(entries) => {
            for entry in entries {
                if prompts.len() >= MAX_DEFAULT_PROMPT_COUNT {
                    tracing::warn!(
                        "ignoring additional defaultPrompt entries: max {MAX_DEFAULT_PROMPT_COUNT}"
                    );
                    break;
                }
                match entry {
                    RawPluginManifestDefaultPromptEntry::String(s) => {
                        if let Some(p) = normalize_prompt(&s) {
                            prompts.push(p);
                        }
                    }
                    RawPluginManifestDefaultPromptEntry::Invalid(value) => {
                        tracing::warn!(
                            "ignoring defaultPrompt entry: expected string, got {}",
                            value_type(&value)
                        );
                    }
                }
            }
        }
        RawPluginManifestDefaultPrompt::Invalid(value) => {
            tracing::warn!(
                "ignoring defaultPrompt: expected string or array, got {}",
                value_type(&value)
            );
        }
    }

    if prompts.is_empty() {
        None
    } else {
        Some(prompts)
    }
}

fn normalize_prompt(raw: &str) -> Option<String> {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    if collapsed.chars().count() > MAX_DEFAULT_PROMPT_LEN {
        tracing::warn!("ignoring defaultPrompt: max {MAX_DEFAULT_PROMPT_LEN} characters");
        return None;
    }
    Some(collapsed)
}

fn value_type(v: &JsonValue) -> &'static str {
    match v {
        JsonValue::Null => "null",
        JsonValue::Bool(_) => "boolean",
        JsonValue::Number(_) => "number",
        JsonValue::String(_) => "string",
        JsonValue::Array(_) => "array",
        JsonValue::Object(_) => "object",
    }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cargo test -p solo-plugins manifest::tests
```

Expected: all manifest tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/solo-plugins/src/manifest.rs
git commit -m "feat(plugins): defaultPrompt normalization with caps

Accepts legacy string or array form. Collapses whitespace, drops empty
entries, drops entries over MAX_DEFAULT_PROMPT_LEN (128 chars), caps the
list at MAX_DEFAULT_PROMPT_COUNT (3). Invalid shapes logged and dropped
rather than failing the whole manifest."
```

---

## Task 8: `toggles.rs` — per-plugin enable/disable state

**Files:**
- Modify: `crates/solo-plugins/src/toggles.rs`

This is **new code** — codex's `toggles.rs` is a different concept (a helper for their JSON-config diff pipeline). Solo persists toggle state in a dedicated `~/.solo/plugins/toggles.json` file.

- [ ] **Step 1: Write failing tests**

Replace `crates/solo-plugins/src/toggles.rs` with:

```rust
//! Per-plugin enable/disable state persisted to ~/.solo/plugins/toggles.json.
//!
//! Keyed by PluginId::as_key() — "marketplace/name". Missing entries default
//! to "enabled"; callers pass their own default via `enabled_for`.

use crate::id::PluginId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const TOGGLES_FILE: &str = "toggles.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginToggles {
    #[serde(default)]
    entries: HashMap<String, PluginToggleEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginToggleEntry {
    pub enabled: bool,
}

impl PluginToggles {
    /// Load toggles.json from `~/.solo/plugins/`. Missing file → empty state.
    /// Malformed file → empty state + warning log.
    pub fn load(solo_plugins_dir: &Path) -> Self {
        let path = solo_plugins_dir.join(TOGGLES_FILE);
        let Ok(raw) = std::fs::read_to_string(&path) else {
            return Self::default();
        };
        if raw.trim().is_empty() {
            return Self::default();
        }
        match serde_json::from_str(&raw) {
            Ok(parsed) => parsed,
            Err(err) => {
                tracing::warn!(
                    path = %path.display(),
                    "failed to parse toggles.json, using empty state: {err}"
                );
                Self::default()
            }
        }
    }

    /// Persist to `~/.solo/plugins/toggles.json`, creating the directory if needed.
    pub fn save(&self, solo_plugins_dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(solo_plugins_dir)?;
        let path: PathBuf = solo_plugins_dir.join(TOGGLES_FILE);
        let serialized = serde_json::to_string_pretty(self)?;
        std::fs::write(path, serialized)
    }

    pub fn enabled_for(&self, id: &PluginId, default: bool) -> bool {
        self.entries
            .get(&id.as_key())
            .map(|entry| entry.enabled)
            .unwrap_or(default)
    }

    pub fn set_enabled(&mut self, id: &PluginId, enabled: bool) {
        self.entries.insert(id.as_key(), PluginToggleEntry { enabled });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn id(marketplace: &str, name: &str) -> PluginId {
        PluginId::new(marketplace.into(), name.into()).unwrap()
    }

    #[test]
    fn missing_file_returns_empty() {
        let tmp = tempdir().unwrap();
        let toggles = PluginToggles::load(tmp.path());
        assert!(toggles.entries.is_empty());
    }

    #[test]
    fn default_for_unknown_plugin() {
        let tmp = tempdir().unwrap();
        let toggles = PluginToggles::load(tmp.path());
        assert!(toggles.enabled_for(&id("local", "x"), true));
        assert!(!toggles.enabled_for(&id("local", "x"), false));
    }

    #[test]
    fn round_trip_persists_state() {
        let tmp = tempdir().unwrap();
        let mut toggles = PluginToggles::default();
        toggles.set_enabled(&id("local", "a"), true);
        toggles.set_enabled(&id("local", "b"), false);
        toggles.save(tmp.path()).unwrap();

        let reloaded = PluginToggles::load(tmp.path());
        assert!(reloaded.enabled_for(&id("local", "a"), false));
        assert!(!reloaded.enabled_for(&id("local", "b"), true));
    }

    #[test]
    fn malformed_file_returns_empty_without_panic() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join("toggles.json"), "not valid json").unwrap();
        let toggles = PluginToggles::load(tmp.path());
        assert!(toggles.entries.is_empty());
    }

    #[test]
    fn empty_file_returns_empty() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join("toggles.json"), "").unwrap();
        let toggles = PluginToggles::load(tmp.path());
        assert!(toggles.entries.is_empty());
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cargo test -p solo-plugins toggles::tests
```

Expected: all 5 tests pass. (Unlike Tasks 2–7 this is written in one shot because every path is trivially testable and there's no adversarial input space.)

- [ ] **Step 3: Add re-export**

Append to `crates/solo-plugins/src/lib.rs`:

```rust
pub use toggles::{PluginToggleEntry, PluginToggles};
```

- [ ] **Step 4: Verify**

```bash
cargo check -p solo-plugins
```

- [ ] **Step 5: Commit**

```bash
git add crates/solo-plugins/src/toggles.rs crates/solo-plugins/src/lib.rs
git commit -m "feat(plugins): PluginToggles persistence in toggles.json

Writes to ~/.solo/plugins/toggles.json. Missing or malformed files reset to
empty state with a warn log. Keys are PluginId::as_key()
('marketplace/name')."
```

---

## Task 9: `store.rs` — PluginStore with active_plugin_version

**Files:**
- Modify: `crates/solo-plugins/src/store.rs`

Source: `codex-rs/core-plugins/src/store.rs`. We port the cache-layout helpers and the `local`-version-wins rule. Install/uninstall land in Task 10.

- [ ] **Step 1: Write failing tests + minimal skeleton**

Replace `crates/solo-plugins/src/store.rs` with:

```rust
//! Local plugin cache under ~/.solo/plugins/cache/<marketplace>/<name>/<version>/.
//!
//! Forked from codex-rs/core-plugins/src/store.rs.

use crate::id::{PluginId, PluginIdError, validate_plugin_segment};
use crate::path::AbsolutePathBuf;
use std::fs;
use std::path::{Path, PathBuf};

pub const PLUGINS_CACHE_DIR: &str = "cache";
pub const DEFAULT_PLUGIN_VERSION: &str = "local";

#[derive(Debug, thiserror::Error)]
pub enum PluginStoreError {
    #[error("invalid: {0}")]
    Invalid(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Id(#[from] PluginIdError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginInstallResult {
    pub id: PluginId,
    pub version: String,
    pub installed_path: AbsolutePathBuf,
}

#[derive(Debug, Clone)]
pub struct PluginStore {
    root: PathBuf,
}

impl PluginStore {
    /// `solo_plugins_dir` should be `~/.solo/plugins/`. The cache lives at
    /// `<solo_plugins_dir>/cache/`.
    pub fn new(solo_plugins_dir: PathBuf) -> Self {
        Self {
            root: solo_plugins_dir.join(PLUGINS_CACHE_DIR),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn plugin_base_root(&self, id: &PluginId) -> PathBuf {
        self.root.join(&id.marketplace).join(&id.name)
    }

    pub fn plugin_root(&self, id: &PluginId, version: &str) -> PathBuf {
        self.plugin_base_root(id).join(version)
    }

    /// Returns the active version for a plugin. Discovery rules:
    ///   1. If a directory named `local` exists, it wins.
    ///   2. Otherwise, the lexicographically-highest version directory wins.
    ///   3. If no version directories exist, returns None.
    pub fn active_plugin_version(&self, id: &PluginId) -> Option<String> {
        let base = self.plugin_base_root(id);
        let mut versions: Vec<String> = fs::read_dir(&base)
            .ok()?
            .filter_map(Result::ok)
            .filter(|e| e.file_type().ok().is_some_and(|t| t.is_dir()))
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|v| validate_plugin_segment(v, "version").is_ok())
            .collect();
        versions.sort_unstable();

        if versions.is_empty() {
            None
        } else if versions.iter().any(|v| v == DEFAULT_PLUGIN_VERSION) {
            Some(DEFAULT_PLUGIN_VERSION.to_string())
        } else {
            versions.pop()
        }
    }

    pub fn active_plugin_root(&self, id: &PluginId) -> Option<PathBuf> {
        self.active_plugin_version(id)
            .map(|v| self.plugin_root(id, &v))
    }

    pub fn is_installed(&self, id: &PluginId) -> bool {
        self.active_plugin_version(id).is_some()
    }

    // install and uninstall land in Task 10.
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn id(marketplace: &str, name: &str) -> PluginId {
        PluginId::new(marketplace.into(), name.into()).unwrap()
    }

    fn make_version_dir(store: &PluginStore, id: &PluginId, version: &str) {
        let p = store.plugin_root(id, version);
        fs::create_dir_all(p).unwrap();
    }

    #[test]
    fn active_version_none_for_missing_plugin() {
        let tmp = tempdir().unwrap();
        let store = PluginStore::new(tmp.path().to_path_buf());
        assert_eq!(store.active_plugin_version(&id("local", "missing")), None);
    }

    #[test]
    fn active_version_picks_highest_semver() {
        let tmp = tempdir().unwrap();
        let store = PluginStore::new(tmp.path().to_path_buf());
        let plugin = id("local", "sample");
        make_version_dir(&store, &plugin, "1-0-0");
        make_version_dir(&store, &plugin, "2-0-0");
        make_version_dir(&store, &plugin, "1-5-0");
        assert_eq!(
            store.active_plugin_version(&plugin),
            Some("2-0-0".to_string())
        );
    }

    #[test]
    fn active_version_prefers_local_sentinel() {
        let tmp = tempdir().unwrap();
        let store = PluginStore::new(tmp.path().to_path_buf());
        let plugin = id("local", "sample");
        make_version_dir(&store, &plugin, "1-0-0");
        make_version_dir(&store, &plugin, "local");
        make_version_dir(&store, &plugin, "2-0-0");
        assert_eq!(
            store.active_plugin_version(&plugin),
            Some("local".to_string())
        );
    }

    #[test]
    fn active_version_ignores_invalid_segment_dirs() {
        let tmp = tempdir().unwrap();
        let store = PluginStore::new(tmp.path().to_path_buf());
        let plugin = id("local", "sample");
        let base = store.plugin_base_root(&plugin);
        fs::create_dir_all(base.join("1-0-0")).unwrap();
        // Create an invalid dir name that must be skipped.
        fs::create_dir_all(base.join("not.a.version")).unwrap();
        assert_eq!(
            store.active_plugin_version(&plugin),
            Some("1-0-0".to_string())
        );
    }
}
```

Note: plugin-version strings use `-` rather than `.` because `validate_plugin_segment` rejects `.`. This is a deliberate Solo-flavored decision: sub-project 6 (marketplace) will choose a semver-to-segment encoding when real versioned installs land. For now, `local` is the only blessed version name and semver-like strings with `-` are accepted.

- [ ] **Step 2: Run tests**

```bash
cargo test -p solo-plugins store::tests
```

Expected: all 4 tests pass.

- [ ] **Step 3: Add re-export**

Append to `crates/solo-plugins/src/lib.rs`:

```rust
pub use store::{PluginInstallResult, PluginStore, PluginStoreError};
```

- [ ] **Step 4: Verify**

```bash
cargo check -p solo-plugins
```

- [ ] **Step 5: Commit**

```bash
git add crates/solo-plugins/src/store.rs crates/solo-plugins/src/lib.rs
git commit -m "feat(plugins): PluginStore with active_plugin_version

Ports codex's local-wins rule for version directory selection. Version
strings are validated with validate_plugin_segment; non-matching directory
names are silently ignored so stray files in the cache don't break
discovery."
```

---

## Task 10: `store.rs` — install and uninstall

**Files:**
- Modify: `crates/solo-plugins/src/store.rs`

- [ ] **Step 1: Write failing tests**

Append to the `mod tests` block in `store.rs`:

```rust
    fn write_plugin(root: &Path, manifest_name: &str) {
        fs::create_dir_all(root.join(".solo-plugin")).unwrap();
        fs::write(
            root.join(".solo-plugin/plugin.json"),
            format!(r#"{{"name":"{manifest_name}"}}"#),
        )
        .unwrap();
    }

    #[test]
    fn install_copies_directory_into_cache() {
        let tmp_cache = tempdir().unwrap();
        let tmp_src = tempdir().unwrap();
        let store = PluginStore::new(tmp_cache.path().to_path_buf());
        let src = tmp_src.path().join("plugin-src");
        write_plugin(&src, "sample");

        let result = store
            .install_local(&src, id("local", "sample"), "local")
            .unwrap();

        assert_eq!(result.version, "local");
        assert!(result.installed_path.as_path().join(".solo-plugin/plugin.json").is_file());
    }

    #[test]
    fn install_rejects_duplicate() {
        let tmp_cache = tempdir().unwrap();
        let tmp_src = tempdir().unwrap();
        let store = PluginStore::new(tmp_cache.path().to_path_buf());
        let src = tmp_src.path().join("plugin-src");
        write_plugin(&src, "sample");

        store.install_local(&src, id("local", "sample"), "local").unwrap();
        let err = store
            .install_local(&src, id("local", "sample"), "local")
            .unwrap_err();
        assert!(matches!(err, PluginStoreError::Invalid(_)), "got: {err:?}");
    }

    #[test]
    fn install_rejects_non_directory_source() {
        let tmp_cache = tempdir().unwrap();
        let tmp_src = tempdir().unwrap();
        let store = PluginStore::new(tmp_cache.path().to_path_buf());
        let file = tmp_src.path().join("not-a-dir");
        fs::write(&file, "").unwrap();
        let err = store
            .install_local(&file, id("local", "x"), "local")
            .unwrap_err();
        assert!(matches!(err, PluginStoreError::Invalid(_)));
    }

    #[test]
    fn uninstall_removes_version_directory() {
        let tmp_cache = tempdir().unwrap();
        let tmp_src = tempdir().unwrap();
        let store = PluginStore::new(tmp_cache.path().to_path_buf());
        let src = tmp_src.path().join("plugin-src");
        write_plugin(&src, "sample");
        store.install_local(&src, id("local", "sample"), "local").unwrap();

        assert!(store.is_installed(&id("local", "sample")));
        store.uninstall(&id("local", "sample")).unwrap();
        assert!(!store.is_installed(&id("local", "sample")));
    }

    #[test]
    fn uninstall_missing_plugin_errors() {
        let tmp_cache = tempdir().unwrap();
        let store = PluginStore::new(tmp_cache.path().to_path_buf());
        let err = store.uninstall(&id("local", "missing")).unwrap_err();
        assert!(matches!(err, PluginStoreError::Invalid(_)));
    }
```

- [ ] **Step 2: Implement `install_local` and `uninstall`**

Add the following methods to `impl PluginStore` in `store.rs` (insert before the `// install and uninstall land in Task 10.` comment and remove that comment):

```rust
    /// Copy `source_path` into `~/.solo/plugins/cache/<marketplace>/<name>/<version>/`.
    /// Fails if the destination already exists or `source_path` is not a directory.
    pub fn install_local(
        &self,
        source_path: &Path,
        id: PluginId,
        version: &str,
    ) -> Result<PluginInstallResult, PluginStoreError> {
        if !source_path.is_dir() {
            return Err(PluginStoreError::Invalid(format!(
                "source path is not a directory: {}",
                source_path.display()
            )));
        }
        validate_plugin_segment(version, "version")
            .map_err(PluginStoreError::Invalid)?;

        let destination = self.plugin_root(&id, version);
        if destination.exists() {
            return Err(PluginStoreError::Invalid(format!(
                "plugin already installed: {}",
                destination.display()
            )));
        }
        fs::create_dir_all(destination.parent().unwrap())?;
        copy_dir_recursive(source_path, &destination)?;

        let installed_path = AbsolutePathBuf::try_from_absolute(&destination)?;
        Ok(PluginInstallResult {
            id,
            version: version.to_string(),
            installed_path,
        })
    }

    /// Remove every version directory for this plugin, and the plugin's own
    /// directory when empty. No-op if the plugin is not installed — well,
    /// returns Invalid; callers generally want to check is_installed first.
    pub fn uninstall(&self, id: &PluginId) -> Result<(), PluginStoreError> {
        let base = self.plugin_base_root(id);
        if !base.exists() {
            return Err(PluginStoreError::Invalid(format!(
                "plugin not installed: {}/{}",
                id.marketplace, id.name
            )));
        }
        fs::remove_dir_all(&base)?;
        // Remove the marketplace dir if it's now empty.
        if let Some(mk_dir) = base.parent() {
            if mk_dir.exists() && fs::read_dir(mk_dir).map(|mut i| i.next().is_none()).unwrap_or(false) {
                let _ = fs::remove_dir(mk_dir);
            }
        }
        Ok(())
    }
```

Add this free function at the bottom of `store.rs` (outside any `impl` block, outside `mod tests`):

```rust
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if ty.is_file() {
            fs::copy(&from, &to)?;
        }
        // Silently skip symlinks and other file types. Plugin directories are
        // expected to be plain files + dirs; symlinks would introduce escape risks.
    }
    Ok(())
}
```

- [ ] **Step 3: Run tests**

```bash
cargo test -p solo-plugins store::tests
```

Expected: all tests pass (both from Task 9 and this task).

- [ ] **Step 4: Commit**

```bash
git add crates/solo-plugins/src/store.rs
git commit -m "feat(plugins): PluginStore install_local and uninstall

install_local copies source_path into cache/<marketplace>/<name>/<version>/,
rejecting duplicates and non-directories. uninstall removes the plugin's
base directory and cleans up the parent marketplace dir if it's now empty.
Symlinks in the source tree are silently skipped to avoid escape risks."
```

---

## Task 11: `adapters.rs` — Claude plugins discovery

**Files:**
- Modify: `crates/solo-plugins/src/adapters.rs`

Input format: `~/.claude/plugins/installed_plugins.json`:

```json
{
  "plugins": {
    "<scope>": [
      { "installPath": "/abs/path/to/plugin-dir", "marketplaceName": "<mk>" },
      ...
    ]
  }
}
```

Output: a vector of `(PluginId, root_path, source)` triples that `loader.rs` later merges with the store.

- [ ] **Step 1: Write failing tests + implementation**

Replace `crates/solo-plugins/src/adapters.rs` with:

```rust
//! Read-only discovery of Claude and codex plugin directories.
//!
//! Solo never writes to these roots. Output is fed into loader.rs which
//! merges with the Solo-native PluginStore and applies toggles.

use crate::id::PluginId;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct AdapterPlugin {
    pub id: PluginId,
    pub root: PathBuf,
    pub source: AdapterSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterSource {
    Claude,
    Codex,
}

// ─── Claude adapter ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct ClaudeInstalledFile {
    #[serde(default)]
    plugins: std::collections::HashMap<String, Vec<ClaudeInstallEntry>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeInstallEntry {
    install_path: String,
    #[serde(default)]
    marketplace_name: Option<String>,
}

/// Discover plugins via `~/.claude/plugins/installed_plugins.json`.
/// Returns an empty vec if the file is missing or malformed.
pub fn discover_claude_adapter(claude_plugins_dir: &Path) -> Vec<AdapterPlugin> {
    let manifest = claude_plugins_dir.join("installed_plugins.json");
    let Ok(raw) = std::fs::read_to_string(&manifest) else {
        return Vec::new();
    };
    let parsed: ClaudeInstalledFile = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                path = %manifest.display(),
                "failed to parse installed_plugins.json: {err}"
            );
            return Vec::new();
        }
    };

    let mut out = Vec::new();
    for (scope, entries) in parsed.plugins {
        for entry in entries {
            let root = PathBuf::from(&entry.install_path);
            if !root.is_dir() {
                continue;
            }
            let name = match root.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let marketplace = entry
                .marketplace_name
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    if scope == "user" {
                        "claude-user".to_string()
                    } else {
                        "claude-plugins".to_string()
                    }
                });
            let Ok(id) = PluginId::new(sanitize(&marketplace), sanitize(&name)) else {
                continue;
            };
            out.push(AdapterPlugin {
                id,
                root,
                source: AdapterSource::Claude,
            });
        }
    }
    out
}

/// Replace characters that aren't valid in a PluginId segment with '-'.
fn sanitize(raw: &str) -> String {
    raw.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

// ─── Codex adapter ──────────────────────────────────────────────────
// Implementation in Task 12.
pub fn discover_codex_adapter(_codex_plugins_dir: &Path) -> Vec<AdapterPlugin> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_claude_fixture(root: &Path, json: &str, plugin_dirs: &[&str]) {
        fs::create_dir_all(root).unwrap();
        fs::write(root.join("installed_plugins.json"), json).unwrap();
        for dir in plugin_dirs {
            fs::create_dir_all(PathBuf::from(*dir)).unwrap();
        }
    }

    #[test]
    fn missing_manifest_returns_empty() {
        let tmp = tempdir().unwrap();
        let out = discover_claude_adapter(tmp.path());
        assert!(out.is_empty());
    }

    #[test]
    fn malformed_manifest_returns_empty() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("installed_plugins.json"), "not json").unwrap();
        assert!(discover_claude_adapter(tmp.path()).is_empty());
    }

    #[test]
    fn user_scope_maps_to_claude_user() {
        let tmp = tempdir().unwrap();
        let plugin_dir = tmp.path().join("sample");
        let json = format!(
            r#"{{"plugins":{{"user":[{{"installPath":"{}"}}]}}}}"#,
            plugin_dir.display()
        );
        write_claude_fixture(tmp.path(), &json, &[plugin_dir.to_str().unwrap()]);

        let out = discover_claude_adapter(tmp.path());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id.marketplace, "claude-user");
        assert_eq!(out[0].id.name, "sample");
    }

    #[test]
    fn marketplace_name_used_when_present() {
        let tmp = tempdir().unwrap();
        let plugin_dir = tmp.path().join("foo");
        let json = format!(
            r#"{{"plugins":{{"project":[{{"installPath":"{}","marketplaceName":"my-mk"}}]}}}}"#,
            plugin_dir.display()
        );
        write_claude_fixture(tmp.path(), &json, &[plugin_dir.to_str().unwrap()]);

        let out = discover_claude_adapter(tmp.path());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id.marketplace, "my-mk");
    }

    #[test]
    fn non_user_scope_falls_back_to_claude_plugins() {
        let tmp = tempdir().unwrap();
        let plugin_dir = tmp.path().join("foo");
        let json = format!(
            r#"{{"plugins":{{"workspace":[{{"installPath":"{}"}}]}}}}"#,
            plugin_dir.display()
        );
        write_claude_fixture(tmp.path(), &json, &[plugin_dir.to_str().unwrap()]);

        let out = discover_claude_adapter(tmp.path());
        assert_eq!(out[0].id.marketplace, "claude-plugins");
    }

    #[test]
    fn missing_install_path_skipped() {
        let tmp = tempdir().unwrap();
        let json = r#"{"plugins":{"user":[{"installPath":"/nonexistent/path"}]}}"#;
        fs::write(tmp.path().join("installed_plugins.json"), json).unwrap();
        assert!(discover_claude_adapter(tmp.path()).is_empty());
    }

    #[test]
    fn sanitize_handles_dots_and_slashes() {
        assert_eq!(sanitize("foo.bar"), "foo-bar");
        assert_eq!(sanitize("a/b"), "a-b");
        assert_eq!(sanitize("keep_1-2"), "keep_1-2");
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cargo test -p solo-plugins adapters::tests
```

Expected: all 7 tests pass.

- [ ] **Step 3: Add re-export**

Append to `crates/solo-plugins/src/lib.rs`:

```rust
pub use adapters::{AdapterPlugin, AdapterSource, discover_claude_adapter, discover_codex_adapter};
```

- [ ] **Step 4: Commit**

```bash
git add crates/solo-plugins/src/adapters.rs crates/solo-plugins/src/lib.rs
git commit -m "feat(plugins): Claude plugins adapter

Parses ~/.claude/plugins/installed_plugins.json and produces AdapterPlugin
entries with synthetic 'claude-user' or 'claude-plugins' marketplace
segments. Missing install paths, malformed JSON, and disk-absent plugins
are skipped silently. Names/marketplaces are sanitized to match
validate_plugin_segment rules."
```

---

## Task 12: `adapters.rs` — Codex plugins discovery

**Files:**
- Modify: `crates/solo-plugins/src/adapters.rs`

Codex's layout: `~/.codex/plugins/cache/<marketplace>/<name>/<version>/`. We walk that tree one level at a time.

- [ ] **Step 1: Write failing tests**

Append to the `mod tests` block in `adapters.rs`:

```rust
    fn make_codex_plugin(cache: &Path, marketplace: &str, name: &str, version: &str) -> PathBuf {
        let p = cache.join(marketplace).join(name).join(version);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn codex_adapter_missing_root_returns_empty() {
        let tmp = tempdir().unwrap();
        let missing = tmp.path().join("not-there");
        assert!(discover_codex_adapter(&missing).is_empty());
    }

    #[test]
    fn codex_adapter_discovers_plugins() {
        let tmp = tempdir().unwrap();
        let cache = tmp.path().join("cache");
        make_codex_plugin(&cache, "openai", "github", "1-0-0");
        make_codex_plugin(&cache, "community", "linear", "local");

        let mut out = discover_codex_adapter(&cache);
        out.sort_by(|a, b| a.id.name.cmp(&b.id.name));
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].id.marketplace, "openai");
        assert_eq!(out[0].id.name, "github");
        assert_eq!(out[1].id.marketplace, "community");
        assert_eq!(out[1].id.name, "linear");
    }

    #[test]
    fn codex_adapter_uses_latest_version_directory() {
        let tmp = tempdir().unwrap();
        let cache = tmp.path().join("cache");
        make_codex_plugin(&cache, "openai", "github", "1-0-0");
        make_codex_plugin(&cache, "openai", "github", "2-0-0");
        let out = discover_codex_adapter(&cache);
        assert_eq!(out.len(), 1);
        assert!(out[0].root.ends_with("2-0-0"));
    }

    #[test]
    fn codex_adapter_local_sentinel_wins() {
        let tmp = tempdir().unwrap();
        let cache = tmp.path().join("cache");
        make_codex_plugin(&cache, "openai", "github", "1-0-0");
        make_codex_plugin(&cache, "openai", "github", "local");
        let out = discover_codex_adapter(&cache);
        assert_eq!(out.len(), 1);
        assert!(out[0].root.ends_with("local"));
    }
```

- [ ] **Step 2: Implement `discover_codex_adapter`**

Replace the `discover_codex_adapter` stub in `adapters.rs` with:

```rust
/// Walk codex's `~/.codex/plugins/cache/<mk>/<name>/<ver>/` layout.
/// For each (marketplace, name) pair, pick the active version using the same
/// local-wins-then-lexicographic rule as PluginStore::active_plugin_version.
pub fn discover_codex_adapter(codex_cache_dir: &Path) -> Vec<AdapterPlugin> {
    let mut out = Vec::new();
    let Ok(marketplaces) = std::fs::read_dir(codex_cache_dir) else {
        return out;
    };

    for mk in marketplaces.flatten() {
        if !mk.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let marketplace_name = match mk.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue,
        };

        let Ok(plugins) = std::fs::read_dir(mk.path()) else {
            continue;
        };
        for plugin in plugins.flatten() {
            if !plugin.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let plugin_name = match plugin.file_name().into_string() {
                Ok(n) => n,
                Err(_) => continue,
            };

            let active_version = pick_active_version(&plugin.path());
            let Some(version) = active_version else {
                continue;
            };
            let root = plugin.path().join(&version);
            let Ok(id) = PluginId::new(sanitize(&marketplace_name), sanitize(&plugin_name)) else {
                continue;
            };
            out.push(AdapterPlugin {
                id,
                root,
                source: AdapterSource::Codex,
            });
        }
    }
    out
}

fn pick_active_version(plugin_dir: &Path) -> Option<String> {
    let mut versions: Vec<String> = std::fs::read_dir(plugin_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.file_type().ok().is_some_and(|t| t.is_dir()))
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    versions.sort_unstable();
    if versions.is_empty() {
        None
    } else if versions.iter().any(|v| v == "local") {
        Some("local".to_string())
    } else {
        versions.pop()
    }
}
```

- [ ] **Step 3: Run tests**

```bash
cargo test -p solo-plugins adapters::tests
```

Expected: all tests pass (claude + codex).

- [ ] **Step 4: Commit**

```bash
git add crates/solo-plugins/src/adapters.rs
git commit -m "feat(plugins): codex plugins adapter

Walks codex's cache/<marketplace>/<name>/<version>/ layout, applying the
same local-wins-then-lex version selection as PluginStore. Uses the
codex marketplace name verbatim (sanitized to valid PluginId segments)
rather than collapsing to a single synthetic name."
```

---

## Task 13: `loader.rs` — `list_plugins` orchestrator

**Files:**
- Modify: `crates/solo-plugins/src/loader.rs`

This is the orchestrator that the Tauri command layer calls. Inputs: toggles + adapter-config. Outputs: a sorted list with errors.

- [ ] **Step 1: Write failing tests + implementation**

Replace `crates/solo-plugins/src/loader.rs` with:

```rust
//! Plugin discovery orchestrator.
//!
//! Merges Solo's PluginStore with read-only adapters, applies toggles, and
//! returns a list suitable for the Tauri command layer.

use crate::adapters::{AdapterPlugin, AdapterSource, discover_claude_adapter, discover_codex_adapter};
use crate::id::PluginId;
use crate::manifest::{PluginManifest, load_plugin_manifest};
use crate::store::PluginStore;
use crate::toggles::PluginToggles;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub struct LoaderConfig<'a> {
    pub solo_home: &'a Path,
    pub claude_plugins_dir: Option<PathBuf>,
    pub codex_cache_dir: Option<PathBuf>,
    pub adapter_claude_plugins: bool,
    pub adapter_codex_user: bool,
}

#[derive(Debug, Clone)]
pub struct PluginRecord {
    pub id: PluginId,
    pub version: String,
    pub root: PathBuf,
    pub manifest: Option<PluginManifest>,
    pub source: PluginSource,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginSource {
    Local,
    Marketplace,
    ClaudeAdapter,
    CodexAdapter,
}

#[derive(Debug, Clone)]
pub struct PluginLoadError {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Debug, Clone, Default)]
pub struct PluginListOutcome {
    pub plugins: Vec<PluginRecord>,
    pub errors: Vec<PluginLoadError>,
}

pub fn list_plugins(config: LoaderConfig<'_>) -> PluginListOutcome {
    let solo_plugins_dir = config.solo_home.join("plugins");
    let store = PluginStore::new(solo_plugins_dir.clone());
    let toggles = PluginToggles::load(&solo_plugins_dir);
    let mut seen: HashSet<String> = HashSet::new();
    let mut outcome = PluginListOutcome::default();

    // 1. Solo-native cache first (first-wins).
    for (id, version, root, source) in collect_store(&store, &mut outcome.errors) {
        let key = id.as_key();
        if !seen.insert(key) {
            continue;
        }
        push_record(&mut outcome, id, version, root, source, &toggles);
    }

    // 2. Claude adapter.
    if config.adapter_claude_plugins {
        if let Some(dir) = config.claude_plugins_dir {
            for adapter in discover_claude_adapter(&dir) {
                let key = adapter.id.as_key();
                if !seen.insert(key) {
                    continue;
                }
                let version = adapter_version(&adapter.root);
                let source = match adapter.source {
                    AdapterSource::Claude => PluginSource::ClaudeAdapter,
                    AdapterSource::Codex => PluginSource::CodexAdapter, // not reachable here
                };
                push_record(&mut outcome, adapter.id, version, adapter.root, source, &toggles);
            }
        }
    }

    // 3. Codex adapter.
    if config.adapter_codex_user {
        if let Some(dir) = config.codex_cache_dir {
            for adapter in discover_codex_adapter(&dir) {
                let key = adapter.id.as_key();
                if !seen.insert(key) {
                    continue;
                }
                // Codex versions live in a subdirectory; derive from path.
                let version = adapter
                    .root
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("local")
                    .to_string();
                // For codex adapter, manifest lives under the version dir.
                push_record(
                    &mut outcome,
                    adapter.id,
                    version,
                    adapter.root,
                    PluginSource::CodexAdapter,
                    &toggles,
                );
            }
        }
    }

    // Sort: enabled first, then alphabetical by name.
    outcome.plugins.sort_by(|a, b| {
        b.enabled
            .cmp(&a.enabled)
            .then_with(|| a.id.name.cmp(&b.id.name))
    });

    outcome
}

fn collect_store(
    store: &PluginStore,
    errors: &mut Vec<PluginLoadError>,
) -> Vec<(PluginId, String, PathBuf, PluginSource)> {
    let mut out = Vec::new();
    let Ok(marketplaces) = std::fs::read_dir(store.root()) else {
        return out;
    };
    for mk_entry in marketplaces.flatten() {
        if !mk_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(marketplace) = mk_entry.file_name().to_str().map(ToString::to_string) else {
            continue;
        };
        let Ok(plugins) = std::fs::read_dir(mk_entry.path()) else {
            continue;
        };
        for plugin_entry in plugins.flatten() {
            if !plugin_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let Some(name) = plugin_entry.file_name().to_str().map(ToString::to_string) else {
                continue;
            };
            let Ok(id) = PluginId::new(marketplace.clone(), name) else {
                errors.push(PluginLoadError {
                    path: plugin_entry.path(),
                    message: "plugin directory name violates PluginId segment rules".to_string(),
                });
                continue;
            };
            let Some(version) = store.active_plugin_version(&id) else {
                continue;
            };
            let root = store.plugin_root(&id, &version);
            let source = if id.marketplace == "local" {
                PluginSource::Local
            } else {
                PluginSource::Marketplace
            };
            out.push((id, version, root, source));
        }
    }
    out
}

fn adapter_version(root: &Path) -> String {
    // Claude plugin dirs don't carry a version subpath; read manifest's
    // top-level `version` field if present, else "local".
    load_plugin_manifest(root)
        .and_then(|m| m.version)
        .unwrap_or_else(|| "local".to_string())
}

fn push_record(
    outcome: &mut PluginListOutcome,
    id: PluginId,
    version: String,
    root: PathBuf,
    source: PluginSource,
    toggles: &PluginToggles,
) {
    let manifest = load_plugin_manifest(&root);
    if manifest.is_none() {
        outcome.errors.push(PluginLoadError {
            path: root.clone(),
            message: "missing or invalid plugin manifest".to_string(),
        });
    }
    let enabled = toggles.enabled_for(&id, true);
    outcome.plugins.push(PluginRecord {
        id,
        version,
        root,
        manifest,
        source,
        enabled,
    });
}

pub fn get_plugin_detail(config: LoaderConfig<'_>, id: &PluginId) -> Option<PluginRecord> {
    list_plugins(config).plugins.into_iter().find(|r| &r.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_plugin(root: &Path, manifest_name: &str) {
        fs::create_dir_all(root.join(".solo-plugin")).unwrap();
        fs::write(
            root.join(".solo-plugin/plugin.json"),
            format!(r#"{{"name":"{manifest_name}"}}"#),
        )
        .unwrap();
    }

    fn make_config<'a>(solo_home: &'a Path) -> LoaderConfig<'a> {
        LoaderConfig {
            solo_home,
            claude_plugins_dir: None,
            codex_cache_dir: None,
            adapter_claude_plugins: false,
            adapter_codex_user: false,
        }
    }

    #[test]
    fn empty_everything_returns_empty() {
        let tmp = tempdir().unwrap();
        let out = list_plugins(make_config(tmp.path()));
        assert!(out.plugins.is_empty());
        assert!(out.errors.is_empty());
    }

    #[test]
    fn solo_cache_plugins_discovered() {
        let tmp = tempdir().unwrap();
        let plugin_root = tmp
            .path()
            .join("plugins/cache/local/alpha/local");
        write_plugin(&plugin_root, "alpha");

        let out = list_plugins(make_config(tmp.path()));
        assert_eq!(out.plugins.len(), 1);
        assert_eq!(out.plugins[0].id.name, "alpha");
        assert_eq!(out.plugins[0].source, PluginSource::Local);
    }

    #[test]
    fn adapter_gated_by_config() {
        let tmp = tempdir().unwrap();
        let claude_dir = tmp.path().join("claude");
        let plugin_dir = tmp.path().join("claude-plugin");
        write_plugin(&plugin_dir, "from-claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("installed_plugins.json"),
            format!(
                r#"{{"plugins":{{"user":[{{"installPath":"{}"}}]}}}}"#,
                plugin_dir.display()
            ),
        )
        .unwrap();

        let mut cfg = make_config(tmp.path());
        cfg.claude_plugins_dir = Some(claude_dir.clone());
        // Claude adapter OFF → empty.
        cfg.adapter_claude_plugins = false;
        assert!(list_plugins(LoaderConfig { ..cfg }).plugins.is_empty());

        // Claude adapter ON → one plugin.
        let cfg = LoaderConfig {
            adapter_claude_plugins: true,
            claude_plugins_dir: Some(claude_dir),
            ..make_config(tmp.path())
        };
        let out = list_plugins(cfg);
        assert_eq!(out.plugins.len(), 1);
        assert_eq!(out.plugins[0].source, PluginSource::ClaudeAdapter);
    }

    #[test]
    fn solo_wins_on_id_collision() {
        let tmp = tempdir().unwrap();
        // Solo-native plugin with marketplace "claude-user" name "dup".
        let solo_plugin = tmp
            .path()
            .join("plugins/cache/claude-user/dup/local");
        write_plugin(&solo_plugin, "dup");
        // Claude adapter fixture with same id.
        let claude_dir = tmp.path().join("claude");
        let ext_dup = tmp.path().join("dup");
        write_plugin(&ext_dup, "dup");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("installed_plugins.json"),
            format!(
                r#"{{"plugins":{{"user":[{{"installPath":"{}"}}]}}}}"#,
                ext_dup.display()
            ),
        )
        .unwrap();

        let cfg = LoaderConfig {
            adapter_claude_plugins: true,
            claude_plugins_dir: Some(claude_dir),
            ..make_config(tmp.path())
        };
        let out = list_plugins(cfg);
        assert_eq!(out.plugins.len(), 1);
        assert_eq!(out.plugins[0].source, PluginSource::Marketplace); // not Local, because marketplace != "local"
    }

    #[test]
    fn malformed_plugin_surfaces_as_error_not_failure() {
        let tmp = tempdir().unwrap();
        // good plugin
        let good = tmp.path().join("plugins/cache/local/good/local");
        write_plugin(&good, "good");
        // bad plugin: no manifest at all
        let bad = tmp.path().join("plugins/cache/local/bad/local");
        fs::create_dir_all(&bad).unwrap();

        let out = list_plugins(make_config(tmp.path()));
        assert_eq!(out.plugins.len(), 2); // both surface as records
        assert_eq!(out.errors.len(), 1);
        assert!(out.errors[0].path.ends_with("bad/local"));
    }

    #[test]
    fn toggles_applied_in_records() {
        let tmp = tempdir().unwrap();
        let plugin_root = tmp.path().join("plugins/cache/local/alpha/local");
        write_plugin(&plugin_root, "alpha");
        // Flip alpha to disabled.
        let mut toggles = PluginToggles::default();
        toggles.set_enabled(&PluginId::new("local".into(), "alpha".into()).unwrap(), false);
        toggles.save(&tmp.path().join("plugins")).unwrap();

        let out = list_plugins(make_config(tmp.path()));
        assert_eq!(out.plugins.len(), 1);
        assert!(!out.plugins[0].enabled);
    }

    #[test]
    fn sort_puts_enabled_first_then_alphabetical() {
        let tmp = tempdir().unwrap();
        for name in ["zebra", "alpha", "beta"] {
            let root = tmp.path().join(format!("plugins/cache/local/{name}/local"));
            write_plugin(&root, name);
        }
        // Disable alpha.
        let mut toggles = PluginToggles::default();
        toggles.set_enabled(&PluginId::new("local".into(), "alpha".into()).unwrap(), false);
        toggles.save(&tmp.path().join("plugins")).unwrap();

        let out = list_plugins(make_config(tmp.path()));
        assert_eq!(
            out.plugins.iter().map(|r| r.id.name.as_str()).collect::<Vec<_>>(),
            vec!["beta", "zebra", "alpha"],
        );
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cargo test -p solo-plugins loader::tests
```

Expected: all 6 tests pass.

- [ ] **Step 3: Add re-exports**

Append to `crates/solo-plugins/src/lib.rs`:

```rust
pub use loader::{
    LoaderConfig, PluginListOutcome, PluginLoadError, PluginRecord, PluginSource,
    get_plugin_detail, list_plugins,
};
```

- [ ] **Step 4: Verify full crate compiles + all tests pass**

```bash
cargo check -p solo-plugins
cargo test -p solo-plugins
cargo clippy -p solo-plugins -- -D warnings
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add crates/solo-plugins/src/loader.rs crates/solo-plugins/src/lib.rs
git commit -m "feat(plugins): list_plugins orchestrator + get_plugin_detail

Merges Solo's PluginStore with Claude/codex adapters, applies the
first-wins-on-collision rule (Solo > Claude > Codex), loads toggles,
and sorts enabled-first then alphabetically. Malformed plugins surface
as PluginLoadError entries instead of failing the list."
```

---

## Task 14: Protocol types in `solo-protocol`

**Files:**
- Modify: `crates/solo-protocol/src/lib.rs`
- Generated (review only): `apps/desktop/src/bindings/*`

All wire-visible types live here, alongside existing Terminal/Skills/etc types.

- [ ] **Step 1: Append new types to `solo-protocol/src/lib.rs`**

Add these blocks at the **end** of `crates/solo-protocol/src/lib.rs`, before any final test module:

```rust
// =============================================================================
// Plugins Protocol
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS, Hash, PartialEq, Eq)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginId {
    pub marketplace: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum PluginSource {
    Local,
    Marketplace,
    ClaudeAdapter,
    CodexAdapter,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginSummary {
    pub id: PluginId,
    pub version: String,
    pub display_name: String,
    pub short_description: Option<String>,
    pub logo: Option<String>,
    pub brand_color: Option<String>,
    pub enabled: bool,
    pub source: PluginSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginDetail {
    pub id: PluginId,
    pub version: String,
    pub source: PluginSource,
    pub enabled: bool,
    pub root_path: String,
    pub description: Option<String>,
    pub interface: Option<PluginInterface>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
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
    pub default_prompts: Vec<String>,
    pub brand_color: Option<String>,
    pub composer_icon: Option<String>,
    pub logo: Option<String>,
    pub screenshots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginInstallResult {
    pub id: PluginId,
    pub version: String,
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginListOutcome {
    pub plugins: Vec<PluginSummary>,
    pub errors: Vec<PluginLoadError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginLoadError {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginsConfig {
    #[serde(default = "default_true")]
    pub adapter_claude_plugins: bool,
    #[serde(default = "default_true")]
    pub adapter_codex_user: bool,
}

impl Default for PluginsConfig {
    fn default() -> Self {
        Self {
            adapter_claude_plugins: true,
            adapter_codex_user: true,
        }
    }
}

fn default_true() -> bool {
    true
}
```

Then find the existing `SoloSettings` struct (around line 1040 per our earlier grep) and add a `plugins: PluginsConfig` field to it. The existing struct looks roughly like:

```rust
pub struct SoloSettings {
    // ... existing fields ...
    pub skills: SkillsConfig,
    // ... other fields ...
}
```

Add `plugins` next to `skills`:

```rust
    #[serde(default)]
    pub plugins: PluginsConfig,
```

- [ ] **Step 2: Run `bun run gen:bindings` and verify new TS files appear**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
bun run gen:bindings
ls apps/desktop/src/bindings/ | grep -E "Plugin"
```

Expected output includes: `PluginDetail.ts`, `PluginId.ts`, `PluginInstallResult.ts`, `PluginInterface.ts`, `PluginListOutcome.ts`, `PluginLoadError.ts`, `PluginSource.ts`, `PluginSummary.ts`, `PluginsConfig.ts`.

- [ ] **Step 3: Verify build**

```bash
bun run check
```

Expected: clean (cargo check + tsc both pass).

- [ ] **Step 4: Commit**

```bash
git add crates/solo-protocol/src/lib.rs apps/desktop/src/bindings/Plugin*.ts apps/desktop/src/bindings/PluginsConfig.ts
git commit -m "feat(plugins): protocol types + generated TS bindings

Adds PluginId, PluginSource, PluginSummary, PluginDetail, PluginInterface,
PluginInstallResult, PluginListOutcome, PluginLoadError, PluginsConfig.
PluginsConfig defaults both adapter flags to true. Bindings regenerated
via bun run gen:bindings."
```

---

## Task 15: Settings wiring in `solo-core`

**Files:**
- Modify: `crates/solo-core/src/settings.rs`

Follow the exact pattern used for `SkillsConfig` (already in the file).

- [ ] **Step 1: Add the PluginsConfig helpers**

Open `crates/solo-core/src/settings.rs` and add the following (locate the existing `load_skills_config` / `update_skill_imports` helpers — add the plugin equivalents immediately below them). Also update the imports at the top:

```rust
use solo_protocol::{PermissionsConfig, PluginsConfig, SettingsScope, SkillsConfig, SoloSettings};
```

Inside the `merge_into` function, locate the line `dst.skills = src.skills;` and add right after it:

```rust
    // plugins — higher scope fully overrides
    if (src.plugins.adapter_claude_plugins, src.plugins.adapter_codex_user)
        != (PluginsConfig::default().adapter_claude_plugins, PluginsConfig::default().adapter_codex_user)
    {
        dst.plugins = src.plugins;
    }
```

Then, after the existing `load_skills_config`, `mark_skills_onboarding_shown`, `reset_skills_onboarding`, `update_skill_imports` helpers, append:

```rust
/// Shorthand: load only the `plugins` section (merged).
pub fn load_plugins_config(workspace: &Path) -> Result<PluginsConfig> {
    Ok(load_merged(workspace)?.plugins)
}

/// Toggle adapter flags in the user-scope settings file.
pub fn update_plugins_adapters(
    workspace: &Path,
    claude_plugins: Option<bool>,
    codex_user: Option<bool>,
) -> Result<SoloSettings> {
    let path = settings_path_for_scope(SettingsScope::User, workspace)?;
    let mut settings = load_scope(SettingsScope::User, workspace)?;
    if let Some(v) = claude_plugins {
        settings.plugins.adapter_claude_plugins = v;
    }
    if let Some(v) = codex_user {
        settings.plugins.adapter_codex_user = v;
    }
    let serialized = serde_json::to_string_pretty(&settings)?;
    fs::write(&path, serialized).with_context(|| format!("writing {}", path.display()))?;
    Ok(settings)
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo check -p solo-core
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add crates/solo-core/src/settings.rs
git commit -m "feat(plugins): solo-core settings helpers for PluginsConfig

Adds load_plugins_config and update_plugins_adapters, mirroring the
existing SkillsConfig helpers. Adapter flags default to true (both
claude-plugins and codex-user adapters on)."
```

---

## Task 16: `plugins_commands.rs` — Tauri command layer

**Files:**
- Create: `apps/desktop/src-tauri/src/plugins_commands.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml` (add solo-plugins dep)

- [ ] **Step 1: Add `solo-plugins` dep to the desktop Cargo.toml**

Open `apps/desktop/src-tauri/Cargo.toml` and find the dependencies block. Add (keeping alphabetical order with the other `solo-*` deps):

```toml
solo-plugins = { path = "../../../crates/solo-plugins" }
```

Verify the crate picks it up:

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo check -p solo-desktop-lib
```

Expected: clean (no errors; this step just adds the path dep).

- [ ] **Step 2: Create `plugins_commands.rs`**

Create `apps/desktop/src-tauri/src/plugins_commands.rs`:

```rust
//! Tauri command surface for the plugin system.
//!
//! 5 commands: plugins_list, plugins_get_detail, plugins_set_enabled,
//! plugins_install_local, plugins_uninstall.

use solo_core::settings as settings_io;
use solo_plugins::{
    LoaderConfig, PluginId as CoreId, PluginSource as CoreSource, PluginStore,
    PluginStoreError, PluginToggles, get_plugin_detail, list_plugins, load_plugin_manifest,
};
use solo_protocol::{
    PluginDetail, PluginId, PluginInstallResult, PluginInterface, PluginListOutcome,
    PluginLoadError, PluginSource, PluginSummary,
};
use std::path::PathBuf;
use tauri::State;

pub struct PluginsState {
    home_dir: PathBuf,
}

impl PluginsState {
    pub fn new() -> Self {
        let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        Self { home_dir }
    }

    fn solo_home(&self) -> PathBuf {
        self.home_dir.join(".solo")
    }

    fn claude_plugins_dir(&self) -> PathBuf {
        self.home_dir.join(".claude").join("plugins")
    }

    fn codex_cache_dir(&self) -> PathBuf {
        self.home_dir.join(".codex").join("plugins").join("cache")
    }
}

// Conversion helpers between solo-plugins core types and solo-protocol wire types.

fn wire_id(core: CoreId) -> PluginId {
    PluginId {
        marketplace: core.marketplace,
        name: core.name,
    }
}

fn core_id(wire: PluginId) -> Result<CoreId, String> {
    CoreId::new(wire.marketplace, wire.name).map_err(|e| e.to_string())
}

fn wire_source(core: CoreSource) -> PluginSource {
    match core {
        CoreSource::Local => PluginSource::Local,
        CoreSource::Marketplace => PluginSource::Marketplace,
        CoreSource::ClaudeAdapter => PluginSource::ClaudeAdapter,
        CoreSource::CodexAdapter => PluginSource::CodexAdapter,
    }
}

fn record_to_summary(record: solo_plugins::PluginRecord) -> PluginSummary {
    let interface = record.manifest.as_ref().and_then(|m| m.interface.as_ref());
    let display_name = interface
        .and_then(|i| i.display_name.clone())
        .unwrap_or_else(|| record.id.name.clone());
    let short_description = interface.and_then(|i| i.short_description.clone());
    let logo = interface.and_then(|i| {
        i.logo
            .as_ref()
            .map(|p| p.as_path().to_string_lossy().into_owned())
    });
    let brand_color = interface.and_then(|i| i.brand_color.clone());

    PluginSummary {
        id: wire_id(record.id),
        version: record.version,
        display_name,
        short_description,
        logo,
        brand_color,
        enabled: record.enabled,
        source: wire_source(record.source),
    }
}

fn record_to_detail(record: solo_plugins::PluginRecord) -> PluginDetail {
    let manifest = record.manifest.clone();
    let interface = manifest
        .as_ref()
        .and_then(|m| m.interface.as_ref())
        .map(|i| PluginInterface {
            display_name: i.display_name.clone(),
            short_description: i.short_description.clone(),
            long_description: i.long_description.clone(),
            developer_name: i.developer_name.clone(),
            category: i.category.clone(),
            capabilities: i.capabilities.clone(),
            website_url: i.website_url.clone(),
            privacy_policy_url: i.privacy_policy_url.clone(),
            terms_of_service_url: i.terms_of_service_url.clone(),
            default_prompts: i.default_prompts.clone(),
            brand_color: i.brand_color.clone(),
            composer_icon: i
                .composer_icon
                .as_ref()
                .map(|p| p.as_path().to_string_lossy().into_owned()),
            logo: i
                .logo
                .as_ref()
                .map(|p| p.as_path().to_string_lossy().into_owned()),
            screenshots: i
                .screenshots
                .iter()
                .map(|p| p.as_path().to_string_lossy().into_owned())
                .collect(),
        });

    PluginDetail {
        id: wire_id(record.id),
        version: record.version,
        source: wire_source(record.source),
        enabled: record.enabled,
        root_path: record.root.to_string_lossy().into_owned(),
        description: manifest.and_then(|m| m.description),
        interface,
    }
}
```

The five commands build `LoaderConfig` inline. We don't extract a `loader_config_for` helper because `LoaderConfig.solo_home: &'a Path` has a borrowed lifetime that doesn't compose well with a function that owns the PathBuf — the borrow outlives the helper's stack frame. Inline construction at each call site is the simpler pattern.

Continuing `plugins_commands.rs` — append the five commands:

```rust
#[tauri::command]
pub async fn plugins_list(
    cwd: String,
    state: State<'_, PluginsState>,
) -> Result<PluginListOutcome, String> {
    let workspace = PathBuf::from(&cwd);
    let config = settings_io::load_plugins_config(&workspace).unwrap_or_default();
    let solo_home = state.solo_home();
    let claude_plugins_dir = {
        let d = state.claude_plugins_dir();
        d.exists().then_some(d)
    };
    let codex_cache_dir = {
        let d = state.codex_cache_dir();
        d.exists().then_some(d)
    };

    let outcome = list_plugins(LoaderConfig {
        solo_home: &solo_home,
        claude_plugins_dir,
        codex_cache_dir,
        adapter_claude_plugins: config.adapter_claude_plugins,
        adapter_codex_user: config.adapter_codex_user,
    });

    Ok(PluginListOutcome {
        plugins: outcome.plugins.into_iter().map(record_to_summary).collect(),
        errors: outcome
            .errors
            .into_iter()
            .map(|e| PluginLoadError {
                path: e.path.to_string_lossy().into_owned(),
                message: e.message,
            })
            .collect(),
    })
}

#[tauri::command]
pub async fn plugins_get_detail(
    cwd: String,
    id: PluginId,
    state: State<'_, PluginsState>,
) -> Result<PluginDetail, String> {
    let workspace = PathBuf::from(&cwd);
    let config = settings_io::load_plugins_config(&workspace).unwrap_or_default();
    let solo_home = state.solo_home();
    let claude_plugins_dir = {
        let d = state.claude_plugins_dir();
        d.exists().then_some(d)
    };
    let codex_cache_dir = {
        let d = state.codex_cache_dir();
        d.exists().then_some(d)
    };
    let core_id = core_id(id)?;

    let record = get_plugin_detail(
        LoaderConfig {
            solo_home: &solo_home,
            claude_plugins_dir,
            codex_cache_dir,
            adapter_claude_plugins: config.adapter_claude_plugins,
            adapter_codex_user: config.adapter_codex_user,
        },
        &core_id,
    )
    .ok_or_else(|| format!("plugin not found: {}/{}", core_id.marketplace, core_id.name))?;

    Ok(record_to_detail(record))
}

#[tauri::command]
pub async fn plugins_set_enabled(
    cwd: String,
    id: PluginId,
    enabled: bool,
    state: State<'_, PluginsState>,
) -> Result<PluginSummary, String> {
    let core_id = core_id(id.clone())?;
    let solo_plugins_dir = state.solo_home().join("plugins");

    let mut toggles = PluginToggles::load(&solo_plugins_dir);
    toggles.set_enabled(&core_id, enabled);
    toggles
        .save(&solo_plugins_dir)
        .map_err(|e| format!("failed to save toggles: {e}"))?;

    // Re-list to return the updated summary.
    let workspace = PathBuf::from(&cwd);
    let config = settings_io::load_plugins_config(&workspace).unwrap_or_default();
    let solo_home = state.solo_home();
    let claude_plugins_dir = state.claude_plugins_dir();
    let codex_cache_dir = state.codex_cache_dir();
    let record = get_plugin_detail(
        LoaderConfig {
            solo_home: &solo_home,
            claude_plugins_dir: claude_plugins_dir.exists().then_some(claude_plugins_dir),
            codex_cache_dir: codex_cache_dir.exists().then_some(codex_cache_dir),
            adapter_claude_plugins: config.adapter_claude_plugins,
            adapter_codex_user: config.adapter_codex_user,
        },
        &core_id,
    )
    .ok_or_else(|| format!("plugin not found after toggle: {}", core_id.name))?;

    Ok(record_to_summary(record))
}

#[tauri::command]
pub async fn plugins_install_local(
    source_path: String,
    state: State<'_, PluginsState>,
) -> Result<PluginInstallResult, String> {
    let source = PathBuf::from(&source_path);
    let manifest = load_plugin_manifest(&source)
        .ok_or_else(|| "missing or invalid plugin.json in source directory".to_string())?;

    let name = if manifest.name.is_empty() {
        source
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "could not derive plugin name from source path".to_string())?
            .to_string()
    } else {
        manifest.name
    };

    let core_id = solo_plugins::PluginId::new("local".to_string(), name).map_err(|e| e.to_string())?;
    let solo_plugins_dir = state.solo_home().join("plugins");
    let store = PluginStore::new(solo_plugins_dir);
    let result = store
        .install_local(&source, core_id, "local")
        .map_err(|e: PluginStoreError| e.to_string())?;

    Ok(PluginInstallResult {
        id: wire_id(result.id),
        version: result.version,
        root_path: result.installed_path.as_path().to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn plugins_uninstall(
    id: PluginId,
    state: State<'_, PluginsState>,
) -> Result<(), String> {
    let core_id = core_id(id.clone())?;
    // Only Local/Marketplace plugins live in our cache; adapters are read-only.
    if core_id.marketplace != "local"
        && !core_id.marketplace.starts_with("marketplace-")
    {
        return Err(format!(
            "cannot uninstall adapter-discovered plugin: {}/{}",
            core_id.marketplace, core_id.name
        ));
    }
    let solo_plugins_dir = state.solo_home().join("plugins");
    let store = PluginStore::new(solo_plugins_dir);
    store.uninstall(&core_id).map_err(|e| e.to_string())
}
```

The imports block at the top of `plugins_commands.rs` is already correct from Step 2. No cleanup needed.

- [ ] **Step 3: Run `cargo check -p solo-desktop-lib`**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo check -p solo-desktop-lib
```

The command module doesn't get registered until Task 17, but the file itself needs to compile standalone once `mod plugins_commands;` is added. To check compilation in isolation here, also run:

```bash
cargo check -p solo-plugins
```

Expected: clean. (If you see "unused module" on `plugins_commands.rs`, ignore — Task 17 registers it.)

Note: the file won't be picked up by `solo-desktop-lib` until the `mod plugins_commands;` line is added in Task 17. If `cargo check` ignores it for now, that's fine.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/src/plugins_commands.rs
git commit -m "feat(plugins): Tauri command layer

Five commands: plugins_list, plugins_get_detail, plugins_set_enabled,
plugins_install_local, plugins_uninstall. Builds LoaderConfig per-call
from PluginsConfig (claude/codex adapters from user settings) plus
state-held home-directory paths. Converts between solo-plugins core
types and solo-protocol wire types inline."
```

---

## Task 17: Register commands in `lib.rs`

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add module declaration**

Open `apps/desktop/src-tauri/src/lib.rs`. Locate the block of `mod *_commands;` declarations (around lines 32–49). Insert, keeping alphabetical order:

```rust
mod plugins_commands;
```

- [ ] **Step 2: Add state import**

Locate the block of `use *_commands::*State;` declarations (around lines 51–63). Add:

```rust
use plugins_commands::PluginsState;
```

- [ ] **Step 3: Register the state via `.manage()`**

Locate the `.manage(FsState::new())` chain (around lines 182–191). Add (alphabetical in the chain keeps it readable):

```rust
        .manage(PluginsState::new())
```

- [ ] **Step 4: Register commands in `generate_handler!`**

Locate the existing `skills_commands::*` entries in the `tauri::generate_handler![` block (around lines 349–355). Add the five new commands right after the skills block:

```rust
            plugins_commands::plugins_list,
            plugins_commands::plugins_get_detail,
            plugins_commands::plugins_set_enabled,
            plugins_commands::plugins_install_local,
            plugins_commands::plugins_uninstall,
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
bun run check
```

Expected: clean (cargo check + tsc both pass).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(plugins): register plugins_commands in Tauri handler

Adds mod + use + .manage(PluginsState::new()) + five command entries
in the generate_handler! block."
```

---

## Task 18: TS wrapper `plugins.ts`

**Files:**
- Create: `apps/desktop/src/lib/tauri/plugins.ts`

- [ ] **Step 1: Create the wrapper**

```typescript
// apps/desktop/src/lib/tauri/plugins.ts
//
// Typed wrappers over the plugins_* Tauri commands. Types come from the
// auto-generated bindings in @/bindings — never hand-edit those.

import { invoke } from '@tauri-apps/api/core';
import type { PluginDetail } from '@/bindings/PluginDetail';
import type { PluginId } from '@/bindings/PluginId';
import type { PluginInstallResult } from '@/bindings/PluginInstallResult';
import type { PluginListOutcome } from '@/bindings/PluginListOutcome';
import type { PluginSummary } from '@/bindings/PluginSummary';

export const pluginsApi = {
  list: (cwd: string): Promise<PluginListOutcome> =>
    invoke<PluginListOutcome>('plugins_list', { cwd }),

  getDetail: (cwd: string, id: PluginId): Promise<PluginDetail> =>
    invoke<PluginDetail>('plugins_get_detail', { cwd, id }),

  setEnabled: (cwd: string, id: PluginId, enabled: boolean): Promise<PluginSummary> =>
    invoke<PluginSummary>('plugins_set_enabled', { cwd, id, enabled }),

  installLocal: (sourcePath: string): Promise<PluginInstallResult> =>
    invoke<PluginInstallResult>('plugins_install_local', { sourcePath }),

  uninstall: (id: PluginId): Promise<void> =>
    invoke<void>('plugins_uninstall', { id }),
} as const;
```

- [ ] **Step 2: Verify TypeScript build**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
bun run check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/lib/tauri/plugins.ts
git commit -m "feat(plugins): TS wrapper for plugins_* commands

Five typed invoke() calls using the auto-generated bindings. Module
is not consumed anywhere yet (UI lands in sub-project 3) but the
wrapper shape is exercised by the type system on build."
```

---

## Task 19: Integration test `tests/round_trip.rs`

**Files:**
- Create: `crates/solo-plugins/tests/round_trip.rs`

This exercises end-to-end: a fixture plugin is installed, listed, toggled, detailed, and uninstalled — all against a tempdir-backed `solo_home`.

- [ ] **Step 1: Write the integration test**

Create `crates/solo-plugins/tests/round_trip.rs`:

```rust
//! End-to-end round-trip: install → list → toggle → detail → uninstall.
//!
//! Uses a tempdir as `solo_home` so it never touches the real ~/.solo/.

use solo_plugins::{
    LoaderConfig, PluginId, PluginStore, PluginToggles, get_plugin_detail, list_plugins,
};
use std::fs;
use std::path::Path;
use tempfile::tempdir;

fn write_fixture_plugin(root: &Path, name: &str, display_name: &str) {
    fs::create_dir_all(root.join(".solo-plugin")).unwrap();
    fs::write(
        root.join(".solo-plugin/plugin.json"),
        format!(
            r#"{{"name":"{name}","interface":{{"displayName":"{display_name}","shortDescription":"fixture"}}}}"#
        ),
    )
    .unwrap();
}

#[test]
fn install_list_toggle_detail_uninstall() {
    let solo_home = tempdir().unwrap();
    let fixture_src = tempdir().unwrap();
    let source = fixture_src.path().join("fixture");
    write_fixture_plugin(&source, "fixture", "Fixture Plugin");

    // 1. Install.
    let store = PluginStore::new(solo_home.path().join("plugins"));
    let id = PluginId::new("local".into(), "fixture".into()).unwrap();
    let install = store.install_local(&source, id.clone(), "local").unwrap();
    assert_eq!(install.version, "local");

    // 2. List — adapter flags off so we only see the Solo-native install.
    let make_cfg = || LoaderConfig {
        solo_home: solo_home.path(),
        claude_plugins_dir: None,
        codex_cache_dir: None,
        adapter_claude_plugins: false,
        adapter_codex_user: false,
    };
    let listed = list_plugins(make_cfg());
    assert_eq!(listed.plugins.len(), 1);
    assert_eq!(listed.plugins[0].id, id);
    assert!(listed.plugins[0].enabled, "default enabled");

    // 3. Toggle disabled.
    let mut toggles = PluginToggles::load(&solo_home.path().join("plugins"));
    toggles.set_enabled(&id, false);
    toggles.save(&solo_home.path().join("plugins")).unwrap();
    let listed_after = list_plugins(make_cfg());
    assert!(!listed_after.plugins[0].enabled);

    // 4. Get detail.
    let detail = get_plugin_detail(make_cfg(), &id).unwrap();
    assert_eq!(detail.id, id);
    assert_eq!(
        detail.manifest.as_ref().and_then(|m| m.interface.as_ref()).and_then(|i| i.display_name.clone()),
        Some("Fixture Plugin".to_string())
    );

    // 5. Uninstall.
    store.uninstall(&id).unwrap();
    let listed_empty = list_plugins(make_cfg());
    assert!(listed_empty.plugins.is_empty());
    assert!(listed_empty.errors.is_empty());
}
```

- [ ] **Step 2: Run the integration test**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo test -p solo-plugins --test round_trip
```

Expected: test passes.

- [ ] **Step 3: Commit**

```bash
git add crates/solo-plugins/tests/round_trip.rs
git commit -m "test(plugins): end-to-end round-trip integration test

Covers install → list → toggle → detail → uninstall against a tempdir
solo_home. Does not touch the user's real ~/.solo/ directory."
```

---

## Task 20: Final verification

**Files:** (no code changes — verification only)

- [ ] **Step 1: Full workspace check**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
bun run check
```

Expected: cargo check and tsc both clean.

- [ ] **Step 2: Full workspace clippy**

```bash
cargo clippy --workspace -- -D warnings
```

Expected: no new warnings anywhere (not just in `solo-plugins`).

- [ ] **Step 3: Full test suite**

```bash
cargo test -p solo-plugins
bun run test   # if the frontend test harness has anything to say about the bindings
```

Expected: all tests pass.

- [ ] **Step 4: Bindings freshness check**

```bash
bun run gen:bindings
git status apps/desktop/src/bindings/
```

Expected: no files modified after regeneration. If there are diffs, the `ts-rs` state is out of sync with the `solo-protocol` types — investigate and regenerate.

- [ ] **Step 5: Manual devtools smoke test**

Launch the app:

```bash
bun run dev
```

Open DevTools (Cmd+Opt+I), switch to Console, run:

```javascript
// 1. List (should return empty plugins + empty errors, or Claude-adapter discoveries
//    if the user has ~/.claude/plugins/).
await window.__TAURI__.core.invoke('plugins_list', { cwd: '/Users/sachin/Developer/Orbit_Main/solo' });

// 2. Toggle a known plugin (if any) to disabled.
// await window.__TAURI__.core.invoke('plugins_set_enabled', {
//   cwd: '/Users/sachin/Developer/Orbit_Main/solo',
//   id: { marketplace: 'claude-user', name: '<some-plugin>' },
//   enabled: false,
// });

// 3. Get detail.
// await window.__TAURI__.core.invoke('plugins_get_detail', {
//   cwd: '/Users/sachin/Developer/Orbit_Main/solo',
//   id: { marketplace: 'claude-user', name: '<some-plugin>' },
// });
```

Expected: each call returns JSON matching the `PluginListOutcome` / `PluginSummary` / `PluginDetail` shapes. No uncaught exceptions, no 500s.

- [ ] **Step 6: Skills tab regression check**

In the running app, open Settings → Skills. Confirm the skill list renders the same set of skills it did before this branch. Toggle a skill-adapter source off and on — verify the list updates (regression test for sub-project 1's promise that `skills_commands.rs` is byte-identical).

- [ ] **Step 7: Final commit (nothing to commit unless verification turned up a fix)**

If everything passes, there's nothing to commit. If verification uncovered a real issue, fix inline, commit with message prefix `fix(plugins):`.

---

## Post-implementation checklist

- [ ] `bun run check` green
- [ ] `cargo clippy --workspace -- -D warnings` green
- [ ] `cargo test -p solo-plugins` green (unit + integration)
- [ ] `bun run gen:bindings` produces no diff
- [ ] `apps/desktop/src/bindings/Plugin*.ts` files exist and match the protocol types
- [ ] Devtools smoke test exercises all 5 commands without error
- [ ] Skills tab behavior is unchanged (no regressions)
- [ ] No references to "Claude Code" or the legacy Electron product name in commit messages, comments, or strings (per `solo/CLAUDE.md` branding policy)
- [ ] No `Co-Authored-By: Claude` in any commit message

---

## What to do after this plan lands

After sub-project 1 lands, the next step is **sub-project 2 (skills leg wiring)**: update `skills_commands.rs::discover_claude_plugins` (and related) to source plugin skills through `solo_plugins::list_plugins` rather than its own hand-rolled `installed_plugins.json` parse. This is the cleanup that removes the temporary duplication explicitly accepted in the spec's out-of-scope section.

**Do not start sub-project 2 in this plan.** Open a new brainstorming pass for it — the unification has its own scope and risk (touching the skills pipeline directly affects the running agent, unlike this foundation which only runs when a devtools `invoke` asks for it).
