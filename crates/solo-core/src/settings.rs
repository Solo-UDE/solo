//! Settings persistence and merging, modeled after Claude Code's settings hierarchy.
//!
//! Precedence (low → high): user → project → local. Higher scopes override
//! scalar fields; `allow` / `deny` / `ask` arrays are concatenated and deduped
//! so a deny rule set in a higher scope never *removes* a deny rule from a lower one.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use solo_protocol::{PermissionsConfig, PluginsConfig, SettingsScope, SkillsConfig, SoloSettings};

const SETTINGS_DIR: &str = ".solo";
const SETTINGS_FILE: &str = "settings.json";
const LOCAL_SETTINGS_FILE: &str = "settings.local.json";

/// Returns `~/.solo/` — creating it if missing.
pub fn user_settings_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("home directory not found")?;
    let dir = home.join(SETTINGS_DIR);
    if !dir.exists() {
        fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    Ok(dir)
}

/// Returns `<workspace>/.solo/` — creating it if missing.
pub fn project_settings_dir(workspace: &Path) -> Result<PathBuf> {
    let dir = workspace.join(SETTINGS_DIR);
    if !dir.exists() {
        fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    Ok(dir)
}

/// Resolves the on-disk path for a given scope.
pub fn settings_path_for_scope(scope: SettingsScope, workspace: &Path) -> Result<PathBuf> {
    match scope {
        SettingsScope::User => Ok(user_settings_dir()?.join(SETTINGS_FILE)),
        SettingsScope::Project => Ok(project_settings_dir(workspace)?.join(SETTINGS_FILE)),
        SettingsScope::Local => Ok(project_settings_dir(workspace)?.join(LOCAL_SETTINGS_FILE)),
    }
}

/// Load raw settings for a single scope. Returns default if the file is missing.
pub fn load_scope(scope: SettingsScope, workspace: &Path) -> Result<SoloSettings> {
    let path = settings_path_for_scope(scope, workspace)?;
    if !path.exists() {
        return Ok(SoloSettings::default());
    }
    let raw = fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    if raw.trim().is_empty() {
        return Ok(SoloSettings::default());
    }
    serde_json::from_str(&raw).with_context(|| format!("parsing {}", path.display()))
}

/// Load and merge settings from all three scopes.
///
/// Precedence: user → project → local (higher scope wins). Arrays in
/// `PermissionsConfig` are unioned and deduplicated.
pub fn load_merged(workspace: &Path) -> Result<SoloSettings> {
    let user = load_scope(SettingsScope::User, workspace).unwrap_or_default();
    let project = load_scope(SettingsScope::Project, workspace).unwrap_or_default();
    let local = load_scope(SettingsScope::Local, workspace).unwrap_or_default();

    let mut merged = user;
    merge_into(&mut merged, project);
    merge_into(&mut merged, local);
    Ok(merged)
}

/// Merge `src` into `dst` in place. Scalar fields in `src` override `dst`;
/// array fields are unioned (dedup preserving first-seen order).
fn merge_into(dst: &mut SoloSettings, src: SoloSettings) {
    // permissions
    if src.permissions.default_mode.is_some() {
        dst.permissions.default_mode = src.permissions.default_mode;
    }
    dst.permissions.allow = union(&dst.permissions.allow, &src.permissions.allow);
    dst.permissions.deny = union(&dst.permissions.deny, &src.permissions.deny);
    dst.permissions.ask = union(&dst.permissions.ask, &src.permissions.ask);
    dst.permissions.additional_directories = union(
        &dst.permissions.additional_directories,
        &src.permissions.additional_directories,
    );
    if src.permissions.disable_accept_mode {
        dst.permissions.disable_accept_mode = true;
    }

    // modes.debug — scalar override
    if src.modes.debug.review_interval > 0 {
        dst.modes.debug.review_interval = src.modes.debug.review_interval;
    }
    dst.modes.debug.initial_goal_capture = src.modes.debug.initial_goal_capture;

    // skills — higher scope fully overrides; import prefs are global by nature
    // and partial field-merge would make "explicitly disabled" indistinguishable
    // from "left at default".
    dst.skills = src.skills;

    // plugins — higher scope fully overrides when any value differs from default
    let defaults = PluginsConfig::default();
    if (
        src.plugins.adapter_claude_plugins,
        src.plugins.adapter_codex_user,
    ) != (defaults.adapter_claude_plugins, defaults.adapter_codex_user)
    {
        dst.plugins = src.plugins;
    }

    // planner_notes — higher scope wins when non-empty
    if !src.planner_notes.is_empty() {
        dst.planner_notes = src.planner_notes;
    }
}

/// Shorthand: load only the `skills` section (merged).
pub fn load_skills_config(workspace: &Path) -> Result<SkillsConfig> {
    Ok(load_merged(workspace)?.skills)
}

/// Mark onboarding as shown — persists at user scope so it applies everywhere.
pub fn mark_skills_onboarding_shown(workspace: &Path) -> Result<SoloSettings> {
    update_scope(SettingsScope::User, workspace, |s| {
        s.skills.onboarding_shown = true;
    })
}

/// Clear the onboarding flag so the dialog runs again on next launch.
pub fn reset_skills_onboarding(workspace: &Path) -> Result<SoloSettings> {
    update_scope(SettingsScope::User, workspace, |s| {
        s.skills.onboarding_shown = false;
    })
}

/// Update skill-import toggles at user scope.
pub fn update_skill_imports(
    workspace: &Path,
    claude_user: Option<bool>,
    claude_plugins: Option<bool>,
    claude_project: Option<bool>,
    codex: Option<bool>,
) -> Result<SoloSettings> {
    update_scope(SettingsScope::User, workspace, |s| {
        if let Some(v) = claude_user {
            s.skills.import_claude_user = v;
        }
        if let Some(v) = claude_plugins {
            s.skills.import_claude_plugins = v;
        }
        if let Some(v) = claude_project {
            s.skills.import_claude_project = v;
        }
        if let Some(v) = codex {
            s.skills.import_codex = v;
        }
    })
}

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

fn union(a: &[String], b: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(a.len() + b.len());
    for item in a.iter().chain(b.iter()) {
        if !out.iter().any(|x: &String| x == item) {
            out.push(item.clone());
        }
    }
    out
}

/// Save settings for a given scope, pretty-printed.
pub fn save_scope(
    scope: SettingsScope,
    workspace: &Path,
    settings: &SoloSettings,
) -> Result<PathBuf> {
    let path = settings_path_for_scope(scope, workspace)?;
    let raw = serde_json::to_string_pretty(settings).context("serializing settings")?;
    fs::write(&path, raw).with_context(|| format!("writing {}", path.display()))?;
    Ok(path)
}

/// Apply a partial update to a scope's file, deep-merging the update into existing content.
///
/// Useful for "add rule" flows where callers only want to append one entry to
/// `permissions.allow` without clobbering other fields.
pub fn update_scope<F>(scope: SettingsScope, workspace: &Path, mutate: F) -> Result<SoloSettings>
where
    F: FnOnce(&mut SoloSettings),
{
    let mut current = load_scope(scope, workspace)?;
    mutate(&mut current);
    save_scope(scope, workspace, &current)?;
    Ok(current)
}

/// Append a rule to a scope's allow list (deduped).
pub fn add_allow_rule(scope: SettingsScope, workspace: &Path, rule: &str) -> Result<SoloSettings> {
    update_scope(scope, workspace, |s| {
        push_unique(&mut s.permissions.allow, rule);
    })
}

/// Append a rule to a scope's deny list (deduped).
pub fn add_deny_rule(scope: SettingsScope, workspace: &Path, rule: &str) -> Result<SoloSettings> {
    update_scope(scope, workspace, |s| {
        push_unique(&mut s.permissions.deny, rule);
    })
}

/// Append a rule to a scope's ask list (deduped).
pub fn add_ask_rule(scope: SettingsScope, workspace: &Path, rule: &str) -> Result<SoloSettings> {
    update_scope(scope, workspace, |s| {
        push_unique(&mut s.permissions.ask, rule);
    })
}

fn push_unique(list: &mut Vec<String>, value: &str) {
    if !list.iter().any(|x| x == value) {
        list.push(value.to_string());
    }
}

/// Shorthand for code that only cares about the permissions section.
pub fn load_permissions(workspace: &Path) -> Result<PermissionsConfig> {
    Ok(load_merged(workspace)?.permissions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use solo_protocol::PermissionMode;
    use tempfile::TempDir;

    fn scratch() -> TempDir {
        TempDir::new().expect("tempdir")
    }

    #[test]
    fn missing_files_yield_defaults() {
        let dir = scratch();
        let merged = load_merged(dir.path()).expect("load ok");
        assert!(merged.permissions.allow.is_empty());
        assert!(merged.permissions.deny.is_empty());
    }

    #[test]
    fn project_overrides_user_scalar() {
        let _dir = scratch();
        // Simulate a user-scope default_mode by writing it to the project scope
        // directly — we only exercise the merge, not the user-scope path.
        let mut user = SoloSettings::default();
        user.permissions.default_mode = Some(PermissionMode::Plan);

        let mut project = SoloSettings::default();
        project.permissions.default_mode = Some(PermissionMode::Default);

        let mut merged = user;
        merge_into(&mut merged, project);
        assert_eq!(
            merged.permissions.default_mode,
            Some(PermissionMode::Default)
        );
    }

    #[test]
    fn allow_lists_are_unioned() {
        let mut dst = SoloSettings::default();
        dst.permissions.allow = vec!["Read".into(), "Glob".into()];

        let mut src = SoloSettings::default();
        src.permissions.allow = vec!["Glob".into(), "Grep".into()];

        merge_into(&mut dst, src);
        assert_eq!(
            dst.permissions.allow,
            vec!["Read".to_string(), "Glob".to_string(), "Grep".to_string()]
        );
    }

    #[test]
    fn round_trip_save_and_load() {
        let dir = scratch();
        let mut s = SoloSettings::default();
        s.permissions.default_mode = Some(PermissionMode::Accept);
        s.permissions.allow.push("Bash(git status)".into());
        save_scope(SettingsScope::Project, dir.path(), &s).expect("save");

        let back = load_scope(SettingsScope::Project, dir.path()).expect("load");
        assert_eq!(back.permissions.default_mode, Some(PermissionMode::Accept));
        assert_eq!(back.permissions.allow, vec!["Bash(git status)"]);
    }

    #[test]
    fn add_allow_rule_dedups() {
        let dir = scratch();
        add_allow_rule(SettingsScope::Project, dir.path(), "Read").expect("first add");
        add_allow_rule(SettingsScope::Project, dir.path(), "Read").expect("second add");
        let loaded = load_scope(SettingsScope::Project, dir.path()).expect("load");
        assert_eq!(loaded.permissions.allow, vec!["Read"]);
    }
}
