//! Worktree command handlers for Solo IDE
//!
//! This module contains all git worktree related IPC commands.

use solo_git::WorktreeManager;
use solo_protocol::{BackendEvent, CreateWorktreeRequest, RemoveWorktreeRequest, WorktreeInfo, WorktreeSetupConfig};
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

/// Create a new worktree, then run setup commands if configured
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

            // Run setup commands in background if configured
            let setup_commands = manager.get_setup_commands().unwrap_or_default();
            if !setup_commands.is_empty() {
                let wt_id = info.id.clone();
                let wt_path = info.path.clone();
                let app_clone = app.clone();

                tokio::spawn(async move {
                    for cmd in &setup_commands {
                        let _ = app_clone.emit("backend-event", &BackendEvent::WorktreeSetupProgress {
                            worktree_id: wt_id.clone(),
                            command: cmd.clone(),
                            output: format!("Running: {}", cmd),
                            is_error: false,
                            is_complete: false,
                        });

                        let output = tokio::process::Command::new("sh")
                            .args(["-c", cmd])
                            .current_dir(&wt_path)
                            .output()
                            .await;

                        match output {
                            Ok(out) => {
                                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                                let is_error = !out.status.success();

                                if !stdout.is_empty() {
                                    let _ = app_clone.emit("backend-event", &BackendEvent::WorktreeSetupProgress {
                                        worktree_id: wt_id.clone(),
                                        command: cmd.clone(),
                                        output: stdout,
                                        is_error: false,
                                        is_complete: false,
                                    });
                                }
                                if !stderr.is_empty() || is_error {
                                    let _ = app_clone.emit("backend-event", &BackendEvent::WorktreeSetupProgress {
                                        worktree_id: wt_id.clone(),
                                        command: cmd.clone(),
                                        output: if stderr.is_empty() { "Command failed".to_string() } else { stderr },
                                        is_error,
                                        is_complete: false,
                                    });
                                }
                            }
                            Err(e) => {
                                let _ = app_clone.emit("backend-event", &BackendEvent::WorktreeSetupProgress {
                                    worktree_id: wt_id.clone(),
                                    command: cmd.clone(),
                                    output: format!("Failed to run command: {}", e),
                                    is_error: true,
                                    is_complete: false,
                                });
                            }
                        }
                    }

                    // Signal all setup commands complete
                    let _ = app_clone.emit("backend-event", &BackendEvent::WorktreeSetupProgress {
                        worktree_id: wt_id,
                        command: String::new(),
                        output: "Setup complete".to_string(),
                        is_error: false,
                        is_complete: true,
                    });
                });
            }

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

/// Prune stale worktrees (missing dirs or exceeding max age)
#[tauri::command]
pub async fn worktree_prune(
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<Vec<String>, String> {
    info!("Pruning stale worktrees");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    let pruned = manager.prune_stale().map_err(|e| e.to_string())?;

    // Clear active worktree if it was pruned
    if !pruned.is_empty() {
        let mut active = wt_state.active_worktree_id.write().await;
        if let Some(ref active_id) = *active {
            if pruned.contains(active_id) {
                *active = None;
            }
        }
    }

    Ok(pruned)
}

/// Set setup commands for new worktrees
#[tauri::command]
pub async fn worktree_set_setup_commands(
    config: WorktreeSetupConfig,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<(), String> {
    info!(count = config.commands.len(), "Setting worktree setup commands");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager.set_setup_commands(config.commands).map_err(|e| e.to_string())
}

/// Get setup commands for new worktrees
#[tauri::command]
pub async fn worktree_get_setup_commands(
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<WorktreeSetupConfig, String> {
    debug!("Getting worktree setup commands");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    let commands = manager.get_setup_commands().map_err(|e| e.to_string())?;
    Ok(WorktreeSetupConfig { commands })
}
