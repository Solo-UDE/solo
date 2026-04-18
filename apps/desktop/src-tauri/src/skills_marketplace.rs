//! Skills marketplace — registry fetch, install, uninstall.
//!
//! **Status:** minimal scaffolding. The full implementation (HTTP fetch with
//! 24h cache, tarball download + sha256 verify + path-traversal-safe extract,
//! semantic search via `solo-embeddings`) is Phase 3–4 of the skills-marketplace
//! plan. This module exists so the frontend IPC wrappers type-check and fail
//! gracefully in the UI (errors render as red banners, not crashes) until the
//! real implementation lands.
//!
//! See `docs/superpowers/plans/2026-04-18-skills-marketplace.md` for the
//! outstanding task list.

use solo_protocol::{Registry, RegistryEntry, SkillSuggestion};
use std::path::PathBuf;
use tokio::fs;

/// Default official registry URL. Users can override via
/// `settings.skills.registry_url` (Phase 3).
#[allow(dead_code)]
const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/solo/skills-registry/main/registry.json";

fn cache_path() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|h| PathBuf::from(h).join(".solo").join("cache").join("registry.json"))
}

/// Fetch the marketplace registry.
///
/// Current behavior: read the cached `registry.json` from
/// `~/.solo/cache/registry.json` if present, otherwise return an empty
/// registry. Network fetch is deferred to Phase 3 so we don't ship a
/// half-baked HTTP client.
#[tauri::command]
pub async fn skills_fetch_registry(force: bool) -> Result<Registry, String> {
    let _ = force; // force-refresh semantics land with the real network fetch.

    if let Some(path) = cache_path() {
        if let Ok(raw) = fs::read_to_string(&path).await {
            if let Ok(reg) = serde_json::from_str::<Registry>(&raw) {
                return Ok(reg);
            }
        }
    }

    // Empty registry — Marketplace tab renders "Registry is empty", which is
    // correct behavior until Phase 3 wires up the network fetch.
    Ok(Registry {
        version: 1,
        generated_at: chrono::Utc::now().to_rfc3339(),
        skills: Vec::new(),
    })
}

/// Semantic search over the registry. Full implementation uses
/// `solo-embeddings`; current stub returns an empty result set.
#[tauri::command]
pub async fn skills_search_marketplace(
    query: String,
    installed_ids: Vec<String>,
) -> Result<Vec<SkillSuggestion>, String> {
    let _ = (query, installed_ids);
    Ok(Vec::new())
}

/// Install a registry skill. Phase 3 implements tarball fetch + sha256
/// verify + path-traversal-safe extract. Current stub rejects.
#[tauri::command]
pub async fn skills_install(entry: RegistryEntry) -> Result<(), String> {
    let _ = entry;
    Err("skills_install: pending Phase 3 implementation".to_string())
}

/// Remove an installed skill directory. Phase 3 implements the safety-checked
/// remove. Current stub rejects.
#[tauri::command]
pub async fn skills_uninstall(skill_id: String) -> Result<(), String> {
    let _ = skill_id;
    Err("skills_uninstall: pending Phase 3 implementation".to_string())
}

/// Overwrite an installed skill's `AGENTS.md`. Phase 5 implements the
/// tweak flow. Current stub rejects.
#[tauri::command]
pub async fn skills_write_installed(skill_id: String, content: String) -> Result<(), String> {
    let _ = (skill_id, content);
    Err("skills_write_installed: pending Phase 5 implementation".to_string())
}
