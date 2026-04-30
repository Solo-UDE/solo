//! Project CRUD Tauri commands.
//!
//! Projects group related tasks under a shared goal. Tasks carry a nullable
//! `project_id`. Deleting a project nulls out `project_id` on every task that
//! pointed to it.

use solo_protocol::{BackendEvent, Project, ProjectDraft, ProjectPatch};
use tauri::{AppHandle, Emitter as _, State};
use tracing::debug;

use crate::task_commands::{get_store, TaskState};

fn emit_projects(app: &AppHandle, project_ids: Vec<String>) {
    let _ = app.emit("backend-event", BackendEvent::ProjectsChanged { project_ids });
}

fn emit_tasks(app: &AppHandle, task_ids: Vec<String>) {
    if !task_ids.is_empty() {
        let _ = app.emit("backend-event", BackendEvent::TasksChanged { task_ids });
    }
}

#[tauri::command]
pub async fn project_list(state: State<'_, TaskState>) -> Result<Vec<Project>, String> {
    get_store(&state).await?.project_list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_get(
    id: String,
    state: State<'_, TaskState>,
) -> Result<Project, String> {
    get_store(&state).await?.project_get(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_create(
    draft: ProjectDraft,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Project, String> {
    let project = get_store(&state).await?
        .project_create(draft)
        .map_err(|e| e.to_string())?;
    debug!(id = %project.id, "project created");
    emit_projects(&app, vec![project.id.clone()]);
    Ok(project)
}

#[tauri::command]
pub async fn project_update(
    id: String,
    patch: ProjectPatch,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Project, String> {
    let project = get_store(&state).await?
        .project_update(&id, patch)
        .map_err(|e| e.to_string())?;
    emit_projects(&app, vec![id]);
    Ok(project)
}

#[tauri::command]
pub async fn project_delete(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<(), String> {
    let affected_tasks = get_store(&state).await?
        .project_delete(&id)
        .map_err(|e| e.to_string())?;
    emit_projects(&app, vec![id]);
    emit_tasks(&app, affected_tasks);
    Ok(())
}
