# Skills Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an open-source skills marketplace in Solo's vault sidebar that can install, browse, and auto-suggest skills from `github.com/solo/skills-registry`, with the UI skill bundled by default.

**Architecture:** Per-skill `AGENTS.md` (with `SKILL.md` fallback), monorepo registry fetched as static JSON, markdown-only content, embeddings-based semantic search surfacing suggestions above the agent input. Runtime integration keeps installed skills auto-injected into the system prompt; uninstalled skills only appear as UI suggestions (never as prompt-side tools).

**Tech Stack:** Rust (Tauri commands, `reqwest`, `flate2`, `tar`, `sha2`, `include_dir`), TypeScript (React 19, Zustand + Immer, Vitest), existing `solo-embeddings` crate, existing `agent-bridge` Node sidecar.

**Spec:** `docs/superpowers/specs/2026-04-18-skills-marketplace-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `crates/solo-protocol/src/lib.rs` (append) | `RegistryEntry`, `SkillSuggestion`, `InstalledSkillMeta`, new `BackendEvent` variants |
| `apps/desktop/src-tauri/src/skills_marketplace.rs` | Registry fetch/cache, install, uninstall, sha256, path-traversal guard, tarball extract |
| `apps/desktop/src-tauri/src/skills_search.rs` | Query embedding, cosine ranking over registry, dismiss tracking |
| `apps/desktop/src-tauri/src/skills_bundled.rs` | `include_dir!` UI skill, first-launch extraction |
| `apps/desktop/src-tauri/src/skills_aggregate.rs` | Workspace-root `AGENTS.md` generator with solo fence |
| `apps/desktop/src-tauri/bundled-skills/ui/` | Copy of `Inspirations/Skills/ui/` with `SKILL.md`→`AGENTS.md` rename |
| `apps/desktop/src/lib/tauri/marketplace.ts` | TS wrappers for new commands |
| `apps/desktop/src/stores/marketplaceStore.ts` | Zustand store: `registry`, `suggestions`, dismissals |
| `apps/desktop/src/components/sidebar/vault/SkillsSection.tsx` (replace) | Installed / Marketplace / Forks tabs |
| `apps/desktop/src/components/sidebar/vault/InstalledSkillsTab.tsx` | Installed list + row actions |
| `apps/desktop/src/components/sidebar/vault/MarketplaceTab.tsx` | Browse + search + install |
| `apps/desktop/src/components/sidebar/vault/ForksTab.tsx` | Forked skills with upstream drift |
| `apps/desktop/src/components/panels/SkillPreviewPanel.tsx` | Read-only markdown viewer for "View skill" |
| `apps/desktop/src/components/agent/SkillSuggestionBanner.tsx` | Banner above ChatInput |
| `apps/desktop/src/hooks/useSkillSuggestions.ts` | Listens for `SkillsSuggestion` event, wires store |
| *(registry repo, separate)* `solo/skills-registry/` | Public marketplace repo, scaffolded in Phase 3 |

### Modified files

| Path | What changes |
|---|---|
| `apps/desktop/src-tauri/src/skills_commands.rs` | Accept `AGENTS.md` (prefer) + `SKILL.md` (fallback); return `InstalledSkillMeta` with `.solo-origin.json` |
| `apps/desktop/src-tauri/src/lib.rs` | Register new commands, `.manage()` new state, wire first-launch hook |
| `apps/desktop/src/stores/skillStore.ts` | Add `origin` and `modified` fields to `SkillInfo` view-model |
| `apps/desktop/src/components/agent/ChatInput.tsx` | Mount `SkillSuggestionBanner` above input |
| `agent-bridge/src/skills.ts` | Check `AGENTS.md` first, fall back to `SKILL.md`; inject name+description only; expose `load_skill(name)` tool |
| `agent-bridge/src/tools.ts` (or equiv) | Add `load_skill` tool handler |

---

## Phase 1 — Foundation (format, bundled skill, origin tracking)

### Task 1.1: Add protocol types

**Files:**
- Modify: `crates/solo-protocol/src/lib.rs` (append new section)

- [ ] **Step 1.1.1: Append the new types**

Append at the end of `crates/solo-protocol/src/lib.rs`:

```rust
// =============================================================================
// Skills Marketplace Protocol
// =============================================================================

/// One entry in the public skills registry.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct RegistryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub categories: Vec<String>,
    pub author: String,
    pub license: String,
    pub tarball_url: String,
    pub sha256: String,
    pub tags: Vec<String>,
    pub updated_at: String,
}

/// The full parsed `registry.json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct Registry {
    pub version: u32,
    pub generated_at: String,
    pub skills: Vec<RegistryEntry>,
}

/// A search hit surfaced to the user above the chat input.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct SkillSuggestion {
    pub entry: RegistryEntry,
    pub score: f32,
    pub reason: String,
}

/// Tracks whether an installed skill came from the registry, was bundled, or is user-authored.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum OriginSource {
    Registry,
    Bundled,
    User,
}

/// Persisted alongside an installed skill as `.solo-origin.json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct InstalledSkillMeta {
    pub source: OriginSource,
    pub id: String,
    pub version: String,
    pub installed_at: String,
    pub modified: bool,
    /// Present if installed from registry; records the upstream at install time.
    pub upstream_sha256: Option<String>,
}
```

- [ ] **Step 1.1.2: Add BackendEvent variants**

Find the `BackendEvent` enum in `crates/solo-protocol/src/lib.rs` and append new variants. If the enum doesn't yet exist (agent events flow via Tauri emits per module docs), add a dedicated `SkillsEvent`:

```rust
/// Events emitted by the skills marketplace subsystem.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "type")]
pub enum SkillsEvent {
    #[serde(rename = "skills:suggestion")]
    Suggestion { session_id: String, suggestions: Vec<SkillSuggestion> },
    #[serde(rename = "skills:installed")]
    Installed { skill_id: String },
    #[serde(rename = "skills:uninstalled")]
    Uninstalled { skill_id: String },
    #[serde(rename = "skills:registry_updated")]
    RegistryUpdated,
}
```

Emit via `app.emit("skills-event", SkillsEvent::...)`.

- [ ] **Step 1.1.3: Regenerate bindings**

Run: `cd /Users/sachin/Developer/Orbit_Main/solo && bun run gen:bindings`
Expected: new TS files in `apps/desktop/src/bindings/` (`RegistryEntry.ts`, `Registry.ts`, `SkillSuggestion.ts`, `InstalledSkillMeta.ts`, `OriginSource.ts`, `SkillsEvent.ts`).

- [ ] **Step 1.1.4: Commit**

```bash
git add solo/crates/solo-protocol/src/lib.rs solo/apps/desktop/src/bindings/
git commit -m "protocol: add skills marketplace types"
```

---

### Task 1.2: Dual AGENTS.md/SKILL.md parser in `skills_commands.rs`

**Files:**
- Modify: `apps/desktop/src-tauri/src/skills_commands.rs` (extend `scan_skills_dir`)
- Test: `apps/desktop/src-tauri/src/skills_commands.rs` (in `#[cfg(test)] mod tests`)

- [ ] **Step 1.2.1: Write the failing tests**

Append at the end of the existing `mod tests`:

```rust
#[tokio::test]
async fn prefers_agents_md_over_skill_md() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_dir = tmp.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("AGENTS.md"),
        "---\nname: my-skill\ndescription: from AGENTS\n---\nagents body\n",
    ).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: my-skill\ndescription: from SKILL\n---\nskill body\n",
    ).unwrap();

    let found = scan_skills_dir(tmp.path(), SkillSource::User).await;
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].description, "from AGENTS");
    assert!(found[0].content.contains("agents body"));
}

#[tokio::test]
async fn falls_back_to_skill_md() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_dir = tmp.path().join("claude-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: claude-skill\ndescription: skill md only\n---\nbody\n",
    ).unwrap();

    let found = scan_skills_dir(tmp.path(), SkillSource::User).await;
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].description, "skill md only");
}
```

Add `tempfile = "3"` to `[dev-dependencies]` in `apps/desktop/src-tauri/Cargo.toml` if not present.

- [ ] **Step 1.2.2: Run the tests to verify they fail**

Run: `cd /Users/sachin/Developer/Orbit_Main/solo && cargo test -p solo-desktop skills_commands::tests::prefers_agents_md_over_skill_md`
Expected: FAIL (current code only checks for `SKILL.md`).

- [ ] **Step 1.2.3: Update `scan_skills_dir` to prefer AGENTS.md**

Locate the `path.is_dir()` branch (around line 84 in the existing file):

```rust
} else if path.is_dir() {
    let skill_md = path.join("SKILL.md");
    if !skill_md.exists() {
        continue;
    }
    ...
```

Replace with:

```rust
} else if path.is_dir() {
    let agents_md = path.join("AGENTS.md");
    let skill_md = path.join("SKILL.md");
    let chosen = if agents_md.exists() {
        agents_md
    } else if skill_md.exists() {
        skill_md
    } else {
        continue;
    };
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    match fs::read_to_string(&chosen).await {
        Ok(content) => (content, chosen, name),
        Err(_) => continue,
    }
```

- [ ] **Step 1.2.4: Run tests to verify pass**

Run: `cargo test -p solo-desktop skills_commands::tests`
Expected: all tests pass.

- [ ] **Step 1.2.5: Commit**

```bash
git add solo/apps/desktop/src-tauri/src/skills_commands.rs solo/apps/desktop/src-tauri/Cargo.toml
git commit -m "skills: prefer AGENTS.md with SKILL.md fallback"
```

---

### Task 1.3: `.solo-origin.json` read/write helpers

**Files:**
- Create: `apps/desktop/src-tauri/src/skills_origin.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register module)
- Test: `apps/desktop/src-tauri/src/skills_origin.rs`

- [ ] **Step 1.3.1: Write the module with tests**

```rust
// apps/desktop/src-tauri/src/skills_origin.rs
use solo_protocol::{InstalledSkillMeta, OriginSource};
use std::path::{Path, PathBuf};
use tokio::fs;

const ORIGIN_FILENAME: &str = ".solo-origin.json";

pub fn origin_path(skill_dir: &Path) -> PathBuf {
    skill_dir.join(ORIGIN_FILENAME)
}

pub async fn read_origin(skill_dir: &Path) -> Option<InstalledSkillMeta> {
    let path = origin_path(skill_dir);
    let raw = fs::read_to_string(&path).await.ok()?;
    serde_json::from_str::<InstalledSkillMeta>(&raw).ok()
}

pub async fn write_origin(skill_dir: &Path, meta: &InstalledSkillMeta) -> std::io::Result<()> {
    let path = origin_path(skill_dir);
    let json = serde_json::to_string_pretty(meta).unwrap();
    fs::write(&path, json).await
}

pub async fn mark_modified(skill_dir: &Path) -> std::io::Result<()> {
    if let Some(mut meta) = read_origin(skill_dir).await {
        if !meta.modified {
            meta.modified = true;
            return write_origin(skill_dir, &meta).await;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn round_trips_origin() {
        let tmp = tempfile::tempdir().unwrap();
        let meta = InstalledSkillMeta {
            source: OriginSource::Registry,
            id: "ui".into(),
            version: "1.0.0".into(),
            installed_at: "2026-04-18T00:00:00Z".into(),
            modified: false,
            upstream_sha256: Some("abc".into()),
        };
        write_origin(tmp.path(), &meta).await.unwrap();
        let back = read_origin(tmp.path()).await.unwrap();
        assert_eq!(back.id, "ui");
        assert!(!back.modified);
    }

    #[tokio::test]
    async fn mark_modified_flips_flag() {
        let tmp = tempfile::tempdir().unwrap();
        let meta = InstalledSkillMeta {
            source: OriginSource::Registry,
            id: "ui".into(),
            version: "1.0.0".into(),
            installed_at: "2026-04-18T00:00:00Z".into(),
            modified: false,
            upstream_sha256: None,
        };
        write_origin(tmp.path(), &meta).await.unwrap();
        mark_modified(tmp.path()).await.unwrap();
        let back = read_origin(tmp.path()).await.unwrap();
        assert!(back.modified);
    }

    #[tokio::test]
    async fn missing_origin_returns_none() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(read_origin(tmp.path()).await.is_none());
    }
}
```

- [ ] **Step 1.3.2: Register the module in lib.rs**

In `apps/desktop/src-tauri/src/lib.rs`, add near other `mod skills_*` declarations:

```rust
mod skills_origin;
```

- [ ] **Step 1.3.3: Run tests**

Run: `cargo test -p solo-desktop skills_origin::tests`
Expected: 3 passing tests.

- [ ] **Step 1.3.4: Commit**

```bash
git add solo/apps/desktop/src-tauri/src/skills_origin.rs solo/apps/desktop/src-tauri/src/lib.rs
git commit -m "skills: add .solo-origin.json tracking"
```

---

### Task 1.4: Bundle the UI skill

**Files:**
- Create: `apps/desktop/src-tauri/bundled-skills/ui/` (copied from `Inspirations/Skills/ui/`)
- Create: `apps/desktop/src-tauri/src/skills_bundled.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml` (add `include_dir`)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (call first-launch extractor)
- Test: `apps/desktop/src-tauri/src/skills_bundled.rs`

- [ ] **Step 1.4.1: Copy + rename the UI skill bundle**

```bash
mkdir -p /Users/sachin/Developer/Orbit_Main/solo/apps/desktop/src-tauri/bundled-skills
cp -R /Users/sachin/Developer/Orbit_Main/Inspirations/Skills/ui /Users/sachin/Developer/Orbit_Main/solo/apps/desktop/src-tauri/bundled-skills/ui
mv /Users/sachin/Developer/Orbit_Main/solo/apps/desktop/src-tauri/bundled-skills/ui/SKILL.md \
   /Users/sachin/Developer/Orbit_Main/solo/apps/desktop/src-tauri/bundled-skills/ui/AGENTS.md
```

Then edit `bundled-skills/ui/AGENTS.md` frontmatter to add `version: 1.0.0`:

```yaml
---
name: ui
version: 1.0.0
description: Build and refine user interfaces with Tailwind CSS...
---
```

- [ ] **Step 1.4.2: Add dependency**

In `apps/desktop/src-tauri/Cargo.toml` `[dependencies]`:

```toml
include_dir = "0.7"
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 1.4.3: Write the bundled module + tests**

Create `apps/desktop/src-tauri/src/skills_bundled.rs`:

```rust
use crate::skills_origin::{origin_path, write_origin};
use include_dir::{include_dir, Dir};
use solo_protocol::{InstalledSkillMeta, OriginSource};
use std::path::Path;
use tokio::fs;

static BUNDLED_UI: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/bundled-skills/ui");
const BUNDLED_UI_VERSION: &str = "1.0.0";

/// Extract the bundled UI skill if it's not already present on disk.
/// Idempotent: subsequent launches become a no-op unless the skill dir was deleted.
pub async fn extract_bundled_if_missing(user_skills_dir: &Path) -> std::io::Result<bool> {
    let dest = user_skills_dir.join("ui");
    if origin_path(&dest).exists() {
        return Ok(false);
    }
    fs::create_dir_all(&dest).await?;
    extract_dir(&BUNDLED_UI, &dest).await?;
    let meta = InstalledSkillMeta {
        source: OriginSource::Bundled,
        id: "ui".into(),
        version: BUNDLED_UI_VERSION.into(),
        installed_at: chrono::Utc::now().to_rfc3339(),
        modified: false,
        upstream_sha256: None,
    };
    write_origin(&dest, &meta).await?;
    Ok(true)
}

fn extract_dir<'a>(
    dir: &'a Dir<'a>,
    dest: &'a Path,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = std::io::Result<()>> + Send + 'a>> {
    Box::pin(async move {
        for file in dir.files() {
            let rel = file.path().file_name().unwrap();
            let out = dest.join(rel);
            fs::write(out, file.contents()).await?;
        }
        for sub in dir.dirs() {
            let rel = sub.path().file_name().unwrap();
            let out = dest.join(rel);
            fs::create_dir_all(&out).await?;
            extract_dir(sub, &out).await?;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn extract_on_first_run_creates_origin() {
        let tmp = tempfile::tempdir().unwrap();
        let ran = extract_bundled_if_missing(tmp.path()).await.unwrap();
        assert!(ran);
        assert!(tmp.path().join("ui").join("AGENTS.md").exists());
        assert!(tmp.path().join("ui").join(".solo-origin.json").exists());
    }

    #[tokio::test]
    async fn second_run_is_noop() {
        let tmp = tempfile::tempdir().unwrap();
        extract_bundled_if_missing(tmp.path()).await.unwrap();
        let ran_again = extract_bundled_if_missing(tmp.path()).await.unwrap();
        assert!(!ran_again);
    }
}
```

- [ ] **Step 1.4.4: Register module and call on app startup**

In `apps/desktop/src-tauri/src/lib.rs`:

```rust
mod skills_bundled;
```

In the Tauri setup closure (search for `.setup(|app| {`), add (adjust to match existing structure):

```rust
.setup(|app| {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Some(home) = std::env::var_os("HOME") {
            let user_skills = std::path::PathBuf::from(home).join(".solo").join("skills");
            if let Err(e) = skills_bundled::extract_bundled_if_missing(&user_skills).await {
                tracing::warn!("failed to extract bundled skill: {}", e);
            }
        }
    });
    Ok(())
})
```

If there's already a setup closure, merge inside it rather than replacing.

- [ ] **Step 1.4.5: Run tests**

Run: `cargo test -p solo-desktop skills_bundled::tests`
Expected: 2 passing tests.

- [ ] **Step 1.4.6: Commit**

```bash
git add solo/apps/desktop/src-tauri/bundled-skills/ solo/apps/desktop/src-tauri/src/skills_bundled.rs solo/apps/desktop/src-tauri/src/lib.rs solo/apps/desktop/src-tauri/Cargo.toml
git commit -m "skills: bundle ui skill with include_dir, extract on first launch"
```

---

### Task 1.5: Workspace-root AGENTS.md generator

**Files:**
- Create: `apps/desktop/src-tauri/src/skills_aggregate.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register + command)
- Test: `apps/desktop/src-tauri/src/skills_aggregate.rs`

- [ ] **Step 1.5.1: Write module + tests**

```rust
// apps/desktop/src-tauri/src/skills_aggregate.rs
use solo_protocol::SkillInfo;
use std::path::Path;
use tokio::fs;

const BEGIN_FENCE: &str = "<!-- solo:begin -->";
const END_FENCE: &str = "<!-- solo:end -->";

/// Build the solo-fenced block describing installed skills.
pub fn build_block(skills: &[SkillInfo]) -> String {
    let mut out = String::new();
    out.push_str(BEGIN_FENCE);
    out.push_str("\n# Installed Solo Skills\n");
    if skills.is_empty() {
        out.push_str("\n_(no skills installed)_\n");
    } else {
        for s in skills {
            let desc = s.description.lines().next().unwrap_or("").trim();
            out.push_str(&format!("- **{}** — {}\n", s.name, desc));
        }
    }
    out.push_str("\nFull instructions at `~/.solo/skills/<name>/AGENTS.md`.\n");
    out.push_str(END_FENCE);
    out.push('\n');
    out
}

/// Write / replace the solo fence block in `<workspace>/AGENTS.md`.
/// - If the file doesn't exist, creates it with just the block.
/// - If the file exists and contains a solo fence, replaces it in place.
/// - If the file exists without a fence, appends the block.
pub async fn write_workspace_agents_md(workspace: &Path, skills: &[SkillInfo]) -> std::io::Result<()> {
    let path = workspace.join("AGENTS.md");
    let block = build_block(skills);
    let new_contents = match fs::read_to_string(&path).await {
        Ok(existing) => replace_or_append(&existing, &block),
        Err(_) => block.clone(),
    };
    fs::write(&path, new_contents).await
}

fn replace_or_append(existing: &str, block: &str) -> String {
    if let (Some(begin_idx), Some(end_idx)) = (existing.find(BEGIN_FENCE), existing.find(END_FENCE))
    {
        if begin_idx < end_idx {
            let after = end_idx + END_FENCE.len();
            let tail_start = existing[after..]
                .find('\n')
                .map(|n| after + n + 1)
                .unwrap_or(existing.len());
            let mut out = String::new();
            out.push_str(&existing[..begin_idx]);
            out.push_str(block);
            out.push_str(&existing[tail_start..]);
            return out;
        }
    }
    let mut out = existing.trim_end().to_string();
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(block);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use solo_protocol::SkillSource;

    fn sample_skill(name: &str, desc: &str) -> SkillInfo {
        SkillInfo {
            name: name.into(),
            description: desc.into(),
            content: String::new(),
            source: SkillSource::User,
            file_path: String::new(),
            enabled: true,
            priority: 0,
        }
    }

    #[tokio::test]
    async fn creates_file_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let skills = vec![sample_skill("ui", "Build UIs.")];
        write_workspace_agents_md(tmp.path(), &skills).await.unwrap();
        let content = std::fs::read_to_string(tmp.path().join("AGENTS.md")).unwrap();
        assert!(content.contains("<!-- solo:begin -->"));
        assert!(content.contains("**ui** — Build UIs."));
    }

    #[tokio::test]
    async fn preserves_user_content_when_fence_absent() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("AGENTS.md"),
            "# My Project\n\nSome custom notes.\n",
        ).unwrap();
        let skills = vec![sample_skill("ui", "Build UIs.")];
        write_workspace_agents_md(tmp.path(), &skills).await.unwrap();
        let content = std::fs::read_to_string(tmp.path().join("AGENTS.md")).unwrap();
        assert!(content.contains("Some custom notes."));
        assert!(content.contains("<!-- solo:begin -->"));
    }

    #[tokio::test]
    async fn replaces_existing_fence_block() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("AGENTS.md"),
            "# My Project\n\n<!-- solo:begin -->\nOLD CONTENT\n<!-- solo:end -->\n\n## After\n",
        ).unwrap();
        let skills = vec![sample_skill("ui", "Build UIs.")];
        write_workspace_agents_md(tmp.path(), &skills).await.unwrap();
        let content = std::fs::read_to_string(tmp.path().join("AGENTS.md")).unwrap();
        assert!(!content.contains("OLD CONTENT"));
        assert!(content.contains("**ui** — Build UIs."));
        assert!(content.contains("## After"));
    }

    #[tokio::test]
    async fn idempotent_across_runs() {
        let tmp = tempfile::tempdir().unwrap();
        let skills = vec![sample_skill("ui", "Build UIs.")];
        write_workspace_agents_md(tmp.path(), &skills).await.unwrap();
        let first = std::fs::read_to_string(tmp.path().join("AGENTS.md")).unwrap();
        write_workspace_agents_md(tmp.path(), &skills).await.unwrap();
        let second = std::fs::read_to_string(tmp.path().join("AGENTS.md")).unwrap();
        assert_eq!(first, second);
    }
}
```

- [ ] **Step 1.5.2: Register + expose as Tauri command**

In `apps/desktop/src-tauri/src/lib.rs`:

```rust
mod skills_aggregate;
```

Add a thin command wrapper alongside the existing `skills_*` commands (same file as the bundled hook or a new `skills_aggregate_command.rs`):

```rust
#[tauri::command]
pub async fn skills_write_workspace_agents_md(cwd: String) -> Result<(), String> {
    let workspace = std::path::PathBuf::from(&cwd);
    let skills = skills_commands::skills_list_available(cwd.clone()).await?;
    skills_aggregate::write_workspace_agents_md(&workspace, &skills)
        .await
        .map_err(|e| format!("write_workspace_agents_md: {}", e))
}
```

Register in `.invoke_handler(tauri::generate_handler![..., skills_write_workspace_agents_md])`.

- [ ] **Step 1.5.3: Run tests**

Run: `cargo test -p solo-desktop skills_aggregate::tests`
Expected: 4 passing tests.

- [ ] **Step 1.5.4: Commit**

```bash
git add solo/apps/desktop/src-tauri/src/skills_aggregate.rs solo/apps/desktop/src-tauri/src/lib.rs
git commit -m "skills: auto-generate workspace AGENTS.md with solo fence"
```

---

### Task 1.6: Update `agent-bridge` skill loader for AGENTS.md

**Files:**
- Modify: `agent-bridge/src/skills.ts`
- Test: `agent-bridge/src/skills.test.ts` (create if missing)

- [ ] **Step 1.6.1: Read current skills.ts**

Run: `cat /Users/sachin/Developer/Orbit_Main/solo/agent-bridge/src/skills.ts | head -100`
Note the existing structure. It currently looks for `SKILL.md` inside each skill directory.

- [ ] **Step 1.6.2: Write failing test**

Create or append to `agent-bridge/src/skills.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkillsFromDir } from './skills';

describe('loadSkillsFromDir', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'solo-skills-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('prefers AGENTS.md over SKILL.md', () => {
    const skill = join(root, 'my-skill');
    mkdirSync(skill);
    writeFileSync(
      join(skill, 'AGENTS.md'),
      '---\nname: my-skill\ndescription: from AGENTS\n---\nagents body',
    );
    writeFileSync(
      join(skill, 'SKILL.md'),
      '---\nname: my-skill\ndescription: from SKILL\n---\nskill body',
    );
    const skills = loadSkillsFromDir(root);
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe('from AGENTS');
  });

  it('falls back to SKILL.md when AGENTS.md is missing', () => {
    const skill = join(root, 'claude-skill');
    mkdirSync(skill);
    writeFileSync(
      join(skill, 'SKILL.md'),
      '---\nname: claude-skill\ndescription: skill only\n---\nbody',
    );
    const skills = loadSkillsFromDir(root);
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe('skill only');
  });
});
```

- [ ] **Step 1.6.3: Run test to verify it fails**

Run: `cd /Users/sachin/Developer/Orbit_Main/solo/agent-bridge && bun test skills.test.ts`
Expected: failures until AGENTS.md support is added.

- [ ] **Step 1.6.4: Update `loadSkillsFromDir` (or equivalent)**

In `agent-bridge/src/skills.ts`, find the function that reads per-skill-directory files. It likely has a pattern like:

```typescript
const skillFile = path.join(skillDir, 'SKILL.md');
if (!existsSync(skillFile)) continue;
```

Replace with:

```typescript
const agentsMd = path.join(skillDir, 'AGENTS.md');
const skillMd  = path.join(skillDir, 'SKILL.md');
const skillFile = existsSync(agentsMd) ? agentsMd : existsSync(skillMd) ? skillMd : null;
if (!skillFile) continue;
```

If the function is not directly exportable, export a pure `loadSkillsFromDir(dir: string): SkillInfo[]` helper that the test can call.

- [ ] **Step 1.6.5: Inject only name+description; add `load_skill` tool**

Locate `formatSkillsForPrompt`. Replace its body-concatenation with a name+description index:

```typescript
export function formatSkillsForPrompt(skills: SkillInfo[]): string {
  if (!skills.length) return '';
  const lines = skills.map(s => `- **${s.name}**: ${s.description.split('\n')[0]}`);
  return [
    '## Available Skills (installed)',
    'The user has these skills available. Call `load_skill(name)` to read the full instructions for any skill that matches the current task.',
    '',
    ...lines,
  ].join('\n');
}
```

Add a `load_skill` tool registration (in whichever file defines the agent's tool list). Shape:

```typescript
tools.push({
  name: 'load_skill',
  description: 'Load the full body of an installed skill by name.',
  input_schema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  handler: async ({ name }) => {
    const skill = skillsByName.get(name);
    if (!skill) return `No skill named ${name} is installed.`;
    return skill.content;
  },
});
```

- [ ] **Step 1.6.6: Run tests**

Run: `bun test skills.test.ts`
Expected: both tests pass.

- [ ] **Step 1.6.7: Commit**

```bash
git add solo/agent-bridge/src/skills.ts solo/agent-bridge/src/skills.test.ts
git commit -m "agent-bridge: load AGENTS.md first, inject index + load_skill tool"
```

---

## Phase 2 — Vault Skills Section UI

### Task 2.1: marketplaceStore + IPC wrapper scaffolding

**Files:**
- Create: `apps/desktop/src/lib/tauri/marketplace.ts`
- Create: `apps/desktop/src/stores/marketplaceStore.ts`
- Test: `apps/desktop/src/stores/marketplaceStore.test.ts`

- [ ] **Step 2.1.1: Write IPC wrapper stub**

```typescript
// apps/desktop/src/lib/tauri/marketplace.ts
import { invoke } from '@tauri-apps/api/core';
import type { Registry } from '@/bindings/Registry';
import type { RegistryEntry } from '@/bindings/RegistryEntry';
import type { SkillSuggestion } from '@/bindings/SkillSuggestion';

export const fetchRegistry = (force = false) =>
  invoke<Registry>('skills_fetch_registry', { force });

export const searchMarketplace = (query: string, installedIds: string[]) =>
  invoke<SkillSuggestion[]>('skills_search_marketplace', { query, installedIds });

export const installSkill = (entry: RegistryEntry) =>
  invoke<void>('skills_install', { entry });

export const uninstallSkill = (skillId: string) =>
  invoke<void>('skills_uninstall', { skillId });

export const writeInstalledSkill = (skillId: string, content: string) =>
  invoke<void>('skills_write_installed', { skillId, content });

export const writeWorkspaceAgentsMd = (cwd: string) =>
  invoke<void>('skills_write_workspace_agents_md', { cwd });
```

- [ ] **Step 2.1.2: Write marketplaceStore with tests**

```typescript
// apps/desktop/src/stores/marketplaceStore.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Registry } from '@/bindings/Registry';
import type { RegistryEntry } from '@/bindings/RegistryEntry';
import type { SkillSuggestion } from '@/bindings/SkillSuggestion';
import * as api from '@/lib/tauri/marketplace';

interface MarketplaceState {
  registry: Registry | null;
  loading: boolean;
  error: string | null;
  suggestions: SkillSuggestion[];
  dismissedIds: Set<string>;

  refreshRegistry: (force?: boolean) => Promise<void>;
  setSuggestions: (s: SkillSuggestion[]) => void;
  dismissSuggestion: (id: string) => void;
  install: (entry: RegistryEntry) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
}

export const useMarketplaceStore = create<MarketplaceState>()(
  immer((set, get) => ({
    registry: null,
    loading: false,
    error: null,
    suggestions: [],
    dismissedIds: new Set(),

    refreshRegistry: async (force = false) => {
      set((s) => { s.loading = true; s.error = null; });
      try {
        const reg = await api.fetchRegistry(force);
        set((s) => { s.registry = reg; s.loading = false; });
      } catch (e: unknown) {
        set((s) => { s.loading = false; s.error = String(e); });
      }
    },

    setSuggestions: (list) => set((s) => {
      s.suggestions = list.filter((x) => !s.dismissedIds.has(x.entry.id));
    }),

    dismissSuggestion: (id) => set((s) => {
      s.dismissedIds.add(id);
      s.suggestions = s.suggestions.filter((x) => x.entry.id !== id);
    }),

    install: async (entry) => {
      await api.installSkill(entry);
      set((s) => { s.suggestions = s.suggestions.filter((x) => x.entry.id !== entry.id); });
    },

    uninstall: async (id) => {
      await api.uninstallSkill(id);
    },
  })),
);
```

Matching tests in `marketplaceStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMarketplaceStore } from './marketplaceStore';

vi.mock('@/lib/tauri/marketplace', () => ({
  fetchRegistry: vi.fn(async () => ({
    version: 1, generated_at: 'now', skills: [],
  })),
  searchMarketplace: vi.fn(async () => []),
  installSkill: vi.fn(async () => {}),
  uninstallSkill: vi.fn(async () => {}),
  writeInstalledSkill: vi.fn(async () => {}),
  writeWorkspaceAgentsMd: vi.fn(async () => {}),
}));

beforeEach(() => {
  useMarketplaceStore.setState({
    registry: null, loading: false, error: null,
    suggestions: [], dismissedIds: new Set(),
  });
});

describe('marketplaceStore', () => {
  it('refreshes registry', async () => {
    await useMarketplaceStore.getState().refreshRegistry();
    expect(useMarketplaceStore.getState().registry?.version).toBe(1);
  });

  it('dismisses suggestion and remembers dismissal', () => {
    const s = useMarketplaceStore.getState();
    const entry = { id: 'ui', name: 'ui', version: '1', description: '', categories: [], author: '', license: '', tarball_url: '', sha256: '', tags: [], updated_at: '' };
    s.setSuggestions([{ entry, score: 0.9, reason: '' }]);
    expect(useMarketplaceStore.getState().suggestions).toHaveLength(1);
    s.dismissSuggestion('ui');
    s.setSuggestions([{ entry, score: 0.9, reason: '' }]);
    expect(useMarketplaceStore.getState().suggestions).toHaveLength(0);
  });
});
```

- [ ] **Step 2.1.3: Run tests**

Run: `cd /Users/sachin/Developer/Orbit_Main/solo && bun test apps/desktop/src/stores/marketplaceStore.test.ts`
Expected: 2 passing tests.

- [ ] **Step 2.1.4: Commit**

```bash
git add solo/apps/desktop/src/lib/tauri/marketplace.ts solo/apps/desktop/src/stores/marketplaceStore.ts solo/apps/desktop/src/stores/marketplaceStore.test.ts
git commit -m "marketplace: add IPC wrappers and Zustand store"
```

---

### Task 2.2: Replace SkillsSection placeholder with tabbed UI

**Files:**
- Modify: `apps/desktop/src/components/sidebar/vault/SkillsSection.tsx` (replace)
- Create: `apps/desktop/src/components/sidebar/vault/InstalledSkillsTab.tsx`
- Create: `apps/desktop/src/components/sidebar/vault/MarketplaceTab.tsx`
- Create: `apps/desktop/src/components/sidebar/vault/ForksTab.tsx`

- [ ] **Step 2.2.1: Write the three tab components (thin versions first)**

```tsx
// InstalledSkillsTab.tsx
import { useSkillStore } from '@/stores/skillStore';
import { useMarketplaceStore } from '@/stores/marketplaceStore';

export function InstalledSkillsTab() {
  const skills = useSkillStore((s) => s.available);
  const uninstall = useMarketplaceStore((s) => s.uninstall);
  if (!skills.length) return <p className="p-3 text-xs text-muted-foreground">No skills installed.</p>;
  return (
    <ul className="space-y-1 p-2">
      {skills.map((s) => (
        <li key={s.name} className="rounded-md border border-border/60 p-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium">{s.name}</span>
            <button onClick={() => uninstall(s.name)} className="text-[10px] text-red-500 hover:underline">Uninstall</button>
          </div>
          <p className="mt-1 text-muted-foreground line-clamp-2">{s.description}</p>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// MarketplaceTab.tsx
import { useEffect, useState } from 'react';
import { useMarketplaceStore } from '@/stores/marketplaceStore';

export function MarketplaceTab() {
  const { registry, loading, error, refreshRegistry, install } = useMarketplaceStore();
  const [query, setQuery] = useState('');
  useEffect(() => { if (!registry) refreshRegistry(); }, [registry, refreshRegistry]);
  const entries = (registry?.skills ?? []).filter((e) =>
    (e.name + ' ' + e.description).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-2 p-2">
      <input
        value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Search marketplace..."
        className="rounded-md border border-border/60 bg-card px-2 py-1 text-xs outline-none"
      />
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <ul className="space-y-1">
        {entries.map((e) => (
          <li key={e.id} className="rounded-md border border-border/60 p-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium">{e.name}</span>
              <button onClick={() => install(e)} className="text-[10px] text-primary hover:underline">Install</button>
            </div>
            <p className="mt-1 text-muted-foreground line-clamp-2">{e.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

```tsx
// ForksTab.tsx
import { useSkillStore } from '@/stores/skillStore';

export function ForksTab() {
  const skills = useSkillStore((s) => s.available);
  const forked = skills.filter((s) => (s as any).modified === true);
  if (!forked.length) return <p className="p-3 text-xs text-muted-foreground">No forked skills.</p>;
  return (
    <ul className="space-y-1 p-2">
      {forked.map((s) => (
        <li key={s.name} className="rounded-md border border-border/60 p-2 text-xs">
          <span className="font-medium">{s.name}</span>
          <p className="mt-1 text-muted-foreground">Forked from upstream.</p>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2.2.2: Replace SkillsSection with tab shell**

```tsx
// apps/desktop/src/components/sidebar/vault/SkillsSection.tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { InstalledSkillsTab } from './InstalledSkillsTab';
import { MarketplaceTab } from './MarketplaceTab';
import { ForksTab } from './ForksTab';

type Tab = 'installed' | 'marketplace' | 'forks';

export function SkillsSection() {
  const [tab, setTab] = useState<Tab>('installed');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'installed', label: 'Installed' },
    { id: 'marketplace', label: 'Marketplace' },
    { id: 'forks', label: 'Forks' },
  ];
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-1 p-2 border-b border-border/60 shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 rounded-md px-2 py-1 text-[11px] transition-colors',
              tab === t.id
                ? 'bg-card text-foreground border border-border/70'
                : 'text-muted-foreground hover:bg-card/50',
            )}
          >{t.label}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'installed' && <InstalledSkillsTab />}
        {tab === 'marketplace' && <MarketplaceTab />}
        {tab === 'forks' && <ForksTab />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2.2.3: Manual smoke test**

Run: `cd /Users/sachin/Developer/Orbit_Main/solo && bun run dev` (from a terminal)
Expected: Vault → Skills now shows three tabs. Installed shows existing skills. Marketplace attempts to fetch (will show an error until Phase 3 is done — acceptable here; comment explaining).

- [ ] **Step 2.2.4: Commit**

```bash
git add solo/apps/desktop/src/components/sidebar/vault/
git commit -m "skills: replace placeholder with tabbed Installed/Marketplace/Forks UI"
```

---

## Phase 3 — Registry Fetch + Install Pipeline

Each task in this phase follows the same TDD rhythm as Phase 1 (write failing test, run, implement, run, commit). Key specifics:

### Task 3.1: `skills_fetch_registry` with 24h caching
- Create `skills_marketplace.rs` with `fetch_registry(force: bool)`, caching to `~/.solo/cache/registry.json`.
- Use `reqwest` (async, already a workspace dep or add it).
- Cache-hit criteria: file mtime within 24h AND `force == false`.
- Tests: cache hit, cache miss, force invalidates cache, HTTP failure returns cached if available.

### Task 3.2: `skills_install` with sha256 + path-traversal guard
- Download tarball via `reqwest::get(entry.tarball_url)`.
- Verify sha256 via `sha2` crate; mismatch → `Err`.
- Extract via `tar` + `flate2::read::GzDecoder`. For each entry: reject if normalized path escapes target dir (via `Component::ParentDir` check). Reject `.sh .py .js .ts .exe` / binaries by magic bytes (Mach-O, ELF, PE). Limit total bytes to 5MB.
- On success: write `.solo-origin.json` via `skills_origin::write_origin`, emit `SkillsEvent::Installed`, call `write_workspace_agents_md`.
- Tests: happy path (fixture tarball), sha256 mismatch, path-traversal tar entry rejected, executable file rejected, oversize rejected.

### Task 3.3: `skills_uninstall`
- Resolve skill dir under `~/.solo/skills/<id>/`. Safety-check it's a subdirectory of the user skills dir (no symlink escape).
- `fs::remove_dir_all`.
- Emit `SkillsEvent::Uninstalled`, regenerate workspace AGENTS.md.
- Tests: uninstalls existing skill, refuses when id is `..`, refuses when path is outside base.

### Task 3.4: Update detection
- On app launch, after `refreshRegistry`, compare each installed `InstalledSkillMeta.version` against `RegistryEntry.version`. Build a `Map<id, UpdateStatus>` in `marketplaceStore`: `up_to_date | update_available(upstream_version) | forked_drift(upstream_version)`.
- `InstalledSkillsTab` shows a small "Update available" pill on rows where update_available.
- Tests: version-compare semver via `semver` crate; drift detection respects `modified` flag.

**After Phase 3:** the plan document `solo/docs/superpowers/plans/2026-04-18-skills-marketplace-p3-tasks.md` is written with the same TDD detail as Phase 1. That sub-plan is authored at the Phase-3 checkpoint.

---

## Phase 4 — Semantic Search + Suggestion Banner (sub-plan at checkpoint)

Outline:
- `skills_search::index_registry(entries: &[RegistryEntry])` — call `solo-embeddings` per entry, cache embeddings at `~/.solo/cache/registry-embeddings.bin`, invalidate when `registry.version` changes.
- `skills_search::search(query, installed_ids, dismissed_ids)` — embed query, cosine similarity, top-K ≥ 0.72, dedupe.
- `ChatInput` dispatches search on message change (debounced 250ms).
- `SkillSuggestionBanner` renders top 3, emits install/view/skip actions to the store.
- Session dismissals live in memory; cross-session after 3 dismissals flushed to `~/.solo/settings.json`.
- Tests: threshold filtering, dedupe against installed, dismissal memory.

---

## Phase 5 — Agent Tweak Flow (sub-plan at checkpoint)

Outline:
- `TweakWithAgentAction` on InstalledSkillsTab row.
- Opens a fresh agent session with preloaded context: `AGENTS.md` body + system message describing the personalization intent.
- On save via agent-proposed edit, call `skills_write_installed(id, content)` → flips `.solo-origin.json.modified = true` → regenerates workspace AGENTS.md.
- Tests: mark_modified called on write, new content reaches disk, fork detection flips ForksTab.

---

## Phase 6 — Testing & Hardening (sub-plan at checkpoint)

Outline:
- Registry CI workflow (`solo/skills-registry/.github/workflows/validate.yml`): YAML parse, required fields, size limit, no executables, name-matches-dirname. Regenerate `registry.json` on merge.
- Full Vitest suite runs on frontend CI.
- Full `cargo test --workspace` on Rust CI.
- Tauri E2E smoke test: launch app, install-via-marketplace (pointed at test registry fixture), verify on-disk state.
- Manual smoke checklist (10 items from spec §8).

---

## Registry Repo Scaffolding (one-time, separate)

At Phase 3 start, create `solo/skills-registry/` on GitHub with:
- `README.md` — what this is, how to contribute
- `LICENSE` — MIT
- `CONTRIBUTING.md` — required AGENTS.md fields, banned content, review criteria
- `registry.json` — seeded with the `ui` skill entry
- `skills/ui/` — copy of the bundled skill (source of truth for the tarball URL)
- `.github/workflows/validate.yml` — the CI lint
- `CODEOWNERS` — route category folders to domain reviewers

This is a separate repo; Solo references it via a default `registry_url` constant. Users can override in Settings.

---

## Self-Review

- **Spec coverage check:**
  - §4 data model ⇒ Task 1.1 (protocol), Task 1.5 (aggregate), Task 3.1 (registry fetch), Task 1.3 (origin). ✓
  - §5 runtime ⇒ Task 1.6 (agent-bridge), Phase 4 (search). ✓
  - §6 UI ⇒ Phase 2 (tabs), Phase 4 (banner). ✓
  - §7 security ⇒ Task 3.2 (sha256 + traversal + exec reject). ✓
  - §8 testing ⇒ tests embedded in each task + Phase 6 hardening. ✓
  - §9 open source ⇒ Registry Repo Scaffolding section. ✓
  - §10 phases map 1:1 to plan phases. ✓
- **Placeholder scan:** no "TBD"s in Phase 1–2 tasks. Phases 3–6 are deliberate sub-plan outlines, marked as such, to be expanded at phase boundaries — this is a known trade-off for plan tractability, not a placeholder inside a task.
- **Type consistency:** `InstalledSkillMeta`, `RegistryEntry`, `SkillSuggestion`, `OriginSource` used identically across all phases. `SkillsEvent` variant names consistent between emit sites.
