//! Cycle CRUD Tauri commands.
//!
//! Cycles are time-boxed spans (sprints, weeks, release cuts) that bundle
//! tasks. Tasks carry a nullable `cycle_id`. Deleting a cycle nulls out
//! `cycle_id` on every task that pointed to it.

use solo_protocol::{BackendEvent, Cycle, CycleDraft, CyclePatch};
use tauri::{AppHandle, Emitter as _, State};
use tracing::debug;

use crate::task_commands::{get_store, TaskState};

fn emit_cycles(app: &AppHandle, cycle_ids: Vec<String>) {
    let _ = app.emit("backend-event", BackendEvent::CyclesChanged { cycle_ids });
}

fn emit_tasks(app: &AppHandle, task_ids: Vec<String>) {
    if !task_ids.is_empty() {
        let _ = app.emit("backend-event", BackendEvent::TasksChanged { task_ids });
    }
}

#[tauri::command]
pub async fn cycle_list(state: State<'_, TaskState>) -> Result<Vec<Cycle>, String> {
    get_store(&state).await?.cycle_list().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cycle_create(
    draft: CycleDraft,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Cycle, String> {
    let cycle = get_store(&state).await?
        .cycle_create(draft)
        .map_err(|e| e.to_string())?;
    debug!(id = %cycle.id, "cycle created");
    emit_cycles(&app, vec![cycle.id.clone()]);
    Ok(cycle)
}

#[tauri::command]
pub async fn cycle_update(
    id: String,
    patch: CyclePatch,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Cycle, String> {
    let cycle = get_store(&state).await?
        .cycle_update(&id, patch)
        .map_err(|e| e.to_string())?;
    emit_cycles(&app, vec![id]);
    Ok(cycle)
}

#[tauri::command]
pub async fn cycle_delete(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<(), String> {
    let affected_tasks = get_store(&state).await?
        .cycle_delete(&id)
        .map_err(|e| e.to_string())?;
    emit_cycles(&app, vec![id]);
    emit_tasks(&app, affected_tasks);
    Ok(())
}
