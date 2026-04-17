//! Skills discovery & authoring commands for Solo IDE.
//!
//! Solo's canonical skill directories are `~/.solo/skills/` (user) and
//! `{cwd}/.solo/skills/` (project). On top of those, Solo runs read-only
//! *adapters* that surface skills authored for other platforms so users
//! keep what they already have:
//!
//!  - `~/.claude/skills/`                      (Claude Code personal)
//!  - `~/.claude/plugins/**/skills/`           (Claude Code plugin marketplace)
//!  - `{ancestors}/.claude/skills/`            (project-scoped Claude skills)
//!  - `~/.codex/skills/`                       (Codex, forward-compat)
//!
//! Each adapter can be toggled in user settings (`skills.importClaudeUser`
//! etc.). Skills from higher-priority sources override those from lower
//! ones on name collision — see `SkillSource::priority()`.

use solo_core::settings as settings_io;
use solo_protocol::{
    OnboardingImportMode, SkillInfo, SkillSource, SkillWriteRequest, SkillsConfig,
    SkillsOnboardingStatus,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::{debug, warn};

// ─── Frontmatter ─────────────────────────────────────────────────────

/// Minimal YAML-like frontmatter parser — only handles `key: value` lines.
fn parse_frontmatter(raw: &str) -> (HashMap<String, String>, String) {
    let mut meta = HashMap::new();

    if !raw.starts_with("---") {
        return (meta, raw.to_string());
    }

    let Some(end_idx) = raw[3..].find("\n---") else {
        return (meta, raw.to_string());
    };

    let fm_block = &raw[3..3 + end_idx];
    let body_start = 3 + end_idx + 4;
    let body = raw[body_start..].trim_start_matches('\n').to_string();

    for line in fm_block.lines() {
        let line = line.trim();
        if let Some(colon_idx) = line.find(':') {
            let key = line[..colon_idx].trim().to_string();
            let value = line[colon_idx + 1..].trim().to_string();
            if !key.is_empty() {
                meta.insert(key, value);
            }
        }
    }

    (meta, body)
}

// ─── Directory Scanner ───────────────────────────────────────────────

/// Scan a single skills directory for both flat (`foo.md`) and nested
/// (`foo/SKILL.md`) layouts. Tolerant of missing dirs.
async fn scan_skills_dir(dir: &Path, source: SkillSource) -> Vec<SkillInfo> {
    let mut skills = Vec::new();

    let mut entries = match fs::read_dir(dir).await {
        Ok(e) => e,
        Err(_) => return skills,
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let (raw, skill_path, derived_name) =
            if path.is_file() && path.extension().is_some_and(|e| e == "md") {
                let name = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                match fs::read_to_string(&path).await {
                    Ok(content) => (content, path.clone(), name),
                    Err(_) => continue,
                }
            } else if path.is_dir() {
                let skill_md = path.join("SKILL.md");
                if !skill_md.exists() {
                    continue;
                }
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                match fs::read_to_string(&skill_md).await {
                    Ok(content) => (content, skill_md, name),
                    Err(_) => continue,
                }
            } else {
                continue;
            };

        let (meta, body) = parse_frontmatter(&raw);

        let name = meta
            .get("name")
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or(derived_name);
        let description = meta.get("description").cloned().unwrap_or_default();
        let enabled = meta.get("enabled").map_or(true, |v| v != "false");
        let priority = meta
            .get("priority")
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(0);

        skills.push(SkillInfo {
            name,
            description,
            content: body,
            source,
            file_path: skill_path.to_string_lossy().into_owned(),
            enabled,
            priority,
        });
    }

    skills
}

// ─── Path Resolvers ──────────────────────────────────────────────────

fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(PathBuf::from)
}

fn solo_user_skills_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".solo").join("skills"))
}

fn claude_user_skills_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("skills"))
}

fn claude_plugins_manifest() -> Option<PathBuf> {
    home_dir().map(|h| {
        h.join(".claude")
            .join("plugins")
            .join("installed_plugins.json")
    })
}

fn codex_user_skills_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".codex").join("skills"))
}

// ─── Adapters ────────────────────────────────────────────────────────

async fn discover_solo_user() -> Vec<SkillInfo> {
    match solo_user_skills_dir() {
        Some(d) => scan_skills_dir(&d, SkillSource::User).await,
        None => Vec::new(),
    }
}

async fn discover_solo_project(cwd: &Path) -> Vec<SkillInfo> {
    let dir = cwd.join(".solo").join("skills");
    scan_skills_dir(&dir, SkillSource::Project).await
}

async fn discover_claude_user() -> Vec<SkillInfo> {
    match claude_user_skills_dir() {
        Some(d) => scan_skills_dir(&d, SkillSource::ClaudeUser).await,
        None => Vec::new(),
    }
}

/// Walk from `cwd` up to (but not including) `$HOME`, collecting any
/// `.claude/skills/` directories. Bounded to 12 ancestors to avoid
/// pathological traversal on weird layouts.
async fn discover_claude_project(cwd: &Path) -> Vec<SkillInfo> {
    let home = home_dir();
    let mut skills = Vec::new();
    let mut current: Option<&Path> = Some(cwd);
    let mut hops = 0;

    while let Some(dir) = current {
        if hops >= 12 {
            break;
        }
        if home.as_deref() == Some(dir) {
            break;
        }
        let candidate = dir.join(".claude").join("skills");
        if candidate.exists() {
            skills.extend(scan_skills_dir(&candidate, SkillSource::ClaudeProject).await);
        }
        current = dir.parent();
        hops += 1;
    }

    skills
}

/// Parse `~/.claude/plugins/installed_plugins.json` and scan each plugin's
/// `skills/` subdirectory. Falls back to an empty list if the manifest is
/// missing or malformed.
async fn discover_claude_plugins() -> Vec<SkillInfo> {
    let Some(manifest_path) = claude_plugins_manifest() else {
        return Vec::new();
    };
    let raw = match fs::read_to_string(&manifest_path).await {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            warn!("claude plugins manifest parse error: {}", e);
            return Vec::new();
        }
    };

    let Some(plugins) = parsed.get("plugins").and_then(|v| v.as_object()) else {
        return Vec::new();
    };

    let mut skills = Vec::new();
    for installs in plugins.values() {
        let Some(array) = installs.as_array() else {
            continue;
        };
        for install in array {
            let Some(install_path) = install.get("installPath").and_then(|v| v.as_str()) else {
                continue;
            };
            let skills_dir = PathBuf::from(install_path).join("skills");
            if !skills_dir.exists() {
                continue;
            }
            skills.extend(scan_skills_dir(&skills_dir, SkillSource::ClaudePlugin).await);
        }
    }
    skills
}

async fn discover_codex_user() -> Vec<SkillInfo> {
    match codex_user_skills_dir() {
        Some(d) => scan_skills_dir(&d, SkillSource::Codex).await,
        None => Vec::new(),
    }
}

// ─── Dedup ───────────────────────────────────────────────────────────

/// Collapse duplicates by name, keeping the entry whose `SkillSource`
/// has the highest priority (Project > User > ClaudeProject > ...).
fn dedupe_by_priority(skills: Vec<SkillInfo>) -> Vec<SkillInfo> {
    let mut best: HashMap<String, SkillInfo> = HashMap::new();
    for skill in skills {
        match best.get(&skill.name) {
            Some(existing) if existing.source.priority() >= skill.source.priority() => {}
            _ => {
                best.insert(skill.name.clone(), skill);
            }
        }
    }
    best.into_values().collect()
}

// ─── Public Commands ─────────────────────────────────────────────────

/// List every skill Solo can see, across all enabled sources.
/// Dedup by name using source priority; sort by priority (desc), name (asc).
#[tauri::command]
pub async fn skills_list_available(cwd: String) -> Result<Vec<SkillInfo>, String> {
    let workspace = PathBuf::from(&cwd);
    let config = settings_io::load_skills_config(&workspace).unwrap_or_default();

    let mut all = Vec::new();
    all.extend(discover_solo_user().await);
    all.extend(discover_solo_project(&workspace).await);

    if config.import_claude_user {
        all.extend(discover_claude_user().await);
    }
    if config.import_claude_project {
        all.extend(discover_claude_project(&workspace).await);
    }
    if config.import_claude_plugins {
        all.extend(discover_claude_plugins().await);
    }
    if config.import_codex {
        all.extend(discover_codex_user().await);
    }

    let mut skills = dedupe_by_priority(all);
    skills.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then_with(|| a.name.cmp(&b.name))
    });

    debug!("Found {} skills for cwd={}", skills.len(), cwd);
    Ok(skills)
}

/// Create or overwrite a `.solo/skills/<name>/SKILL.md` file.
///
/// The agent calls this when the user says "save this as a skill" — the
/// body is wrapped in frontmatter and written to the requested scope.
#[tauri::command]
pub async fn skills_write_skill(req: SkillWriteRequest) -> Result<String, String> {
    let sanitized_name = sanitize_skill_name(&req.name)
        .ok_or_else(|| "skill name must be non-empty and contain only [A-Za-z0-9_-]".to_string())?;

    let base_dir = match req.scope {
        SkillSource::User => solo_user_skills_dir()
            .ok_or_else(|| "could not resolve home directory".to_string())?,
        SkillSource::Project => {
            let cwd = req.cwd.clone().ok_or_else(|| {
                "cwd is required for project-scoped skill writes".to_string()
            })?;
            PathBuf::from(cwd).join(".solo").join("skills")
        }
        other => {
            return Err(format!(
                "refusing to write to read-only source: {:?}",
                other
            ))
        }
    };

    let skill_dir = base_dir.join(&sanitized_name);
    fs::create_dir_all(&skill_dir)
        .await
        .map_err(|e| format!("create_dir_all failed: {}", e))?;

    let file_path = skill_dir.join("SKILL.md");
    let content = format_skill_file(&sanitized_name, &req.description, &req.body);
    fs::write(&file_path, content)
        .await
        .map_err(|e| format!("write failed: {}", e))?;

    Ok(file_path.to_string_lossy().into_owned())
}

/// Probe for onboarding: have we already shown the prompt? Are there
/// external skills worth importing? Is `~/.solo/skills/` empty?
#[tauri::command]
pub async fn skills_onboarding_status(cwd: String) -> Result<SkillsOnboardingStatus, String> {
    let workspace = PathBuf::from(&cwd);
    let config: SkillsConfig = settings_io::load_skills_config(&workspace).unwrap_or_default();

    let solo_skills = discover_solo_user().await;
    let has_solo_skills = !solo_skills.is_empty();

    let mut importable: Vec<SkillInfo> = Vec::new();
    importable.extend(discover_claude_user().await);
    importable.extend(discover_claude_plugins().await);
    importable.extend(discover_codex_user().await);

    let importable_count = u32::try_from(importable.len()).unwrap_or(u32::MAX);

    Ok(SkillsOnboardingStatus {
        should_prompt: !config.onboarding_shown && !has_solo_skills && importable_count > 0,
        importable_count,
        has_solo_skills,
    })
}

/// Apply the user's onboarding choice and mark the flag so we never prompt again.
///
/// - `ReadOnly` — just keeps the adapters enabled (no file changes).
/// - `Copy`     — snapshot external skills into `~/.solo/skills/`.
/// - `Symlink`  — symlink each external skill dir into `~/.solo/skills/`.
#[tauri::command]
pub async fn skills_onboarding_apply(
    cwd: String,
    mode: OnboardingImportMode,
) -> Result<u32, String> {
    let workspace = PathBuf::from(&cwd);
    let mut imported: u32 = 0;

    if matches!(mode, OnboardingImportMode::Copy | OnboardingImportMode::Symlink) {
        let target = solo_user_skills_dir()
            .ok_or_else(|| "could not resolve home directory".to_string())?;
        fs::create_dir_all(&target)
            .await
            .map_err(|e| format!("create_dir_all {}: {}", target.display(), e))?;

        let mut external: Vec<SkillInfo> = Vec::new();
        external.extend(discover_claude_user().await);
        external.extend(discover_claude_plugins().await);
        external.extend(discover_codex_user().await);
        external = dedupe_by_priority(external);

        for skill in external {
            let source_path = PathBuf::from(&skill.file_path);
            let skill_root = source_path.parent().map(Path::to_path_buf);
            let Some(skill_root) = skill_root else {
                continue;
            };
            let Some(sanitized) = sanitize_skill_name(&skill.name) else {
                continue;
            };
            let dest = target.join(&sanitized);
            if dest.exists() {
                continue;
            }

            let result = match mode {
                OnboardingImportMode::Copy => copy_dir_recursive(&skill_root, &dest).await,
                OnboardingImportMode::Symlink => symlink_dir(&skill_root, &dest).await,
                OnboardingImportMode::ReadOnly => Ok(()),
            };
            match result {
                Ok(()) => imported += 1,
                Err(e) => warn!("skill import failed for {}: {}", skill.name, e),
            }
        }
    }

    settings_io::mark_skills_onboarding_shown(&workspace)
        .map_err(|e| format!("failed to mark onboarding shown: {}", e))?;

    Ok(imported)
}

/// Dismiss onboarding without importing (leaves adapters at their current settings).
#[tauri::command]
pub async fn skills_onboarding_dismiss(cwd: String) -> Result<(), String> {
    let workspace = PathBuf::from(&cwd);
    settings_io::mark_skills_onboarding_shown(&workspace)
        .map_err(|e| format!("failed to mark onboarding shown: {}", e))?;
    Ok(())
}

/// Re-arm onboarding — the dialog will appear again next time `skills_onboarding_status`
/// runs (assuming there are still importable skills and `~/.solo/skills/` is empty).
#[tauri::command]
pub async fn skills_onboarding_reset(cwd: String) -> Result<(), String> {
    let workspace = PathBuf::from(&cwd);
    settings_io::reset_skills_onboarding(&workspace)
        .map_err(|e| format!("failed to reset onboarding: {}", e))?;
    Ok(())
}

/// Toggle individual source adapters from a settings UI.
#[tauri::command]
pub async fn skills_set_imports(
    cwd: String,
    claude_user: Option<bool>,
    claude_plugins: Option<bool>,
    claude_project: Option<bool>,
    codex: Option<bool>,
) -> Result<SkillsConfig, String> {
    let workspace = PathBuf::from(&cwd);
    let updated = settings_io::update_skill_imports(
        &workspace,
        claude_user,
        claude_plugins,
        claude_project,
        codex,
    )
    .map_err(|e| format!("update_skill_imports: {}", e))?;
    Ok(updated.skills)
}

// ─── Helpers ─────────────────────────────────────────────────────────

/// Allow only alphanumerics, `-`, and `_` in skill directory names.
fn sanitize_skill_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    Some(trimmed.to_string())
}

fn format_skill_file(name: &str, description: &str, body: &str) -> String {
    let safe_description = description.replace('\n', " ");
    format!(
        "---\nname: {}\ndescription: {}\n---\n\n{}\n",
        name,
        safe_description,
        body.trim_end()
    )
}

async fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst).await?;
    let mut stack = vec![(src.to_path_buf(), dst.to_path_buf())];
    while let Some((src_dir, dst_dir)) = stack.pop() {
        let mut entries = fs::read_dir(&src_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let ty = entry.file_type().await?;
            let from = entry.path();
            let to = dst_dir.join(entry.file_name());
            if ty.is_dir() {
                fs::create_dir_all(&to).await?;
                stack.push((from, to));
            } else if ty.is_file() {
                fs::copy(&from, &to).await?;
            }
            // symlinks inside source trees are deliberately ignored.
        }
    }
    Ok(())
}

#[cfg(unix)]
async fn symlink_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    tokio::fs::symlink(src, dst).await
}

#[cfg(windows)]
async fn symlink_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    let src = src.to_path_buf();
    let dst = dst.to_path_buf();
    tokio::task::spawn_blocking(move || std::os::windows::fs::symlink_dir(&src, &dst))
        .await
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_rejects_traversal() {
        assert!(sanitize_skill_name("../evil").is_none());
        assert!(sanitize_skill_name("a b").is_none());
        assert!(sanitize_skill_name("").is_none());
        assert_eq!(
            sanitize_skill_name("my-skill_1"),
            Some("my-skill_1".into())
        );
    }

    #[test]
    fn dedupe_keeps_higher_priority() {
        let lower = SkillInfo {
            name: "x".into(),
            description: "claude".into(),
            content: String::new(),
            source: SkillSource::ClaudeUser,
            file_path: "/a".into(),
            enabled: true,
            priority: 0,
        };
        let higher = SkillInfo {
            name: "x".into(),
            description: "solo".into(),
            content: String::new(),
            source: SkillSource::User,
            file_path: "/b".into(),
            enabled: true,
            priority: 0,
        };
        let result = dedupe_by_priority(vec![lower, higher]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].description, "solo");
    }

    #[test]
    fn format_skill_file_injects_frontmatter() {
        let out = format_skill_file("foo", "does a thing", "body content\n");
        assert!(out.starts_with("---\nname: foo\ndescription: does a thing\n---"));
        assert!(out.trim_end().ends_with("body content"));
    }
}
