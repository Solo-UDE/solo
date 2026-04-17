//! Worktree command handlers for Solo IDE
//!
//! This module contains all git worktree related IPC commands.

use solo_git::WorktreeManager;
use solo_protocol::{
    BackendEvent, CreateWorktreeRequest, RemoveWorktreeRequest, WorktreeDiffEntry, WorktreeInfo,
    WorktreeSetupConfig,
};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use tracing::{debug, info};

use crate::fs_commands::FsState;

/// Application state for worktree operations
pub struct WorktreeState {
    /// Per-repo worktree managers (repo_path -> manager)
    pub managers: RwLock<HashMap<PathBuf, WorktreeManager>>,
    /// Currently active worktree ID (None = main workspace)
    pub active_worktree_id: RwLock<Option<String>>,
    /// Original workspace root before worktree switch (for restoration)
    pub original_workspace_root: RwLock<Option<PathBuf>>,
}

impl WorktreeState {
    pub fn new() -> Self {
        Self {
            managers: RwLock::new(HashMap::new()),
            active_worktree_id: RwLock::new(None),
            original_workspace_root: RwLock::new(None),
        }
    }
}

impl Default for WorktreeState {
    fn default() -> Self {
        Self::new()
    }
}

/// Max number of cached WorktreeManagers (one per repo)
const MAX_MANAGERS: usize = 8;

/// Get or create a WorktreeManager for the current workspace.
/// Uses original_workspace_root when available (i.e., when workspace_root has been
/// swapped to a worktree path), since managers are keyed by the real repo root.
/// Evicts the oldest entries when the cache exceeds MAX_MANAGERS.
async fn get_manager(wt_state: &WorktreeState, fs_state: &FsState) -> Result<PathBuf, String> {
    let repo_path = {
        let orig = wt_state.original_workspace_root.read().await;
        if let Some(ref path) = *orig {
            path.clone()
        } else {
            let workspace = fs_state.workspace_root.read().await;
            workspace
                .as_ref()
                .ok_or("No workspace root set. Open a folder first.")?
                .clone()
        }
    };

    let mut managers = wt_state.managers.write().await;
    if !managers.contains_key(&repo_path) {
        // Evict oldest entries if at capacity
        while managers.len() >= MAX_MANAGERS {
            if let Some(oldest_key) = managers.keys().next().cloned() {
                managers.remove(&oldest_key);
            }
        }
        let manager = WorktreeManager::new(&repo_path).map_err(|e| e.to_string())?;
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
    stats: State<'_, crate::stats_commands::StatsState>,
) -> Result<WorktreeInfo, String> {
    info!(branch = %request.branch, create_branch = request.create_branch, "Creating worktree");

    let repo_path = get_manager(&wt_state, &fs_state).await?;

    // Emit progress
    let _ = app.emit(
        "backend-event",
        &BackendEvent::WorktreeProgress {
            worktree_id: request.branch.clone(),
            message: format!("Creating worktree for branch '{}'...", request.branch),
        },
    );

    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    match manager.create(&request) {
        Ok(info) => {
            stats.record(solo_stats::StatsEvent::WorktreeCreated).await;

            let _ = app.emit(
                "backend-event",
                &BackendEvent::WorktreeReady {
                    worktree_id: info.id.clone(),
                    info: info.clone(),
                },
            );

            // Run setup commands in background with a 5-minute timeout
            let setup_commands = manager.get_setup_commands().unwrap_or_default();
            if !setup_commands.is_empty() {
                let wt_id = info.id.clone();
                let wt_path = info.path.clone();
                let app_clone = app.clone();

                tokio::spawn(async move {
                    let setup_future = async {
                        for cmd in &setup_commands {
                            let _ = app_clone.emit(
                                "backend-event",
                                &BackendEvent::WorktreeSetupProgress {
                                    worktree_id: wt_id.clone(),
                                    command: cmd.clone(),
                                    output: format!("Running: {}", cmd),
                                    is_error: false,
                                    is_complete: false,
                                },
                            );

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
                                        let _ = app_clone.emit(
                                            "backend-event",
                                            &BackendEvent::WorktreeSetupProgress {
                                                worktree_id: wt_id.clone(),
                                                command: cmd.clone(),
                                                output: stdout,
                                                is_error: false,
                                                is_complete: false,
                                            },
                                        );
                                    }
                                    if !stderr.is_empty() || is_error {
                                        let _ = app_clone.emit(
                                            "backend-event",
                                            &BackendEvent::WorktreeSetupProgress {
                                                worktree_id: wt_id.clone(),
                                                command: cmd.clone(),
                                                output: if stderr.is_empty() {
                                                    "Command failed".to_string()
                                                } else {
                                                    stderr
                                                },
                                                is_error,
                                                is_complete: false,
                                            },
                                        );
                                    }
                                }
                                Err(e) => {
                                    let _ = app_clone.emit(
                                        "backend-event",
                                        &BackendEvent::WorktreeSetupProgress {
                                            worktree_id: wt_id.clone(),
                                            command: cmd.clone(),
                                            output: format!("Failed to run command: {}", e),
                                            is_error: true,
                                            is_complete: false,
                                        },
                                    );
                                }
                            }
                        }
                    };

                    // Enforce a 5-minute timeout on the entire setup sequence
                    let timed_out = tokio::time::timeout(
                        std::time::Duration::from_secs(300),
                        setup_future,
                    )
                    .await
                    .is_err();

                    if timed_out {
                        let _ = app_clone.emit(
                            "backend-event",
                            &BackendEvent::WorktreeSetupProgress {
                                worktree_id: wt_id.clone(),
                                command: String::new(),
                                output: "Setup timed out after 5 minutes".to_string(),
                                is_error: true,
                                is_complete: true,
                            },
                        );
                    } else {
                        let _ = app_clone.emit(
                            "backend-event",
                            &BackendEvent::WorktreeSetupProgress {
                                worktree_id: wt_id,
                                command: String::new(),
                                output: "Setup complete".to_string(),
                                is_error: false,
                                is_complete: true,
                            },
                        );
                    }
                });
            }

            Ok(info)
        }
        Err(e) => {
            let error_msg = e.to_string();
            let _ = app.emit(
                "backend-event",
                &BackendEvent::WorktreeError {
                    worktree_id: request.branch.clone(),
                    error: error_msg.clone(),
                },
            );
            Err(error_msg)
        }
    }
}

/// Remove a worktree.
/// Returns the restored workspace path if the removed worktree was active.
#[tauri::command]
pub async fn worktree_remove(
    request: RemoveWorktreeRequest,
    app: AppHandle,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<Option<String>, String> {
    info!(id = %request.id, force = request.force, "Removing worktree");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager
        .remove(&request.id, request.force)
        .map_err(|e| e.to_string())?;

    // If we removed the active worktree, restore workspace_root to original
    let mut restored_path: Option<String> = None;
    let mut active = wt_state.active_worktree_id.write().await;
    if active.as_deref() == Some(&request.id) {
        *active = None;

        let original = {
            let mut orig = wt_state.original_workspace_root.write().await;
            orig.take()
        };

        if let Some(original) = original {
            let mut workspace = fs_state.workspace_root.write().await;
            *workspace = Some(original.clone());
            restored_path = Some(original.display().to_string());
            info!(path = %original.display(), "Workspace root restored after worktree removal");
        }
    }

    let _ = app.emit(
        "backend-event",
        &BackendEvent::WorktreeRemoved {
            worktree_id: request.id,
        },
    );

    Ok(restored_path)
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

/// Set the active worktree (switches workspace context).
/// Pass None/null to return to the main workspace.
/// Returns the target path so the frontend can re-scope file explorer + watcher.
///
/// The swap is performed atomically: original root, workspace root, and active ID
/// are all updated under a single lock scope to prevent inconsistent state on
/// concurrent calls or crashes.
#[tauri::command]
pub async fn worktree_set_active(
    id: Option<String>,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<Option<String>, String> {
    info!(id = ?id, "Setting active worktree");

    let target_path = if let Some(ref wt_id) = id {
        // Resolve worktree path *before* we touch any mutable state
        let repo_path = get_manager(&wt_state, &fs_state).await?;
        let managers = wt_state.managers.read().await;
        let manager = managers.get(&repo_path).unwrap();
        let wt_path = manager
            .worktree_path(wt_id)
            .ok_or_else(|| format!("Worktree not found: {}", wt_id))?;

        // Atomic swap: acquire all write locks, then update in one go
        let mut orig = wt_state.original_workspace_root.write().await;
        let mut workspace = fs_state.workspace_root.write().await;
        let mut active = wt_state.active_worktree_id.write().await;

        if orig.is_none() {
            *orig = workspace.clone();
        }
        *workspace = Some(wt_path.clone());
        *active = id;

        info!(path = %wt_path.display(), "Workspace root swapped to worktree");
        Some(wt_path.display().to_string())
    } else {
        // Return to main workspace: atomic restore
        let mut orig = wt_state.original_workspace_root.write().await;
        let mut workspace = fs_state.workspace_root.write().await;
        let mut active = wt_state.active_worktree_id.write().await;

        let target = if let Some(original) = orig.take() {
            *workspace = Some(original.clone());
            info!(path = %original.display(), "Workspace root restored to main");
            Some(original.display().to_string())
        } else {
            workspace.as_ref().map(|p| p.display().to_string())
        };
        *active = None;

        target
    };

    Ok(target_path)
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

    manager
        .lock(&id, reason.as_deref())
        .map_err(|e| e.to_string())
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

    // Restore context if the active worktree was pruned
    if !pruned.is_empty() {
        let mut active = wt_state.active_worktree_id.write().await;
        if let Some(ref active_id) = *active {
            if pruned.contains(active_id) {
                *active = None;

                let original = {
                    let mut orig = wt_state.original_workspace_root.write().await;
                    orig.take()
                };
                if let Some(original) = original {
                    let mut workspace = fs_state.workspace_root.write().await;
                    *workspace = Some(original);
                }
            }
        }
    }

    Ok(pruned)
}

/// Bind an agent session to a worktree (also locks it).
#[tauri::command]
pub async fn worktree_bind_agent(
    worktree_id: String,
    session_id: String,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<(), String> {
    info!(worktree_id = %worktree_id, session_id = %session_id, "Binding agent to worktree");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager
        .set_agent_session(&worktree_id, &session_id)
        .map_err(|e| e.to_string())?;

    // Auto-lock the worktree while an agent is working in it
    let _ = manager.lock(&worktree_id, Some("Agent session active"));

    Ok(())
}

/// Unbind an agent session from a worktree (also unlocks it).
#[tauri::command]
pub async fn worktree_unbind_agent(
    worktree_id: String,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<(), String> {
    info!(worktree_id = %worktree_id, "Unbinding agent from worktree");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager
        .clear_agent_session(&worktree_id)
        .map_err(|e| e.to_string())?;

    // Unlock the worktree
    let _ = manager.unlock(&worktree_id);

    Ok(())
}

/// Find the worktree bound to an agent session (returns worktree ID or null).
#[tauri::command]
pub async fn worktree_find_by_agent(
    session_id: String,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<Option<String>, String> {
    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager
        .find_by_agent_session(&session_id)
        .map_err(|e| e.to_string())
}

/// Diff a worktree against its merge-base with the main branch.
#[tauri::command]
pub async fn worktree_diff_from_base(
    worktree_id: String,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<Vec<WorktreeDiffEntry>, String> {
    debug!(worktree_id = %worktree_id, "Computing diff from base");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager
        .diff_from_base(&worktree_id)
        .map_err(|e| e.to_string())
}

/// Rename a worktree's branch in-place. Backed by `git branch -m` on the
/// main repo; the worktree id and filesystem path are preserved so live
/// agent sessions, open editor tabs, and file watchers don't break.
#[tauri::command]
pub async fn worktree_rename(
    worktree_id: String,
    new_branch: String,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<WorktreeInfo, String> {
    info!(worktree_id = %worktree_id, new_branch = %new_branch, "Renaming worktree branch");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager
        .rename(&worktree_id, &new_branch)
        .map_err(|e| e.to_string())
}

/// Create a named branch pointing at a worktree's current HEAD.
#[tauri::command]
pub async fn worktree_promote(
    worktree_id: String,
    branch_name: String,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<(), String> {
    info!(worktree_id = %worktree_id, branch = %branch_name, "Promoting worktree to branch");

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager
        .promote_to_branch(&worktree_id, &branch_name)
        .map_err(|e| e.to_string())
}

/// Set setup commands for new worktrees
#[tauri::command]
pub async fn worktree_set_setup_commands(
    config: WorktreeSetupConfig,
    wt_state: State<'_, WorktreeState>,
    fs_state: State<'_, FsState>,
) -> Result<(), String> {
    info!(
        count = config.commands.len(),
        "Setting worktree setup commands"
    );

    let repo_path = get_manager(&wt_state, &fs_state).await?;
    let managers = wt_state.managers.read().await;
    let manager = managers.get(&repo_path).unwrap();

    manager
        .set_setup_commands(config.commands)
        .map_err(|e| e.to_string())
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
