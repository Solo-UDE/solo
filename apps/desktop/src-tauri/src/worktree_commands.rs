//! Worktree command handlers for Solo IDE
//!
//! This module contains all git worktree related IPC commands.

use solo_git::WorktreeManager;
use solo_protocol::{BackendEvent, CreateWorktreeRequest, RemoveWorktreeRequest, WorktreeInfo};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use tracing::{debug, info};

use crate::agent_commands::AgentState;
use crate::fs_commands::FsState;

/// Application state for worktree operations
pub struct WorktreeState {
    /// Per-repo worktree managers (repo_path -> manager)
    pub managers: RwLock<HashMap<PathBuf, WorktreeManager>>,
    /// Currently active worktree ID (None = main workspace)
    pub active_worktree_id: RwLock<Option<String>>,
}

impl WorktreeState {
    pub fn new() -> Self {
        Self {
            managers: RwLock::new(HashMap::new()),
            active_worktree_id: RwLock::new(None),
        }
    }
}

impl Default for WorktreeState {
    fn default() -> Self {
        Self::new()
    }
}

/// Get or create a WorktreeManager for the current workspace.
async fn get_manager(
    wt_state: &WorktreeState,
    fs_state: &FsState,
) -> Result<PathBuf, String> {
    let workspace = fs_state.workspace_root.read().await;
    let repo_path = workspace
        .as_ref()
        .ok_or("No workspace root set. Open a folder first.")?
        .clone();

    let mut managers = wt_state.managers.write().await;
    if !managers.contains_key(&repo_path) {
        let manager = WorktreeManager::new(repo_path.clone())
            .map_err(|e| e.to_string())?;
        managers.insert(repo_path.clone(), manager);
    }

    Ok(repo_path)
}

/// List all worktrees for the current repository
#[tauri::command]
pub async fn worktree_list(
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<Vec<WorktreeInfo>, String> {
    debug!("Listing worktrees");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager.list().map_err(|e| e.to_string())
}

/// Create a new worktree
#[tauri::command]
pub async fn worktree_create(
    request: CreateWorktreeRequest,
    app: AppHandle,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<WorktreeInfo, String> {
    info!(branch = %request.branch, create_branch = request.create_branch, "Creating worktree");

    let repo_path = get_manager(&wt_state, &fs_state).await?;

    // Emit progress
    let _ = app.emit("backend-event", &BackendEvent::WorktreeProgress {
        worktree_id: request.branch.clone(),
        message: format!("Creating worktree for branch '{}'...", request.branch),
    });

    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    match manager.create(&request) {
        Ok(info) => {
            let _ = app.emit("backend-event", &BackendEvent::WorktreeReady {
                worktree_id: info.id.clone(),
                info: info.clone(),
            });
            Ok(info)
        }
        Err(e) => {
            let error_msg = e.to_string();
            let _ = app.emit("backend-event", &BackendEvent::WorktreeError {
                worktree_id: request.branch.clone(),
                error: error_msg.clone(),
            });
            Err(error_msg)
        }
    }
}

/// Remove a worktree
#[tauri::command]
pub async fn worktree_remove(
    request: RemoveWorktreeRequest,
    app: AppHandle,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<(), String> {
    info!(id = %request.id, force = request.force, "Removing worktree");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager.remove(&request.id, request.force).map_err(|e| e.to_string())?;

    // If we removed the active worktree, reset to main
    let mut active = wt_state.active_worktree_id.write().await;
    if active.as_deref() == Some(&request.id) {
        *active = None;
    }

    let _ = app.emit("backend-event", &BackendEvent::WorktreeRemoved {
        worktree_id: request.id,
    });

    Ok(())
}

/// Get a single worktree by ID
#[tauri::command]
pub async fn worktree_get(
    id: String,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<WorktreeInfo, String> {
    debug!(id = %id, "Getting worktree");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager.get(&id).map_err(|e| e.to_string())
}

/// Set the active worktree (switches agent workspace context).
/// Pass None/null to return to the main workspace.
#[tauri::command]
pub async fn worktree_set_active(
    id: Option<String>,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
    agent_state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(id = ?id, "Setting active worktree");

    // Determine the target path
    let target_path = if let Some(ref wt_id) = id {
        let repo_path = get_manager(&wt_state, &fs_state).await?;
        let managers = wt_state.managers.read().await;
        let manager = managers.get(&repo_path).unwrap();
        let wt_path = manager.worktree_path(wt_id)
            .ok_or_else(|| format!("Worktree not found: {}", wt_id))?;
        wt_path
    } else {
        // Reset to main workspace
        let workspace = fs_state.workspace_root.read().await;
        workspace.as_ref()
            .ok_or("No workspace root set")?
            .clone()
    };

    // Update active worktree ID
    *wt_state.active_worktree_id.write().await = id;

    // Update the agent's tool registry workspace root
    let registry = agent_state.manager.tool_registry();
    registry.read().await.set_workspace_root(&target_path).await;

    debug!(path = %target_path.display(), "Active worktree path set");

    Ok(())
}

/// Get the currently active worktree (None = main workspace)
#[tauri::command]
pub async fn worktree_get_active(
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<Option<WorktreeInfo>, String> {
    let active_id = wt_state.active_worktree_id.read().await.clone();

    match active_id {
        Some(id) => {
            let repo_path = get_manager(&wt_state, &fs_state).await?;
            let managers = wt_state.managers.read().await;
            let manager = managers.get(&repo_path).unwrap();
            let info = manager.get(&id).map_err(|e| e.to_string())?;
            Ok(Some(info))
        }
        None => Ok(None),
    }
}

/// Lock a worktree
#[tauri::command]
pub async fn worktree_lock(
    id: String,
    reason: Option<String>,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<(), String> {
    info!(id = %id, reason = ?reason, "Locking worktree");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager.lock(&id, reason.as_deref()).map_err(|e| e.to_string())
}

/// Unlock a worktree
#[tauri::command]
pub async fn worktree_unlock(
    id: String,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<(), String> {
    info!(id = %id, "Unlocking worktree");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager.unlock(&id).map_err(|e| e.to_string())
}
