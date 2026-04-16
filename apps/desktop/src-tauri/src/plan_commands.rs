//! Tauri command layer for plan-mode plan files at `<workspace>/.solo/plans/<slug>.md`.

use std::path::PathBuf;

use solo_core::plans;

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

/// Generate a fresh plan slug that doesn't collide with existing files.
#[tauri::command]
pub async fn plan_new_slug(workspace: String) -> Result<String, String> {
    let ws = resolve_workspace(workspace)?;
    tokio::task::spawn_blocking(move || plans::new_slug(&ws).map_err(to_err))
        .await
        .map_err(to_err)?
}

/// Write plan content atomically. Returns the absolute path on disk.
#[tauri::command]
pub async fn plan_write(
    workspace: String,
    slug: String,
    content: String,
) -> Result<String, String> {
    let ws = resolve_workspace(workspace)?;
    tokio::task::spawn_blocking(move || {
        plans::write_plan(&ws, &slug, &content)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(to_err)
    })
    .await
    .map_err(to_err)?
}

/// Read the contents of a plan file. Returns `None` when the file is missing.
#[tauri::command]
pub async fn plan_read(workspace: String, slug: String) -> Result<Option<String>, String> {
    let ws = resolve_workspace(workspace)?;
    tokio::task::spawn_blocking(move || plans::read_plan(&ws, &slug).map_err(to_err))
        .await
        .map_err(to_err)?
}

/// List all plan slugs in the workspace, sorted.
#[tauri::command]
pub async fn plan_list(workspace: String) -> Result<Vec<String>, String> {
    let ws = resolve_workspace(workspace)?;
    tokio::task::spawn_blocking(move || plans::list_plans(&ws).map_err(to_err))
        .await
        .map_err(to_err)?
}

/// Delete a plan file. Idempotent — missing files are not an error.
#[tauri::command]
pub async fn plan_delete(workspace: String, slug: String) -> Result<(), String> {
    let ws = resolve_workspace(workspace)?;
    tokio::task::spawn_blocking(move || plans::delete_plan(&ws, &slug).map_err(to_err))
        .await
        .map_err(to_err)?
}

/// Resolve the absolute path for a plan slug without reading the file.
#[tauri::command]
pub async fn plan_path(workspace: String, slug: String) -> Result<String, String> {
    let ws = resolve_workspace(workspace)?;
    tokio::task::spawn_blocking(move || {
        plans::plan_path(&ws, &slug)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(to_err)
    })
    .await
    .map_err(to_err)?
}
