//! Task allocator commands.
//!
//! Phase 1 ships CRUD only. Agent/Schedule/Planner commands land in later phases.

use std::path::PathBuf;
use std::sync::Arc;

use solo_protocol::{
    BackendEvent, Task, TaskDraft, TaskListFilters, TaskPatch, TaskStatus,
};
use solo_tasks::TaskStore;
use tauri::{AppHandle, Emitter as _, State};
use tokio::sync::RwLock;
use tracing::{debug, info};

use crate::task_executor::{spawn_agent_for_task, cancel_task, ExecutorMap};
use crate::agent::SessionManager;
use crate::task_planner::{plan_from_goal as planner_run, ProactiveGate};

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
pub(crate) async fn get_store(state: &State<'_, TaskState>) -> Result<Arc<TaskStore>, String> {
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

// =============================================================================
// Subtask commands
// =============================================================================

#[tauri::command]
pub async fn task_subtask_add(
    task_id: String,
    title: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Task, String> {
    let store = get_store(&state).await?;
    let task = store.subtask_add(&task_id, title).map_err(|e| e.to_string())?;
    emit_changed(&app, vec![task.id.clone()]);
    Ok(task)
}

#[tauri::command]
pub async fn task_subtask_toggle(
    task_id: String,
    subtask_id: String,
    completed: bool,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Task, String> {
    let store = get_store(&state).await?;
    let task = store
        .subtask_toggle(&task_id, &subtask_id, completed)
        .map_err(|e| e.to_string())?;
    emit_changed(&app, vec![task.id.clone()]);
    Ok(task)
}

#[tauri::command]
pub async fn task_subtask_rename(
    task_id: String,
    subtask_id: String,
    title: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Task, String> {
    let store = get_store(&state).await?;
    let task = store
        .subtask_rename(&task_id, &subtask_id, title)
        .map_err(|e| e.to_string())?;
    emit_changed(&app, vec![task.id.clone()]);
    Ok(task)
}

#[tauri::command]
pub async fn task_subtask_remove(
    task_id: String,
    subtask_id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Task, String> {
    let store = get_store(&state).await?;
    let task = store
        .subtask_remove(&task_id, &subtask_id)
        .map_err(|e| e.to_string())?;
    emit_changed(&app, vec![task.id.clone()]);
    Ok(task)
}

#[tauri::command]
pub async fn task_subtask_reorder(
    task_id: String,
    ordered_ids: Vec<String>,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<Task, String> {
    let store = get_store(&state).await?;
    let task = store
        .subtask_reorder(&task_id, &ordered_ids)
        .map_err(|e| e.to_string())?;
    emit_changed(&app, vec![task.id.clone()]);
    Ok(task)
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

// =============================================================================
// Phase 3 — Review commands
// =============================================================================

/// Discard a run: force-remove the worktree and mark the task Done.
#[tauri::command]
pub async fn task_review_discard(
    id: String,
    run_id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
    wt_state: State<'_, crate::worktree_commands::WorktreeState>,
    fs_state: State<'_, crate::fs_commands::FsState>,
) -> Result<(), String> {
    let store = get_store(&state).await?;
    let task = store.get(&id).map_err(|e| e.to_string())?;
    let run = task
        .runs
        .into_iter()
        .find(|r| r.id == run_id)
        .ok_or_else(|| "run not found".to_string())?;
    let wid = run.worktree_id.ok_or_else(|| "run has no worktree".to_string())?;

    let request = solo_protocol::RemoveWorktreeRequest { id: wid, force: true };
    crate::worktree_commands::worktree_remove(request, app.clone(), wt_state, fs_state).await?;

    store.update(
        &id,
        TaskPatch { status: Some(TaskStatus::Done), ..Default::default() },
    ).map_err(|e| e.to_string())?;
    emit_changed(&app, vec![id]);
    Ok(())
}

/// Promote the worktree branch to a stable name, remove the worktree directory,
/// and mark the task Done. Returns the stable branch name for the user to merge manually.
#[tauri::command]
pub async fn task_review_merge(
    id: String,
    run_id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
    wt_state: State<'_, crate::worktree_commands::WorktreeState>,
    fs_state: State<'_, crate::fs_commands::FsState>,
) -> Result<String, String> {
    let store = get_store(&state).await?;
    let task = store.get(&id).map_err(|e| e.to_string())?;
    let run = task
        .runs
        .into_iter()
        .find(|r| r.id == run_id)
        .ok_or_else(|| "run not found".to_string())?;
    let wid = run.worktree_id.ok_or_else(|| "run has no worktree".to_string())?;

    let stable_branch = format!("solo-review/{}", &wid);
    crate::worktree_commands::worktree_promote(
        wid.clone(),
        stable_branch.clone(),
        wt_state.clone(),
        fs_state.clone(),
    ).await?;

    // Remove the worktree directory; the branch persists for manual git merge.
    let request = solo_protocol::RemoveWorktreeRequest { id: wid, force: false };
    let _ = crate::worktree_commands::worktree_remove(request, app.clone(), wt_state, fs_state).await;

    store.update(
        &id,
        TaskPatch { status: Some(TaskStatus::Done), ..Default::default() },
    ).map_err(|e| e.to_string())?;
    emit_changed(&app, vec![id]);
    Ok(stable_branch)
}

/// Return a GitHub compare URL for the run's worktree branch (v1 placeholder).
/// The caller can open this URL to initiate a PR on their git host.
#[tauri::command]
pub async fn task_review_open_pr(
    id: String,
    run_id: String,
    state: State<'_, TaskState>,
) -> Result<String, String> {
    let store = get_store(&state).await?;
    let task = store.get(&id).map_err(|e| e.to_string())?;
    let run = task
        .runs
        .into_iter()
        .find(|r| r.id == run_id)
        .ok_or_else(|| "run not found".to_string())?;
    let wid = run.worktree_id.ok_or_else(|| "run has no worktree".to_string())?;
    Ok(format!("https://github.com/compare/{}", wid))
}

/// Setup-time store opener (no State<'_> lifetime constraint).
pub async fn get_store_for_setup(app: &AppHandle) -> Result<Arc<TaskStore>, String> {
    use tauri::Manager as _;
    let state = app.state::<TaskState>();
    get_store(&state).await
}

// =============================================================================
// Phase 4 — Schedule commands
// =============================================================================

#[tauri::command]
pub async fn task_schedule_preview(
    schedule: solo_protocol::Schedule,
) -> Result<Vec<i64>, String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(0))
        .unwrap_or(0);
    solo_tasks::next_fires(&schedule, now_ms, 5).map_err(|e| e.to_string())
}

// =============================================================================
// Phase 5 — Planner commands
// =============================================================================

#[tauri::command]
pub async fn plan_from_goal(
    goal: String,
    context_override: Option<Vec<String>>,
    app: AppHandle,
    state: State<'_, TaskState>,
    session_manager: State<'_, Arc<SessionManager>>,
) -> Result<Vec<String>, String> {
    let store = get_store(&state).await?;
    let bundle = context_override.unwrap_or_default();
    let draft_ids = planner_run(
        &app,
        store,
        session_manager.inner().clone(),
        goal,
        bundle,
    ).await?;
    let _ = app.emit("backend-event", solo_protocol::BackendEvent::TasksChanged {
        task_ids: draft_ids.clone(),
    });
    Ok(draft_ids)
}

#[tauri::command]
pub async fn plan_accept_draft(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<(), String> {
    let store = get_store(&state).await?;
    store.update(&id, solo_protocol::TaskPatch {
        status: Some(solo_protocol::TaskStatus::Queued),
        ..Default::default()
    }).map_err(|e| e.to_string())?;
    let _ = app.emit("backend-event", solo_protocol::BackendEvent::TasksChanged {
        task_ids: vec![id],
    });
    Ok(())
}

#[tauri::command]
pub async fn plan_dismiss_draft(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<(), String> {
    let store = get_store(&state).await?;
    store.delete(&id).map_err(|e| e.to_string())?;
    let _ = app.emit("backend-event", solo_protocol::BackendEvent::TasksChanged {
        task_ids: vec![id],
    });
    Ok(())
}

#[tauri::command]
pub async fn plan_proactive(
    app: AppHandle,
    state: State<'_, TaskState>,
    session_manager: State<'_, Arc<SessionManager>>,
    gate: State<'_, Arc<ProactiveGate>>,
) -> Result<Vec<String>, String> {
    if !gate.try_fire().await {
        return Err("proactive planner rate-limited (10 min min)".into());
    }
    let store = get_store(&state).await?;
    let draft_ids = planner_run(
        &app,
        store,
        session_manager.inner().clone(),
        "Based on my recent activity, suggest 3 useful next tasks.".to_string(),
        Vec::new(), // use default bundle
    ).await?;
    let _ = app.emit("backend-event", solo_protocol::BackendEvent::TasksChanged {
        task_ids: draft_ids.clone(),
    });
    Ok(draft_ids)
}
