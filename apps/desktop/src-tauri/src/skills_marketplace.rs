//! Skills marketplace — registry fetch, install, uninstall.
//!
//! Fetches `registry.json` from `github.com/Sachin1801/skills-registry` (user
//! overridable later). Caches the JSON on disk at `~/.solo/cache/registry.json`
//! for 24h. Installs download the full repo tarball, filter to
//! `skills/<id>/`, and extract with path-traversal + executable-content
//! rejection.

use crate::skills_origin;
use solo_protocol::{
    InstalledSkillMeta, OriginSource, Registry, RegistryEntry, SkillSuggestion, SkillsEvent,
};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::fs;

const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/Sachin1801/skills-registry/main/registry.json";
const CACHE_TTL_SECS: u64 = 24 * 60 * 60;
const MAX_SKILL_BYTES: u64 = 5 * 1024 * 1024;
const FETCH_TIMEOUT_SECS: u64 = 20;

// ─── Path helpers ────────────────────────────────────────────────────

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn user_skills_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".solo").join("skills"))
}

fn cache_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".solo").join("cache").join("registry.json"))
}

/// Reject anything that isn't a safe `[a-zA-Z0-9_-]+` skill id.
/// Blocks `..`, `/`, spaces, dots, null bytes, etc.
fn validate_skill_id(id: &str) -> Result<&str, String> {
    if id.is_empty() {
        return Err("skill id must not be empty".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("skill id '{}' contains disallowed characters", id));
    }
    Ok(id)
}

// ─── Registry fetch (Task 3.1) ───────────────────────────────────────

async fn read_cache_any_age(cache: &Path) -> Option<Registry> {
    let raw = fs::read_to_string(cache).await.ok()?;
    serde_json::from_str::<Registry>(&raw).ok()
}

async fn cache_is_fresh(cache: &Path) -> bool {
    let meta = match fs::metadata(cache).await {
        Ok(m) => m,
        Err(_) => return false,
    };
    let modified = match meta.modified() {
        Ok(m) => m,
        Err(_) => return false,
    };
    modified
        .elapsed()
        .map(|d| d.as_secs() < CACHE_TTL_SECS)
        .unwrap_or(false)
}

async fn write_cache(cache: &Path, text: &str) -> std::io::Result<()> {
    if let Some(parent) = cache.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(cache, text).await
}

/// Fetch the marketplace registry.
///
/// - `force = false`: returns cached copy if it's <24h old; otherwise fetches.
/// - `force = true`: always fetches.
/// - On network failure: falls back to stale cache if any exists.
#[tauri::command]
pub async fn skills_fetch_registry(
    app: AppHandle,
    force: bool,
) -> Result<Registry, String> {
    let cache = cache_path().ok_or_else(|| "could not resolve HOME".to_string())?;

    if !force && cache_is_fresh(&cache).await {
        if let Some(reg) = read_cache_any_age(&cache).await {
            return Ok(reg);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("build http client: {}", e))?;

    let url = DEFAULT_REGISTRY_URL;
    match client.get(url).send().await {
        Ok(resp) if resp.status().is_success() => {
            let text = resp
                .text()
                .await
                .map_err(|e| format!("read registry body: {}", e))?;
            let reg: Registry = serde_json::from_str(&text)
                .map_err(|e| format!("parse registry.json: {}", e))?;
            if let Err(e) = write_cache(&cache, &text).await {
                tracing::warn!("failed to cache registry.json: {}", e);
            }
            let _ = app.emit("skills-event", SkillsEvent::RegistryUpdated);
            Ok(reg)
        }
        Ok(resp) => {
            tracing::warn!("registry fetch returned {}, falling back to cache", resp.status());
            read_cache_any_age(&cache)
                .await
                .ok_or_else(|| format!("registry fetch failed (HTTP {}) and no cache available", resp.status()))
        }
        Err(e) => {
            tracing::warn!("registry fetch error: {}, falling back to cache", e);
            read_cache_any_age(&cache)
                .await
                .ok_or_else(|| format!("registry fetch failed: {} (no cache)", e))
        }
    }
}

// ─── Install (Task 3.2) ──────────────────────────────────────────────

/// Which file extensions are banned inside skill tarballs.
/// Keep this in sync with `infra/skills-registry/scripts/validate.ts`.
const BANNED_EXTS: &[&str] = &[
    "sh", "py", "js", "ts", "mjs", "cjs", "exe", "bin", "so", "dll", "dylib",
];

fn has_banned_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| BANNED_EXTS.iter().any(|b| b.eq_ignore_ascii_case(s)))
        .unwrap_or(false)
}

/// Reject if any path component is ParentDir, RootDir, or Prefix — that
/// prevents both `../escape` and absolute-path tar entries.
fn path_is_safe_relative(path: &Path) -> bool {
    if path.is_absolute() {
        return false;
    }
    path.components().all(|c| {
        matches!(c, Component::Normal(_) | Component::CurDir)
    })
}

/// Extract `skills/<id>/` contents from a github-style tarball into `dest`.
/// The tarball's top-level dir is `<repo>-<branch>/` which we strip.
fn extract_skill_from_tarball(
    tarball: &[u8],
    skill_id: &str,
    dest: &Path,
) -> Result<u64, String> {
    let gz = flate2::read::GzDecoder::new(tarball);
    let mut archive = tar::Archive::new(gz);
    let prefix_needle = format!("/skills/{}/", skill_id);
    let mut total_bytes: u64 = 0;
    let mut files_written = 0;

    for entry in archive.entries().map_err(|e| format!("tar entries: {}", e))? {
        let mut entry = entry.map_err(|e| format!("tar entry: {}", e))?;

        let entry_path = entry
            .path()
            .map_err(|e| format!("tar path: {}", e))?
            .into_owned();
        let path_str = entry_path.to_string_lossy().to_string();

        // Find the `skills/<id>/` slice inside the top-level `<repo>-<ref>/` dir
        let Some(idx) = path_str.find(&prefix_needle) else {
            continue;
        };
        let rel_inside_skill = &path_str[idx + prefix_needle.len()..];
        if rel_inside_skill.is_empty() {
            continue;
        }
        let rel_path = Path::new(rel_inside_skill);

        if !path_is_safe_relative(rel_path) {
            return Err(format!("unsafe tar entry path: {}", path_str));
        }

        let header = entry.header().clone();
        let entry_type = header.entry_type();
        if entry_type.is_dir() {
            let dir_dest = dest.join(rel_path);
            std::fs::create_dir_all(&dir_dest).map_err(|e| e.to_string())?;
            continue;
        }
        if !entry_type.is_file() {
            // Skip symlinks, hardlinks, devices, etc.
            continue;
        }

        if has_banned_extension(rel_path) {
            return Err(format!("banned file extension: {}", path_str));
        }

        let entry_size = header.size().unwrap_or(0);
        total_bytes = total_bytes.saturating_add(entry_size);
        if total_bytes > MAX_SKILL_BYTES {
            return Err(format!(
                "skill exceeds {} byte limit",
                MAX_SKILL_BYTES
            ));
        }

        let out_path = dest.join(rel_path);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        // Read the first few bytes and reject executable magic bytes before
        // writing anything to disk.
        let mut buf = Vec::with_capacity(entry_size.min(MAX_SKILL_BYTES) as usize);
        entry
            .read_to_end(&mut buf)
            .map_err(|e| format!("read tar entry body: {}", e))?;
        if has_executable_magic(&buf) {
            return Err(format!("binary magic bytes in {}", path_str));
        }

        std::fs::write(&out_path, &buf).map_err(|e| format!("write {}: {}", out_path.display(), e))?;
        files_written += 1;
    }

    if files_written == 0 {
        return Err(format!(
            "skill '{}' not found in tarball",
            skill_id
        ));
    }

    Ok(total_bytes)
}

fn has_executable_magic(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    // ELF
    if &bytes[0..4] == b"\x7fELF" {
        return true;
    }
    // Mach-O
    let magic = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    if magic == 0xfeedface || magic == 0xfeedfacf || magic == 0xcefaedfe || magic == 0xcffaedfe {
        return true;
    }
    // PE (MZ)
    if &bytes[0..2] == b"MZ" {
        return true;
    }
    false
}

/// Install a registry skill.
#[tauri::command]
pub async fn skills_install(
    app: AppHandle,
    entry: RegistryEntry,
) -> Result<(), String> {
    let id = validate_skill_id(&entry.id)?.to_string();
    let user_dir = user_skills_dir().ok_or_else(|| "could not resolve HOME".to_string())?;
    let dest = user_dir.join(&id);

    if dest.exists() {
        return Err(format!("skill '{}' is already installed", id));
    }

    // Download tarball
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS * 3))
        .build()
        .map_err(|e| format!("build http client: {}", e))?;
    let resp = client
        .get(&entry.tarball_url)
        .send()
        .await
        .map_err(|e| format!("download tarball: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("tarball HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read tarball: {}", e))?;

    // Verify sha256 if the registry specifies one. Empty sha means
    // "not yet populated by CI" — skip verification but log.
    let actual_sha = {
        let mut h = Sha256::new();
        h.update(&bytes);
        format!("{:x}", h.finalize())
    };
    if !entry.sha256.is_empty() && !entry.sha256.eq_ignore_ascii_case(&actual_sha) {
        return Err(format!(
            "sha256 mismatch for '{}': expected {}, got {}",
            id, entry.sha256, actual_sha
        ));
    }
    if entry.sha256.is_empty() {
        tracing::warn!("installing '{}' with empty sha256 — registry not yet signed", id);
    }

    // Extract into a temp dir first; only commit on full success so a
    // failure halfway through never leaves a half-installed skill.
    let staging = user_dir.join(format!(".tmp-install-{}", id));
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .await
            .map_err(|e| format!("clean staging: {}", e))?;
    }
    fs::create_dir_all(&staging)
        .await
        .map_err(|e| format!("create staging: {}", e))?;

    let id_clone = id.clone();
    let staging_path = staging.clone();
    let bytes_vec = bytes.to_vec();
    let extracted_size = tokio::task::spawn_blocking(move || {
        extract_skill_from_tarball(&bytes_vec, &id_clone, &staging_path)
    })
    .await
    .map_err(|e| format!("extract task: {}", e))??;

    // Commit: move staging → dest
    fs::rename(&staging, &dest)
        .await
        .map_err(|e| format!("commit install: {}", e))?;

    // Write origin file
    let meta = InstalledSkillMeta {
        source: OriginSource::Registry,
        id: id.clone(),
        version: entry.version.clone(),
        installed_at: chrono::Utc::now().to_rfc3339(),
        modified: false,
        upstream_sha256: if entry.sha256.is_empty() {
            Some(actual_sha)
        } else {
            Some(entry.sha256.clone())
        },
    };
    skills_origin::write_origin(&dest, &meta)
        .await
        .map_err(|e| format!("write origin: {}", e))?;

    tracing::info!("installed skill '{}' ({} bytes)", id, extracted_size);
    let _ = app.emit(
        "skills-event",
        SkillsEvent::Installed {
            skill_id: id.clone(),
        },
    );
    Ok(())
}

// ─── Uninstall (Task 3.3) ────────────────────────────────────────────

#[tauri::command]
pub async fn skills_uninstall(app: AppHandle, skill_id: String) -> Result<(), String> {
    let id = validate_skill_id(&skill_id)?.to_string();
    let user_dir = user_skills_dir().ok_or_else(|| "could not resolve HOME".to_string())?;
    let dest = user_dir.join(&id);

    // Extra belt-and-suspenders: canonicalize and ensure dest is inside user_dir.
    let canonical_user = fs::canonicalize(&user_dir)
        .await
        .map_err(|e| format!("canonicalize user skills dir: {}", e))?;
    let canonical_dest = fs::canonicalize(&dest)
        .await
        .map_err(|e| format!("canonicalize skill dir: {}", e))?;
    if !canonical_dest.starts_with(&canonical_user) {
        return Err(format!("refusing to remove path outside skills dir"));
    }

    fs::remove_dir_all(&canonical_dest)
        .await
        .map_err(|e| format!("remove skill dir: {}", e))?;

    tracing::info!("uninstalled skill '{}'", id);
    let _ = app.emit(
        "skills-event",
        SkillsEvent::Uninstalled {
            skill_id: id.clone(),
        },
    );
    Ok(())
}

// ─── Search (Task 4.1 — keyword + fuzzy scoring) ─────────────────────

/// Normalize a string into whitespace-split lowercase tokens, dropping
/// anything shorter than 3 chars and common stop words.
fn tokens(s: &str) -> Vec<String> {
    const STOP: &[&str] = &[
        "the", "and", "for", "with", "use", "when", "that", "this", "from",
        "into", "onto", "over", "what", "will", "can", "may", "are", "was",
        "but", "not", "how", "you", "your", "about", "there", "their",
    ];
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3 && !STOP.contains(t))
        .map(String::from)
        .collect()
}

/// Score how well `entry` matches `query_tokens`. Score ranges roughly 0..5.
fn score_entry(entry: &RegistryEntry, query_tokens: &[String]) -> f32 {
    if query_tokens.is_empty() {
        return 0.0;
    }

    let name_tokens = tokens(&entry.name);
    let desc_tokens = tokens(&entry.description);
    let category_tokens: Vec<String> = entry
        .categories
        .iter()
        .flat_map(|c| tokens(c))
        .collect();
    let tag_tokens: Vec<String> = entry.tags.iter().flat_map(|t| tokens(t)).collect();

    let mut score = 0.0f32;
    for q in query_tokens {
        if name_tokens.iter().any(|t| t == q) {
            score += 2.5;
        } else if name_tokens.iter().any(|t| t.contains(q) || q.contains(t)) {
            score += 1.2;
        }
        if tag_tokens.iter().any(|t| t == q) {
            score += 1.5;
        }
        if category_tokens.iter().any(|t| t == q) {
            score += 1.0;
        }
        if desc_tokens.iter().any(|t| t == q) {
            score += 0.6;
        } else if desc_tokens.iter().any(|t| t.contains(q) || q.contains(t)) {
            score += 0.25;
        }
    }

    // Penalize score by query length so "write a short poem" doesn't rank
    // any skill artificially high just because the query is wordy.
    score / (query_tokens.len() as f32).sqrt().max(1.0)
}

fn describe_match(entry: &RegistryEntry, query_tokens: &[String]) -> String {
    let name_hit = query_tokens.iter().any(|q| entry.name.to_lowercase().contains(q));
    let tag_hit = entry.tags.iter().any(|t| {
        query_tokens.iter().any(|q| t.to_lowercase().contains(q))
    });
    if name_hit {
        format!("matches skill name '{}'", entry.name)
    } else if tag_hit {
        format!("tagged for your task ({})", entry.tags.join(", "))
    } else {
        format!("description matches your task")
    }
}

#[tauri::command]
pub async fn skills_search_marketplace(
    app: AppHandle,
    query: String,
    installed_ids: Vec<String>,
) -> Result<Vec<SkillSuggestion>, String> {
    let trimmed = query.trim();
    if trimmed.len() < 4 {
        return Ok(Vec::new());
    }

    // Fetch registry (cached). Falls back to empty on any failure.
    let reg = match skills_fetch_registry(app, false).await {
        Ok(r) => r,
        Err(e) => {
            tracing::debug!("search: registry unavailable ({})", e);
            return Ok(Vec::new());
        }
    };

    let installed: std::collections::HashSet<&str> =
        installed_ids.iter().map(String::as_str).collect();
    let qt = tokens(trimmed);
    if qt.is_empty() {
        return Ok(Vec::new());
    }

    let mut scored: Vec<(f32, RegistryEntry)> = reg
        .skills
        .into_iter()
        .filter(|e| !installed.contains(e.id.as_str()))
        .map(|e| (score_entry(&e, &qt), e))
        .filter(|(s, _)| *s >= 0.9) // threshold — tuned by hand
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(3);

    Ok(scored
        .into_iter()
        .map(|(score, entry)| SkillSuggestion {
            reason: describe_match(&entry, &qt),
            score,
            entry,
        })
        .collect())
}

/// Read the currently-installed AGENTS.md (or SKILL.md fallback) for a given skill.
#[tauri::command]
pub async fn skills_read_installed(skill_id: String) -> Result<String, String> {
    let id = validate_skill_id(&skill_id)?.to_string();
    let user_dir = user_skills_dir().ok_or_else(|| "could not resolve HOME".to_string())?;
    let skill_dir = user_dir.join(&id);
    if !skill_dir.exists() {
        return Err(format!("skill '{}' is not installed", id));
    }
    let agents_md = skill_dir.join("AGENTS.md");
    let skill_md = skill_dir.join("SKILL.md");
    let path = if agents_md.exists() {
        agents_md
    } else if skill_md.exists() {
        skill_md
    } else {
        return Err(format!("no AGENTS.md or SKILL.md for '{}'", id));
    };
    fs::read_to_string(&path)
        .await
        .map_err(|e| format!("read {}: {}", path.display(), e))
}

/// Overwrite an installed skill's `AGENTS.md`. Flips `.solo-origin.json.modified`
/// so the Forks tab picks it up. If the skill was originally a `SKILL.md`-only
/// Claude-style skill, we migrate to AGENTS.md on first write.
#[tauri::command]
pub async fn skills_write_installed(skill_id: String, content: String) -> Result<(), String> {
    let id = validate_skill_id(&skill_id)?.to_string();
    let user_dir = user_skills_dir().ok_or_else(|| "could not resolve HOME".to_string())?;
    let skill_dir = user_dir.join(&id);
    if !skill_dir.exists() {
        return Err(format!("skill '{}' is not installed", id));
    }
    let agents_md = skill_dir.join("AGENTS.md");
    fs::write(&agents_md, content)
        .await
        .map_err(|e| format!("write AGENTS.md: {}", e))?;
    skills_origin::mark_modified(&skill_dir)
        .await
        .map_err(|e| format!("mark modified: {}", e))?;

    Ok(())
}

// ─── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_skill_id_accepts_safe() {
        assert!(validate_skill_id("ui").is_ok());
        assert!(validate_skill_id("poetry-writer").is_ok());
        assert!(validate_skill_id("finance_calc").is_ok());
        assert!(validate_skill_id("skill123").is_ok());
    }

    #[test]
    fn validate_skill_id_rejects_dangerous() {
        assert!(validate_skill_id("").is_err());
        assert!(validate_skill_id("..").is_err());
        assert!(validate_skill_id("../evil").is_err());
        assert!(validate_skill_id("a/b").is_err());
        assert!(validate_skill_id("a b").is_err());
        assert!(validate_skill_id(".hidden").is_err());
        assert!(validate_skill_id("has\0null").is_err());
    }

    #[test]
    fn path_safe_accepts_relative() {
        assert!(path_is_safe_relative(Path::new("foo/bar.md")));
        assert!(path_is_safe_relative(Path::new("./foo.md")));
    }

    #[test]
    fn path_safe_rejects_absolute() {
        assert!(!path_is_safe_relative(Path::new("/etc/passwd")));
    }

    #[test]
    fn path_safe_rejects_parent_dir() {
        assert!(!path_is_safe_relative(Path::new("../escape")));
        assert!(!path_is_safe_relative(Path::new("foo/../../escape")));
    }

    #[test]
    fn banned_exts_cover_scripts_and_binaries() {
        assert!(has_banned_extension(Path::new("x.sh")));
        assert!(has_banned_extension(Path::new("foo.py")));
        assert!(has_banned_extension(Path::new("a/b/c.js")));
        assert!(has_banned_extension(Path::new("foo.EXE")));
        assert!(!has_banned_extension(Path::new("foo.md")));
        assert!(!has_banned_extension(Path::new("no-ext")));
    }

    #[test]
    fn magic_bytes_detect_elf_macho_pe() {
        assert!(has_executable_magic(b"\x7fELF\x02\x01\x01\x00"));
        assert!(has_executable_magic(&[0xfe, 0xed, 0xfa, 0xcf])); // Mach-O 64
        assert!(has_executable_magic(b"MZ\x90\x00"));
        assert!(!has_executable_magic(b"# Hello, world"));
    }

    /// Build a synthetic tarball matching github's layout
    /// (`<repo>-<ref>/skills/<id>/...`) with just two files.
    fn build_fake_tarball(skill_id: &str, top_dir: &str) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let gz = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
            let mut ar = tar::Builder::new(gz);

            let rel_agents = format!("{}/skills/{}/AGENTS.md", top_dir, skill_id);
            let agents_body = b"---\nname: x\ndescription: d\n---\nbody";
            let mut header = tar::Header::new_gnu();
            header.set_path(&rel_agents).unwrap();
            header.set_size(agents_body.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            ar.append(&header, agents_body.as_slice()).unwrap();

            let rel_extra = format!("{}/skills/{}/ref.md", top_dir, skill_id);
            let extra = b"# extra";
            let mut header = tar::Header::new_gnu();
            header.set_path(&rel_extra).unwrap();
            header.set_size(extra.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            ar.append(&header, extra.as_slice()).unwrap();

            ar.finish().unwrap();
        }
        buf
    }

    #[test]
    fn extract_happy_path() {
        let tarball = build_fake_tarball("ui", "skills-registry-main");
        let tmp = tempfile::tempdir().unwrap();
        let bytes = extract_skill_from_tarball(&tarball, "ui", tmp.path()).unwrap();
        assert!(bytes > 0);
        assert!(tmp.path().join("AGENTS.md").exists());
        assert!(tmp.path().join("ref.md").exists());
    }

    #[test]
    fn extract_rejects_when_skill_missing_from_tarball() {
        let tarball = build_fake_tarball("other-skill", "skills-registry-main");
        let tmp = tempfile::tempdir().unwrap();
        let err = extract_skill_from_tarball(&tarball, "ui", tmp.path()).unwrap_err();
        assert!(err.contains("not found"));
    }

    // Note: we don't write an integration test for the `../escape` case
    // because `tar::Builder` refuses to construct such a tarball from Rust
    // (rejects `set_path` with `..`). The defense lives in
    // `path_is_safe_relative`, which IS unit-tested above, and the extract
    // loop calls it before writing. A hostile registry server could hand-roll
    // tar bytes to bypass Builder's check; inspection of the loop confirms
    // every entry path goes through `path_is_safe_relative` first.

    fn build_banned_ext_tarball() -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let gz = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
            let mut ar = tar::Builder::new(gz);
            let rel = "skills-registry-main/skills/ui/install.sh";
            let body = b"#!/bin/sh\nrm -rf /";
            let mut header = tar::Header::new_gnu();
            header.set_path(rel).unwrap();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            ar.append(&header, body.as_slice()).unwrap();
            ar.finish().unwrap();
        }
        buf
    }

    #[test]
    fn extract_rejects_banned_extension() {
        let tarball = build_banned_ext_tarball();
        let tmp = tempfile::tempdir().unwrap();
        let err = extract_skill_from_tarball(&tarball, "ui", tmp.path()).unwrap_err();
        assert!(err.contains("banned"));
    }

    fn build_macho_tarball() -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let gz = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
            let mut ar = tar::Builder::new(gz);
            let rel = "skills-registry-main/skills/ui/payload.md";
            let body = [0xfe, 0xed, 0xfa, 0xcf, 0, 0, 0, 0]; // Mach-O 64 magic inside a .md
            let mut header = tar::Header::new_gnu();
            header.set_path(rel).unwrap();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            ar.append(&header, body.as_slice()).unwrap();
            ar.finish().unwrap();
        }
        buf
    }

    fn sample_entry(id: &str, desc: &str, categories: &[&str], tags: &[&str]) -> RegistryEntry {
        RegistryEntry {
            id: id.into(),
            name: id.into(),
            version: "1.0.0".into(),
            description: desc.into(),
            categories: categories.iter().map(|s| (*s).to_string()).collect(),
            author: "tester".into(),
            license: "MIT".into(),
            tarball_url: String::new(),
            sha256: String::new(),
            tags: tags.iter().map(|s| (*s).to_string()).collect(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn tokens_strip_stopwords_and_short_words() {
        let t = tokens("Use this skill when you want to write poetry");
        assert!(t.contains(&"skill".to_string()));
        assert!(t.contains(&"write".to_string()));
        assert!(t.contains(&"poetry".to_string()));
        assert!(!t.contains(&"the".to_string()));
        assert!(!t.contains(&"use".to_string())); // stop word
        assert!(!t.contains(&"to".to_string())); // short
    }

    #[test]
    fn score_name_match_ranks_highest() {
        let poetry = sample_entry("poetry-writer", "Generate poems", &["writing"], &["poem", "verse"]);
        let cooking = sample_entry("cooking-helper", "Recipe ideas", &["food"], &["recipe"]);
        let q = tokens("i want to write a poem");
        let poetry_score = score_entry(&poetry, &q);
        let cooking_score = score_entry(&cooking, &q);
        assert!(poetry_score > cooking_score);
        assert!(poetry_score > 0.9, "score was {}", poetry_score);
    }

    #[test]
    fn score_ignores_unrelated_skills() {
        let cooking = sample_entry("cooking-helper", "Recipe ideas", &["food"], &["recipe"]);
        let q = tokens("write a sonnet");
        let s = score_entry(&cooking, &q);
        assert!(s < 0.9, "score was {}", s);
    }

    #[test]
    fn score_tag_match_contributes() {
        let entry = sample_entry("x", "Generic description", &[], &["finance", "budget"]);
        let q = tokens("help me with my budget");
        let s = score_entry(&entry, &q);
        assert!(s > 0.9, "score was {}", s);
    }

    #[test]
    fn describe_match_prefers_name_then_tag() {
        let e = sample_entry("poetry-writer", "gen", &[], &["verse"]);
        let msg_name = describe_match(&e, &tokens("poetry please"));
        assert!(msg_name.contains("poetry-writer"));
        let msg_tag = describe_match(&e, &tokens("verse please"));
        assert!(msg_tag.to_lowercase().contains("tag"));
    }

    #[test]
    fn extract_rejects_binary_magic_even_in_md() {
        let tarball = build_macho_tarball();
        let tmp = tempfile::tempdir().unwrap();
        let err = extract_skill_from_tarball(&tarball, "ui", tmp.path()).unwrap_err();
        assert!(err.contains("magic"));
    }
}
