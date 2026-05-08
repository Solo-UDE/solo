//! Tauri command layer for the `.solo/settings.json` hierarchy.
//!
//! All commands expect `workspace` to be the absolute path to the current
//! project root — the same path the frontend tracks as the active workspace.

use std::path::PathBuf;

use solo_core::{permissions, settings};
use solo_protocol::{
    BackendEvent, PermissionCheckRequest, PermissionDecision, PermissionMode, PermissionsConfig,
    SettingsScope, SoloSettings,
};
use tauri::Emitter;

fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn resolve_workspace(workspace: String) -> Result<PathBuf, String> {
    let path = PathBuf::from(workspace);
    if path.as_os_str().is_empty() {
        return Err("workspace path is empty".to_string());
    }
    Ok(path)
}

/// Load fully-merged settings for a given workspace (user → project → local).
///
/// Missing files yield defaults, so this is safe to call on a fresh project.
#[tauri::command]
pub async fn settings_load(workspace: String) -> Result<SoloSettings, String> {
    let ws = resolve_workspace(workspace)?;
    tokio::task::spawn_blocking(move || settings::load_merged(&ws).map_err(to_err))
        .await
        .map_err(to_err)?
}

/// Load a single scope (useful for the settings UI to display/edit just one file).
#[tauri::command]
pub async fn settings_load_scope(
    scope: SettingsScope,
    workspace: String,
) -> Result<SoloSettings, String> {
    let ws = resolve_workspace(workspace)?;
    tokio::task::spawn_blocking(move || settings::load_scope(scope, &ws).map_err(to_err))
        .await
        .map_err(to_err)?
}

/// Save a scope's settings to disk and emit `settings:changed` so listeners refresh.
#[tauri::command]
pub async fn settings_save(
    app: tauri::AppHandle,
    scope: SettingsScope,
    workspace: String,
    settings: SoloSettings,
) -> Result<(), String> {
    let ws = resolve_workspace(workspace.clone())?;
    let ws_clone = ws.clone();
    let settings_clone = settings.clone();
    tokio::task::spawn_blocking(move || {
        settings::save_scope(scope, &ws_clone, &settings_clone).map_err(to_err)
    })
    .await
    .map_err(to_err)??;

    // Re-merge and broadcast.
    let ws_merge = ws.clone();
    let merged =
        tokio::task::spawn_blocking(move || settings::load_merged(&ws_merge).map_err(to_err))
            .await
            .map_err(to_err)??;

    let _ = app.emit(
        "backend-event",
        BackendEvent::SettingsChanged { settings: merged },
    );
    Ok(())
}

/// Append an allow rule to a scope's settings (deduped) and broadcast the change.
#[tauri::command]
pub async fn settings_add_allow_rule(
    app: tauri::AppHandle,
    scope: SettingsScope,
    workspace: String,
    rule: String,
) -> Result<SoloSettings, String> {
    let ws = resolve_workspace(workspace)?;
    let ws_clone = ws.clone();
    let rule_clone = rule.clone();
    tokio::task::spawn_blocking(move || {
        settings::add_allow_rule(scope, &ws_clone, &rule_clone).map_err(to_err)
    })
    .await
    .map_err(to_err)??;

    let ws_merge = ws.clone();
    let merged =
        tokio::task::spawn_blocking(move || settings::load_merged(&ws_merge).map_err(to_err))
            .await
            .map_err(to_err)??;
    let _ = app.emit(
        "backend-event",
        BackendEvent::SettingsChanged {
            settings: merged.clone(),
        },
    );
    Ok(merged)
}

/// Append a deny rule to a scope's settings (deduped) and broadcast the change.
#[tauri::command]
pub async fn settings_add_deny_rule(
    app: tauri::AppHandle,
    scope: SettingsScope,
    workspace: String,
    rule: String,
) -> Result<SoloSettings, String> {
    let ws = resolve_workspace(workspace)?;
    let ws_clone = ws.clone();
    let rule_clone = rule.clone();
    tokio::task::spawn_blocking(move || {
        settings::add_deny_rule(scope, &ws_clone, &rule_clone).map_err(to_err)
    })
    .await
    .map_err(to_err)??;

    let ws_merge = ws.clone();
    let merged =
        tokio::task::spawn_blocking(move || settings::load_merged(&ws_merge).map_err(to_err))
            .await
            .map_err(to_err)??;
    let _ = app.emit(
        "backend-event",
        BackendEvent::SettingsChanged {
            settings: merged.clone(),
        },
    );
    Ok(merged)
}

/// Append an ask rule to a scope's settings (deduped) and broadcast the change.
#[tauri::command]
pub async fn settings_add_ask_rule(
    app: tauri::AppHandle,
    scope: SettingsScope,
    workspace: String,
    rule: String,
) -> Result<SoloSettings, String> {
    let ws = resolve_workspace(workspace)?;
    let ws_clone = ws.clone();
    let rule_clone = rule.clone();
    tokio::task::spawn_blocking(move || {
        settings::add_ask_rule(scope, &ws_clone, &rule_clone).map_err(to_err)
    })
    .await
    .map_err(to_err)??;

    let ws_merge = ws.clone();
    let merged =
        tokio::task::spawn_blocking(move || settings::load_merged(&ws_merge).map_err(to_err))
            .await
            .map_err(to_err)??;
    let _ = app.emit(
        "backend-event",
        BackendEvent::SettingsChanged {
            settings: merged.clone(),
        },
    );
    Ok(merged)
}

/// Run the permission decision pipeline against the merged settings.
///
/// This is the single source of truth for "should this tool call proceed?" —
/// the agent bridge calls it before emitting a `permission_request` event,
/// so Accept-mode auto-approvals never flash a modal in the UI.
#[tauri::command]
pub async fn permissions_check(
    workspace: String,
    request: PermissionCheckRequest,
) -> Result<PermissionDecision, String> {
    let ws = resolve_workspace(workspace)?;
    tokio::task::spawn_blocking(move || {
        let merged = settings::load_merged(&ws).map_err(to_err)?;
        Ok::<PermissionDecision, String>(permissions::check(
            &request.tool_name,
            &request.tool_input,
            request.mode,
            &merged.permissions,
        ))
    })
    .await
    .map_err(to_err)?
}

/// Convenience: fetch just the permissions slice (used by the settings UI).
#[tauri::command]
pub async fn settings_get_permissions(workspace: String) -> Result<PermissionsConfig, String> {
    let ws = resolve_workspace(workspace)?;
    tokio::task::spawn_blocking(move || settings::load_permissions(&ws).map_err(to_err))
        .await
        .map_err(to_err)?
}

/// Resolve the default mode for a new session (from merged settings).
#[tauri::command]
pub async fn settings_default_mode(workspace: String) -> Result<PermissionMode, String> {
    let ws = resolve_workspace(workspace)?;
    tokio::task::spawn_blocking(move || {
        let merged = settings::load_merged(&ws).map_err(to_err)?;
        Ok::<PermissionMode, String>(merged.permissions.default_mode.unwrap_or_default())
    })
    .await
    .map_err(to_err)?
}

/// Get the planner_notes field from user-scope settings.
///
/// planner_notes is personal and always stored at user scope (~/.solo/settings.json),
/// so no workspace argument is needed.
#[tauri::command]
pub async fn settings_get_planner_notes() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "home directory not found".to_string())?;
    tokio::task::spawn_blocking(move || {
        let user =
            settings::load_scope(solo_protocol::SettingsScope::User, &home).map_err(to_err)?;
        Ok::<String, String>(user.planner_notes)
    })
    .await
    .map_err(to_err)?
}

/// Set the planner_notes field in user-scope settings.
#[tauri::command]
pub async fn settings_set_planner_notes(
    app: tauri::AppHandle,
    notes: String,
) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "home directory not found".to_string())?;
    let notes_clone = notes.clone();
    let home_clone = home.clone();
    tokio::task::spawn_blocking(move || {
        settings::update_scope(solo_protocol::SettingsScope::User, &home_clone, |s| {
            s.planner_notes = notes_clone;
        })
        .map_err(to_err)
    })
    .await
    .map_err(to_err)??;

    // Emit settings:changed so UI listeners can refresh (best-effort).
    if let Ok(merged) =
        tokio::task::spawn_blocking(move || settings::load_merged(&home).map_err(to_err))
            .await
            .map_err(to_err)
    {
        if let Ok(merged) = merged {
            let _ = app.emit(
                "backend-event",
                solo_protocol::BackendEvent::SettingsChanged { settings: merged },
            );
        }
    }
    Ok(())
}
