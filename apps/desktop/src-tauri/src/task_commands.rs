//! Task allocator commands.
//!
//! Phase 1 ships CRUD only. Agent/Schedule/Planner commands land in later phases.

use std::path::PathBuf;
use std::sync::Arc;

use solo_protocol::{
    BackendEvent, Task, TaskDraft, TaskListFilters, TaskPatch,
};
use solo_tasks::TaskStore;
use tauri::{AppHandle, Emitter as _, State};
use tokio::sync::RwLock;
use tracing::{debug, info};

use crate::task_executor::{spawn_agent_for_task, cancel_task, ExecutorMap};
use crate::agent::SessionManager;

// =============================================================================
// State
// =============================================================================

pub struct TaskState {
    inner: Arc<RwLock<Option<Arc<TaskStore>>>>,
}

impl TaskState {
    pub fn new() -> Self {
        Self { inner: Arc::new(RwLock::new(None)) }
    }
}

impl Default for TaskState {
    fn default() -> Self { Self::new() }
}

/// Lazy-open the store on first call. Stored under `~/.solo/tasks/tasks.db`.
async fn get_store(state: &State<'_, TaskState>) -> Result<Arc<TaskStore>, String> {
    {
        let guard = state.inner.read().await;
        if let Some(s) = guard.as_ref() { return Ok(s.clone()); }
    }
    let mut guard = state.inner.write().await;
    if let Some(s) = guard.as_ref() { return Ok(s.clone()); }

    let home = dirs::home_dir().ok_or_else(|| "home dir not found".to_string())?;
    let path: PathBuf = home.join(".solo").join("tasks").join("tasks.db");
    info!(path = %path.display(), "Opening task store");
    let store = Arc::new(TaskStore::open(&path).map_err(|e| e.to_string())?);
    *guard = Some(store.clone());
    Ok(store)
}

fn emit_changed(app: &AppHandle, ids: Vec<String>) {
    let _ = app.emit("backend-event", BackendEvent::TasksChanged { task_ids: ids });
}

// =============================================================================
// Commands
// =============================================================================

#[tauri::command]
pub async fn task_list(
    filter: Option<TaskListFilters>,
    state: State<'_, TaskState>,
) -> Result<Vec<Task>, String> {
    let store = get_store(&state).await?;
    let f = filter.unwrap_or_default();
    store.list(&f).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn task_get(
    id: String,
    state: State<'_, TaskState>,
) -> Result<Task, String> {
    let store = get_store(&state).await?;
    store.get(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn task_create(
    draft: TaskDraft,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Task, String> {
    let store = get_store(&state).await?;
    let task = store.create(draft).map_err(|e| e.to_string())?;
    debug!(id = %task.id, "task created");
    emit_changed(&app, vec![task.id.clone()]);
    Ok(task)
}

#[tauri::command]
pub async fn task_update(
    id: String,
    patch: TaskPatch,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Task, String> {
    let store = get_store(&state).await?;
    let task = store.update(&id, patch).map_err(|e| e.to_string())?;
    emit_changed(&app, vec![task.id.clone()]);
    Ok(task)
}

#[tauri::command]
pub async fn task_delete(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<(), String> {
    let store = get_store(&state).await?;
    store.delete(&id).map_err(|e| e.to_string())?;
    emit_changed(&app, vec![id]);
    Ok(())
}

#[tauri::command]
pub async fn task_search(
    query: String,
    state: State<'_, TaskState>,
) -> Result<Vec<Task>, String> {
    let store = get_store(&state).await?;
    store.search(&query).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn task_run(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
    executor_map: State<'_, Arc<ExecutorMap>>,
    session_manager: State<'_, Arc<SessionManager>>,
) -> Result<String, String> {
    let store = get_store(&state).await?;
    spawn_agent_for_task(
        &app,
        store,
        executor_map.inner().clone(),
        session_manager.inner().clone(),
        id,
    ).await
}

#[tauri::command]
pub async fn task_cancel(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
    executor_map: State<'_, Arc<ExecutorMap>>,
    session_manager: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    let store = get_store(&state).await?;
    cancel_task(
        &app,
        store,
        executor_map.inner().clone(),
        session_manager.inner().clone(),
        id,
    ).await
}

/// Setup-time store opener (no State<'_> lifetime constraint).
pub async fn get_store_for_setup(app: &AppHandle) -> Result<Arc<TaskStore>, String> {
    use tauri::Manager as _;
    let state = app.state::<TaskState>();
    get_store(&state).await
}
