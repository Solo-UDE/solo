//! Label CRUD Tauri commands.
//!
//! Labels are free-form tags with a color, stored in the `labels` table. Task
//! membership is tracked by `Task.label_ids` (JSON on the task row). Deleting a
//! label prunes its id from every task that carried it.

use solo_protocol::{BackendEvent, Label, LabelDraft, LabelPatch, Task};
use tauri::{AppHandle, Emitter as _, State};
use tracing::debug;

use crate::task_commands::{get_store, TaskState};
use crate::vault_commands::{get_vault, VaultState};

fn emit_labels(app: &AppHandle, label_ids: Vec<String>) {
    let _ = app.emit("backend-event", BackendEvent::LabelsChanged { label_ids });
}

fn emit_tasks(app: &AppHandle, task_ids: Vec<String>) {
    if !task_ids.is_empty() {
        let _ = app.emit("backend-event", BackendEvent::TasksChanged { task_ids });
    }
}

#[tauri::command]
pub async fn label_list(state: State<'_, TaskState>) -> Result<Vec<Label>, String> {
    get_store(&state)
        .await?
        .label_list()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn label_create(
    draft: LabelDraft,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Label, String> {
    let label = get_store(&state)
        .await?
        .label_create(draft)
        .map_err(|e| e.to_string())?;
    debug!(id = %label.id, "label created");
    emit_labels(&app, vec![label.id.clone()]);
    Ok(label)
}

#[tauri::command]
pub async fn label_update(
    id: String,
    patch: LabelPatch,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Label, String> {
    let label = get_store(&state)
        .await?
        .label_update(&id, patch)
        .map_err(|e| e.to_string())?;
    emit_labels(&app, vec![id]);
    Ok(label)
}

#[tauri::command]
pub async fn label_delete(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
    vault_state: State<'_, VaultState>,
) -> Result<(), String> {
    let affected_tasks = get_store(&state)
        .await?
        .label_delete(&id)
        .map_err(|e| e.to_string())?;
    if let Ok(vault) = get_vault(&vault_state).await {
        match vault.prune_label_id(&id) {
            Ok(entry_ids) => {
                for entry_id in entry_ids {
                    let _ = app.emit(
                        "backend-event",
                        BackendEvent::VaultEntryUpdated { entry_id },
                    );
                }
            }
            Err(error) => {
                tracing::warn!(label_id = %id, error = %error, "label_delete: vault label prune failed");
            }
        }
    }
    emit_labels(&app, vec![id]);
    emit_tasks(&app, affected_tasks);
    Ok(())
}

#[tauri::command]
pub async fn task_label_add(
    task_id: String,
    label_id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Task, String> {
    let task = get_store(&state)
        .await?
        .task_label_add(&task_id, &label_id)
        .map_err(|e| e.to_string())?;
    emit_tasks(&app, vec![task.id.clone()]);
    Ok(task)
}

#[tauri::command]
pub async fn task_label_remove(
    task_id: String,
    label_id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Task, String> {
    let task = get_store(&state)
        .await?
        .task_label_remove(&task_id, &label_id)
        .map_err(|e| e.to_string())?;
    emit_tasks(&app, vec![task.id.clone()]);
    Ok(task)
}
