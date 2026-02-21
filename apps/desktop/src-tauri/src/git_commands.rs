//! Git command handlers for Solo IDE
//!
//! This module provides git operations using the `git2` crate.
//! Each command opens a fresh `Repository` handle via `spawn_blocking`
//! because `git2::Repository` is `!Send`.

use git2::{
    build::CheckoutBuilder, Cred, CredentialType, Delta, DiffOptions, FetchOptions,
    IndexAddOption, MergeOptions, PushOptions, RemoteCallbacks, Repository, ResetType, Signature,
    StatusOptions,
};
use solo_protocol::{
    BackendEvent, BranchInfo, GitChangedFile, GitChangesResponse, GitChangesSummary,
    GitFileDiffResponse, GitFileStatus, GitMergeResult, GitPullResponse, GitPushResponse,
    GitRepoStatus, GitStashPopResult, StashEntry,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use tracing::{info, warn};

/// Application state for git operations
pub struct GitState {
    /// Cached workspace path (reserved for future use)
    #[allow(dead_code)]
    pub workspace_path: RwLock<Option<PathBuf>>,
}

impl GitState {
    pub fn new() -> Self {
        Self {
            workspace_path: RwLock::new(None),
        }
    }
}

impl Default for GitState {
    fn default() -> Self {
        Self::new()
    }
}

/// Helper to get the workspace path from FsState
async fn get_workspace_path(
    fs_state: &State<'_, crate::fs_commands::FsState>,
) -> Result<PathBuf, String> {
    let guard = fs_state.workspace_root.read().await;
    guard
        .clone()
        .ok_or_else(|| "No workspace folder open".to_string())
}

/// Emit a git progress event
fn emit_git_progress(app: &AppHandle, operation: &str, message: &str) {
    let _ = app.emit(
        "backend-event",
        &BackendEvent::GitProgress {
            operation: operation.to_string(),
            message: message.to_string(),
        },
    );
}

/// Emit a git changes updated event
fn emit_git_changes_updated(app: &AppHandle) {
    let _ = app.emit("backend-event", &BackendEvent::GitChangesUpdated {});
}

/// Clean up stale git lock files (older than 5 minutes)
fn cleanup_git_locks(project_path: &Path) {
    let lock_files = [
        project_path.join(".git/index.lock"),
        project_path.join(".git/HEAD.lock"),
        project_path.join(".git/config.lock"),
    ];

    for lock_file in &lock_files {
        if lock_file.exists() {
            if let Ok(metadata) = std::fs::metadata(lock_file) {
                if let Ok(modified) = metadata.modified() {
                    let age = std::time::SystemTime::now()
                        .duration_since(modified)
                        .unwrap_or_default();
                    if age > std::time::Duration::from_secs(300) {
                        if let Err(e) = std::fs::remove_file(lock_file) {
                            warn!("Could not clean up lock file {:?}: {}", lock_file, e);
                        } else {
                            info!("Cleaned up stale lock file: {:?}", lock_file);
                        }
                    }
                }
            }
        }
    }
}

/// Ensure the repo is initialized and scoped to the project path
fn ensure_local_repo_scope(project_path: &Path) -> Result<Repository, String> {
    let git_dir = project_path.join(".git");

    // Check if there's a repo at this exact path
    if git_dir.exists() {
        if let Ok(repo) = Repository::open(project_path) {
            // Verify it's scoped to our project
            if let Some(workdir) = repo.workdir() {
                if workdir == project_path {
                    return Ok(repo);
                }
            }
        }
    }

    // Initialize a new repo
    Repository::init(project_path).map_err(|e| format!("Failed to init git repo: {}", e))
}

/// Upsert a remote — set URL if exists, or add new
fn upsert_remote(repo: &Repository, name: &str, url: &str) -> Result<(), String> {
    if repo.find_remote(name).is_ok() {
        repo.remote_set_url(name, url)
            .map_err(|e| format!("Failed to set remote URL: {}", e))?;
    } else {
        repo.remote(name, url)
            .map_err(|e| format!("Failed to add remote: {}", e))?;
    }
    Ok(())
}

/// Check info about the github-integ remote
fn get_github_integ_info(repo: &Repository, branch: &str) -> (bool, bool) {
    let has_remote = repo.find_remote("github-integ").is_ok();
    if !has_remote {
        return (false, false);
    }

    let ref_name = format!("refs/remotes/github-integ/{}", branch);
    let has_branch = repo.refname_to_id(&ref_name).is_ok();

    (has_remote, has_branch)
}

/// Returns true if the URL uses SSH transport.
fn is_ssh_url(url: &str) -> bool {
    url.starts_with("git@") || url.starts_with("ssh://")
}

/// Build auth callbacks that handle both HTTPS (OAuth token) and SSH (agent).
fn make_auth_callbacks(token: &str) -> RemoteCallbacks<'_> {
    let mut callbacks = RemoteCallbacks::new();
    let token_owned = token.to_string();
    callbacks.credentials(move |_url, username_from_url, allowed| {
        if allowed.contains(CredentialType::SSH_KEY) {
            // SSH remote — use the system SSH agent (or default key)
            let user = username_from_url.unwrap_or("git");
            Cred::ssh_key_from_agent(user)
        } else {
            // HTTPS remote — use the GitHub OAuth token
            Cred::userpass_plaintext("x-access-token", &token_owned)
        }
    });
    callbacks
}

/// Create fetch options with dual-transport auth
fn make_fetch_options<'a>(token: &'a str) -> FetchOptions<'a> {
    let mut fetch_opts = FetchOptions::new();
    fetch_opts.remote_callbacks(make_auth_callbacks(token));
    fetch_opts
}

/// Create push options with dual-transport auth
fn make_push_options<'a>(token: &'a str) -> PushOptions<'a> {
    let mut push_opts = PushOptions::new();
    push_opts.remote_callbacks(make_auth_callbacks(token));
    push_opts
}

// =============================================================================
// Commands
// =============================================================================

/// Get the git repository status (is repo, branch, SHA, remote info)
#[tauri::command]
pub async fn git_get_status(
    fs_state: State<'_, crate::fs_commands::FsState>,
) -> Result<GitRepoStatus, String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        let git_dir = workspace_path.join(".git");
        if !git_dir.exists() {
            return Ok(GitRepoStatus {
                is_repo: false,
                current_branch: None,
                head_sha: None,
                has_remote: false,
                remote_url: None,
                commits_ahead: None,
            });
        }

        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        let current_branch = repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(String::from));

        let head_sha = repo
            .head()
            .ok()
            .and_then(|h| h.target())
            .map(|oid| oid.to_string());

        let (has_remote, remote_url) = match repo.find_remote("github-integ") {
            Ok(remote) => (true, remote.url().map(String::from)),
            Err(_) => match repo.find_remote("origin") {
                Ok(remote) => (true, remote.url().map(String::from)),
                Err(_) => (false, None),
            },
        };

        // Compute commits ahead of remote tracking branch
        let commits_ahead = if has_remote {
            if let Some(ref branch) = current_branch {
                // Try github-integ remote first, then origin
                let remote_ref = format!("refs/remotes/github-integ/{}", branch);
                let remote_oid = repo.refname_to_id(&remote_ref).ok().or_else(|| {
                    let origin_ref = format!("refs/remotes/origin/{}", branch);
                    repo.refname_to_id(&origin_ref).ok()
                });

                if let (Some(remote_oid), Ok(head_ref)) = (remote_oid, repo.head()) {
                    if let Some(head_oid) = head_ref.target() {
                        let mut count = 0u32;
                        if let Ok(mut revwalk) = repo.revwalk() {
                            let _ = revwalk.push(head_oid);
                            let _ = revwalk.hide(remote_oid);
                            count = revwalk.count() as u32;
                        }
                        Some(count)
                    } else {
                        Some(0)
                    }
                } else if repo.head().is_ok() {
                    // Has remote but no tracking branch yet — all local commits are ahead
                    if let Ok(head_ref) = repo.head() {
                        if let Some(head_oid) = head_ref.target() {
                            let mut count = 0u32;
                            if let Ok(mut revwalk) = repo.revwalk() {
                                let _ = revwalk.push(head_oid);
                                count = revwalk.count() as u32;
                            }
                            Some(count)
                        } else {
                            Some(0)
                        }
                    } else {
                        Some(0)
                    }
                } else {
                    Some(0)
                }
            } else {
                None
            }
        } else {
            None
        };

        Ok(GitRepoStatus {
            is_repo: true,
            current_branch,
            head_sha,
            has_remote,
            remote_url,
            commits_ahead,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Setup GitHub integration (init repo, set config, upsert remote)
#[tauri::command]
pub async fn git_setup(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    github_repo_url: String,
    username: String,
    email: String,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        emit_git_progress(&app, "setup", "Setting up GitHub integration...");
        cleanup_git_locks(&workspace_path);

        let repo = ensure_local_repo_scope(&workspace_path)?;

        // Set user config
        let mut config = repo
            .config()
            .map_err(|e| format!("Failed to get config: {}", e))?;
        config
            .set_str("user.name", &username)
            .map_err(|e| format!("Failed to set user.name: {}", e))?;
        config
            .set_str("user.email", &email)
            .map_err(|e| format!("Failed to set user.email: {}", e))?;

        // Upsert remote
        upsert_remote(&repo, "github-integ", &github_repo_url)?;

        emit_git_progress(&app, "setup", "GitHub integration configured");
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Push local commits to GitHub (standard push — no synthetic commits)
#[tauri::command]
pub async fn git_push(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    access_token: String,
    github_repo_url: String,
    branch: String,
    commit_message: Option<String>,
) -> Result<GitPushResponse, String> {
    // commit_message is kept in the signature for backward compat but unused
    let _ = commit_message;
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        emit_git_progress(&app, "push", "Preparing to push...");
        cleanup_git_locks(&workspace_path);

        let repo = ensure_local_repo_scope(&workspace_path)?;

        // For HTTPS, embed token in URL; for SSH, the callback handles auth
        let remote_url = if is_ssh_url(&github_repo_url) {
            github_repo_url.clone()
        } else {
            github_repo_url.replace("https://", &format!("https://{}@", access_token))
        };
        upsert_remote(&repo, "github-integ", &remote_url)?;

        let result = (|| -> Result<GitPushResponse, String> {
            // Must have at least one commit
            if repo.head().is_err() {
                return Err("No commits to push. Commit first.".to_string());
            }

            // Ensure HEAD points to the target branch
            let head = repo
                .head()
                .map_err(|e| format!("Failed to get HEAD: {}", e))?;
            let current = head.shorthand().unwrap_or("main");
            if current != branch {
                // Switch to branch if it exists, otherwise create it
                let refname = format!("refs/heads/{}", branch);
                if repo.refname_to_id(&refname).is_ok() {
                    repo.set_head(&refname)
                        .map_err(|e| format!("Failed to switch to branch: {}", e))?;
                } else {
                    let commit = head
                        .peel_to_commit()
                        .map_err(|e| format!("Failed to peel HEAD: {}", e))?;
                    repo.branch(&branch, &commit, false)
                        .map_err(|e| format!("Failed to create branch: {}", e))?;
                    repo.set_head(&refname)
                        .map_err(|e| format!("Failed to set HEAD: {}", e))?;
                }
            }

            // Count commits ahead of remote
            let head_oid = repo
                .head()
                .map_err(|e| format!("Failed to get HEAD: {}", e))?
                .target()
                .ok_or("HEAD has no target")?;

            let remote_ref = format!("refs/remotes/github-integ/{}", branch);
            let commits_count = if let Ok(remote_oid) = repo.refname_to_id(&remote_ref) {
                let mut count = 0u32;
                if let Ok(mut revwalk) = repo.revwalk() {
                    let _ = revwalk.push(head_oid);
                    let _ = revwalk.hide(remote_oid);
                    count = revwalk.count() as u32;
                }
                count
            } else {
                // No remote branch yet — all local commits
                let mut count = 0u32;
                if let Ok(mut revwalk) = repo.revwalk() {
                    let _ = revwalk.push(head_oid);
                    count = revwalk.count() as u32;
                }
                count
            };

            if commits_count == 0 {
                emit_git_progress(&app, "push", "Nothing to push");
                return Ok(GitPushResponse { commits_count: 0 });
            }

            emit_git_progress(&app, "push", &format!("Pushing {} commit(s)...", commits_count));

            let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
            let mut push_opts = make_push_options(&access_token);

            let mut remote = repo
                .find_remote("github-integ")
                .map_err(|e| format!("Failed to find remote: {}", e))?;

            remote
                .push(&[&refspec], Some(&mut push_opts))
                .map_err(|e| {
                    let msg = e.to_string();
                    if msg.contains("non-fast-forward") {
                        "Push rejected (non-fast-forward). Pull first to integrate remote changes.".to_string()
                    } else {
                        format!("Failed to push: {}", msg)
                    }
                })?;

            // Update local remote-tracking ref
            let _ = repo.reference(
                &format!("refs/remotes/github-integ/{}", branch),
                head_oid,
                true,
                "update after push",
            );

            emit_git_progress(&app, "push", "Push complete");
            Ok(GitPushResponse { commits_count })
        })();

        // Always restore unauthenticated URL
        let _ = upsert_remote(&repo, "github-integ", &github_repo_url);

        emit_git_changes_updated(&app);
        result
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Pull changes from GitHub
#[tauri::command]
pub async fn git_pull(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    access_token: String,
    github_repo_url: String,
    branch: String,
    force_reset: bool,
) -> Result<GitPullResponse, String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
		emit_git_progress(&app, "pull", "Preparing to pull...");
		cleanup_git_locks(&workspace_path);

		let mut repo = ensure_local_repo_scope(&workspace_path)?;

		let remote_url = if is_ssh_url(&github_repo_url) {
			github_repo_url.clone()
		} else {
			github_repo_url.replace("https://", &format!("https://{}@", access_token))
		};
		upsert_remote(&repo, "github-integ", &remote_url)?;

		let result = (|| -> Result<GitPullResponse, String> {
			// Fetch from GitHub
			emit_git_progress(&app, "pull", "Fetching from GitHub...");
			{
				let mut remote = repo
					.find_remote("github-integ")
					.map_err(|e| format!("Failed to find remote: {}", e))?;
				let mut fetch_opts = make_fetch_options(&access_token);
				remote
					.fetch(&[&branch], Some(&mut fetch_opts), None)
					.map_err(|e| format!("Failed to fetch: {}", e))?;
			}

			// Check if remote branch exists
			let remote_ref = format!("refs/remotes/github-integ/{}", branch);
			let remote_oid = match repo.refname_to_id(&remote_ref) {
				Ok(oid) => oid,
				Err(_) => {
					return Ok(GitPullResponse {
						commits_count: 0,
						warning: Some("Remote branch does not exist yet".to_string()),
					});
				}
			};

			// Check last synced SHA
			let last_synced_ref = format!("refs/solo/last-github-integ/{}", branch);
			let last_synced_oid = repo.refname_to_id(&last_synced_ref).ok();

			// If already synced and not force reset, skip
			if !force_reset {
				if let Some(last_oid) = last_synced_oid {
					if last_oid == remote_oid {
						return Ok(GitPullResponse {
							commits_count: 0,
							warning: None,
						});
					}
				}
			}

			// Count new commits
			let commits_count = if let Some(last_oid) = last_synced_oid {
				let mut count = 0u32;
				if let Ok(mut revwalk) = repo.revwalk() {
					let _ = revwalk.push(remote_oid);
					let _ = revwalk.hide(last_oid);
					count = revwalk.count() as u32;
				}
				if count == 0 && !force_reset {
					return Ok(GitPullResponse {
						commits_count: 0,
						warning: None,
					});
				}
				count.max(1)
			} else {
				1
			};

			// Stash uncommitted changes
			emit_git_progress(&app, "pull", "Stashing local changes...");
			let mut had_stash = false;
			let sig = repo
				.signature()
				.or_else(|_| Signature::now("Solo User", "solo@local"))
				.map_err(|e| format!("Failed to create signature: {}", e))?;

			// Check for changes — scope the borrow so `statuses` is dropped before stash_save
			let has_changes = {
				let statuses = repo
					.statuses(Some(StatusOptions::new().include_untracked(true)))
					.map_err(|e| format!("Failed to get status: {}", e))?;
				statuses.iter().any(|entry| {
					let s = entry.status();
					!s.is_empty() && !s.contains(git2::Status::IGNORED)
				})
			};

			if has_changes {
				match repo.stash_save(&sig, "Auto-stash before pull", Some(git2::StashFlags::INCLUDE_UNTRACKED)) {
					Ok(_) => {
						had_stash = true;
					}
					Err(e) => {
						return Err(format!(
							"Failed to stash local changes: {}. Aborting to prevent data loss.",
							e
						));
					}
				}
			}

			// Reset to remote
			emit_git_progress(&app, "pull", "Applying changes...");
			{
				let remote_obj = repo
					.find_object(remote_oid, None)
					.map_err(|e| format!("Failed to find remote object: {}", e))?;

				if let Err(e) = repo.reset(&remote_obj, ResetType::Hard, None) {
					// Try to restore stash (remote_obj dropped at block end)
					drop(remote_obj);
					if had_stash {
						let _ = repo.stash_pop(0, None);
					}
					return Err(format!("Failed to reset: {}", e));
				}
			}

			// Record synced SHA
			let _ = repo.reference(&last_synced_ref, remote_oid, true, "record sync point");

			// Re-apply stash
			let mut warning = None;
			if had_stash {
				if repo.stash_pop(0, None).is_err() {
					warning = Some(
						"Pulled latest changes, but failed to re-apply your stashed local changes (possible conflict). Your changes remain in git stash.".to_string()
					);
				}
			}

			emit_git_progress(&app, "pull", "Pull complete");
			Ok(GitPullResponse {
				commits_count,
				warning,
			})
		})();

		// Always restore unauthenticated URL
		let _ = upsert_remote(&repo, "github-integ", &github_repo_url);

		emit_git_changes_updated(&app);
		result
	})
	.await
	.map_err(|e| format!("Task join error: {}", e))?
}

/// Get the current HEAD commit SHA
#[tauri::command]
pub async fn git_get_current_sha(
    fs_state: State<'_, crate::fs_commands::FsState>,
) -> Result<String, String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        let head = repo
            .head()
            .map_err(|e| format!("Failed to get HEAD: {}", e))?;

        head.target()
            .map(|oid| oid.to_string())
            .ok_or_else(|| "HEAD has no target".to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Get list of changed files with insertion/deletion stats
///
/// Three scenarios:
/// 1. GitHub remote + branch exists → compare working tree against remote
/// 2. GitHub remote + no branch → show all files as 'added'
/// 3. No remote → show uncommitted changes via status
#[tauri::command]
pub async fn git_get_changes(
    fs_state: State<'_, crate::fs_commands::FsState>,
    branch: Option<String>,
) -> Result<GitChangesResponse, String> {
    let workspace_path = get_workspace_path(&fs_state).await?;
    let branch = branch.unwrap_or_else(|| "main".to_string());

    tokio::task::spawn_blocking(move || {
        let repo = ensure_local_repo_scope(&workspace_path)?;

        let mut files_map: HashMap<String, GitChangedFile> = HashMap::new();

        let (has_remote, has_branch) = get_github_integ_info(&repo, &branch);

        if has_remote && has_branch {
            // SCENARIO 1: Compare working tree against github-integ/branch
            let remote_ref = format!("refs/remotes/github-integ/{}", branch);
            if let Ok(remote_oid) = repo.refname_to_id(&remote_ref) {
                if let Ok(remote_commit) = repo.find_commit(remote_oid) {
                    if let Ok(remote_tree) = remote_commit.tree() {
                        // Diff remote tree against working directory
                        let mut diff_opts = DiffOptions::new();
                        diff_opts.include_untracked(true);

                        if let Ok(diff) = repo.diff_tree_to_workdir_with_index(
                            Some(&remote_tree),
                            Some(&mut diff_opts),
                        ) {
                            for delta_idx in 0..diff.deltas().count() {
                                if let Some(delta) = diff.deltas().nth(delta_idx) {
                                    let file_path = delta
                                        .new_file()
                                        .path()
                                        .or_else(|| delta.old_file().path())
                                        .and_then(|p| p.to_str())
                                        .unwrap_or("")
                                        .to_string();

                                    if file_path.is_empty() {
                                        continue;
                                    }

                                    let status = match delta.status() {
                                        Delta::Added | Delta::Untracked => GitFileStatus::Added,
                                        Delta::Deleted => GitFileStatus::Deleted,
                                        Delta::Renamed => GitFileStatus::Renamed,
                                        _ => GitFileStatus::Modified,
                                    };

                                    files_map
                                        .entry(file_path.clone())
                                        .or_insert(GitChangedFile {
                                            path: file_path,
                                            status,
                                            insertions: 0,
                                            deletions: 0,
                                            is_staged: false,
                                        });
                                }
                            }

                            // Get line stats
                            let _ = diff.foreach(
                                &mut |_delta, _progress| true,
                                None,
                                Some(&mut |_delta, _hunk| true),
                                Some(&mut |delta, _hunk, line| {
                                    if let Some(path) = delta
                                        .new_file()
                                        .path()
                                        .or_else(|| delta.old_file().path())
                                        .and_then(|p| p.to_str())
                                    {
                                        if let Some(file) = files_map.get_mut(path) {
                                            match line.origin() {
                                                '+' => file.insertions += 1,
                                                '-' => file.deletions += 1,
                                                _ => {}
                                            }
                                        }
                                    }
                                    true
                                }),
                            );
                        }
                    }
                }
            }
        } else if has_remote && !has_branch {
            // SCENARIO 2: Show all tracked + untracked as 'added'
            let statuses = repo
                .statuses(Some(StatusOptions::new().include_untracked(true)))
                .map_err(|e| format!("Failed to get status: {}", e))?;

            for entry in statuses.iter() {
                let s = entry.status();
                if s.contains(git2::Status::IGNORED) {
                    continue;
                }
                if let Some(path) = entry.path() {
                    files_map.entry(path.to_string()).or_insert(GitChangedFile {
                        path: path.to_string(),
                        status: GitFileStatus::Added,
                        insertions: 0,
                        deletions: 0,
                        is_staged: false,
                    });
                }
            }

            // Also add files from index
            if let Ok(index) = repo.index() {
                for entry in index.iter() {
                    let path = String::from_utf8_lossy(&entry.path).to_string();
                    files_map.entry(path.clone()).or_insert(GitChangedFile {
                        path,
                        status: GitFileStatus::Added,
                        insertions: 0,
                        deletions: 0,
                        is_staged: false,
                    });
                }
            }
        } else {
            // SCENARIO 3: No remote — show git status
            let statuses = repo
                .statuses(Some(
                    StatusOptions::new()
                        .include_untracked(true)
                        .recurse_untracked_dirs(true),
                ))
                .map_err(|e| format!("Failed to get status: {}", e))?;

            for entry in statuses.iter() {
                if let Some(path) = entry.path() {
                    let s = entry.status();
                    if s.contains(git2::Status::IGNORED) {
                        continue;
                    }
                    let status = if s.contains(git2::Status::WT_NEW)
                        || s.contains(git2::Status::INDEX_NEW)
                    {
                        GitFileStatus::Added
                    } else if s.contains(git2::Status::WT_DELETED)
                        || s.contains(git2::Status::INDEX_DELETED)
                    {
                        GitFileStatus::Deleted
                    } else if s.contains(git2::Status::INDEX_RENAMED)
                        || s.contains(git2::Status::WT_RENAMED)
                    {
                        GitFileStatus::Renamed
                    } else {
                        GitFileStatus::Modified
                    };

                    files_map.entry(path.to_string()).or_insert(GitChangedFile {
                        path: path.to_string(),
                        status,
                        insertions: 0,
                        deletions: 0,
                        is_staged: false,
                    });
                }
            }

            // Get line stats from HEAD diff
            if let Ok(head) = repo.head() {
                if let Ok(head_commit) = head.peel_to_commit() {
                    if let Ok(head_tree) = head_commit.tree() {
                        if let Ok(diff) =
                            repo.diff_tree_to_workdir_with_index(Some(&head_tree), None)
                        {
                            let _ = diff.foreach(
                                &mut |_delta, _progress| true,
                                None,
                                Some(&mut |_delta, _hunk| true),
                                Some(&mut |delta, _hunk, line| {
                                    if let Some(path) = delta
                                        .new_file()
                                        .path()
                                        .or_else(|| delta.old_file().path())
                                        .and_then(|p| p.to_str())
                                    {
                                        if let Some(file) = files_map.get_mut(path) {
                                            match line.origin() {
                                                '+' => file.insertions += 1,
                                                '-' => file.deletions += 1,
                                                _ => {}
                                            }
                                        }
                                    }
                                    true
                                }),
                            );
                        }
                    }
                }
            }
        }

        // Detect staging state from git index
        let statuses = repo
            .statuses(Some(
                StatusOptions::new()
                    .include_untracked(true)
                    .recurse_untracked_dirs(true),
            ))
            .ok();

        if let Some(ref statuses) = statuses {
            for entry in statuses.iter() {
                if let Some(path) = entry.path() {
                    let s = entry.status();
                    let is_staged = s.intersects(
                        git2::Status::INDEX_NEW
                            | git2::Status::INDEX_MODIFIED
                            | git2::Status::INDEX_DELETED
                            | git2::Status::INDEX_RENAMED,
                    );
                    if let Some(file) = files_map.get_mut(path) {
                        file.is_staged = is_staged;
                    }
                }
            }
        }

        let mut files: Vec<GitChangedFile> = files_map.into_values().collect();
        files.sort_by(|a, b| a.path.cmp(&b.path));

        let summary = GitChangesSummary {
            insertions: files.iter().map(|f| f.insertions).sum(),
            deletions: files.iter().map(|f| f.deletions).sum(),
        };

        Ok(GitChangesResponse { files, summary })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Get old and new content for a file diff
#[tauri::command]
pub async fn git_get_file_diff(
    fs_state: State<'_, crate::fs_commands::FsState>,
    file_path: String,
    branch: Option<String>,
) -> Result<GitFileDiffResponse, String> {
    let workspace_path = get_workspace_path(&fs_state).await?;
    let branch = branch.unwrap_or_else(|| "main".to_string());

    tokio::task::spawn_blocking(move || {
        let repo = ensure_local_repo_scope(&workspace_path)?;

        let (has_remote, has_branch) = get_github_integ_info(&repo, &branch);
        let base_ref = if has_remote && has_branch {
            format!("github-integ/{}", branch)
        } else {
            "HEAD".to_string()
        };

        // Read current file content
        let full_path = workspace_path.join(&file_path);
        let new_content = if full_path.exists() {
            std::fs::read_to_string(&full_path).unwrap_or_default()
        } else {
            String::new()
        };

        // Check if file is untracked/new
        if let Ok(statuses) = repo.statuses(None) {
            for entry in statuses.iter() {
                if entry.path() == Some(&file_path) {
                    let s = entry.status();
                    if s.contains(git2::Status::WT_NEW) || s.contains(git2::Status::INDEX_NEW) {
                        return Ok(GitFileDiffResponse {
                            old_content: String::new(),
                            new_content,
                        });
                    }
                }
            }
        }

        // Try to get old content from base ref
        let old_content = get_blob_content(&repo, &base_ref, &file_path)
            .or_else(|| {
                if base_ref != "HEAD" {
                    get_blob_content(&repo, "HEAD", &file_path)
                } else {
                    None
                }
            })
            .unwrap_or_default();

        Ok(GitFileDiffResponse {
            old_content,
            new_content,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Get blob content from a tree spec like "HEAD:path/to/file"
fn get_blob_content(repo: &Repository, treeish: &str, file_path: &str) -> Option<String> {
    let spec = format!("{}:{}", treeish, file_path);
    let obj = repo.revparse_single(&spec).ok()?;
    let blob = obj.peel_to_blob().ok()?;
    String::from_utf8(blob.content().to_vec()).ok()
}

/// Discard changes for a specific file
#[tauri::command]
pub async fn git_discard_file(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    file_path: String,
    branch: Option<String>,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;
    let branch = branch.unwrap_or_else(|| "main".to_string());

    tokio::task::spawn_blocking(move || {
        let repo = ensure_local_repo_scope(&workspace_path)?;

        let full_path = workspace_path.join(&file_path);
        let (has_remote, has_branch) = get_github_integ_info(&repo, &branch);

        // Check if file is untracked
        if let Ok(statuses) = repo.statuses(None) {
            for entry in statuses.iter() {
                if entry.path() == Some(file_path.as_str()) {
                    let s = entry.status();
                    if s.contains(git2::Status::WT_NEW) {
                        // Untracked file — delete it
                        if full_path.exists() {
                            std::fs::remove_file(&full_path)
                                .map_err(|e| format!("Failed to delete file: {}", e))?;
                        }
                        emit_git_changes_updated(&app);
                        return Ok(());
                    }
                }
            }
        }

        // Try to restore from github-integ or HEAD
        let base_ref = if has_remote && has_branch {
            format!("github-integ/{}", branch)
        } else {
            "HEAD".to_string()
        };

        if let Some(content) = get_blob_content(&repo, &base_ref, &file_path) {
            std::fs::write(&full_path, content)
                .map_err(|e| format!("Failed to write file: {}", e))?;

            // Reset index entry
            let mut index = repo
                .index()
                .map_err(|e| format!("Failed to get index: {}", e))?;
            let _ = index.add_path(Path::new(&file_path));
            let _ = index.write();

            emit_git_changes_updated(&app);
            return Ok(());
        }

        // Try HEAD as fallback
        if base_ref != "HEAD" {
            if let Some(content) = get_blob_content(&repo, "HEAD", &file_path) {
                std::fs::write(&full_path, content)
                    .map_err(|e| format!("Failed to write file: {}", e))?;
                emit_git_changes_updated(&app);
                return Ok(());
            }
        }

        // For deleted files — try to restore
        if !full_path.exists() {
            let restore_ref = if has_remote && has_branch {
                format!("github-integ/{}", branch)
            } else {
                "HEAD".to_string()
            };

            if let Some(content) = get_blob_content(&repo, &restore_ref, &file_path) {
                // Ensure parent directory exists
                if let Some(parent) = full_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::write(&full_path, content)
                    .map_err(|e| format!("Failed to restore file: {}", e))?;
                emit_git_changes_updated(&app);
                return Ok(());
            }

            return Err(format!(
                "Cannot restore file {}: not found in git history",
                file_path
            ));
        }

        emit_git_changes_updated(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Discard all changes
#[tauri::command]
pub async fn git_discard_all(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    branch: Option<String>,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;
    let branch = branch.unwrap_or_else(|| "main".to_string());

    tokio::task::spawn_blocking(move || {
        let repo = ensure_local_repo_scope(&workspace_path)?;

        let (has_remote, has_branch) = get_github_integ_info(&repo, &branch);

        if has_remote && has_branch {
            // Reset to github-integ version
            let remote_ref = format!("refs/remotes/github-integ/{}", branch);
            if let Ok(remote_oid) = repo.refname_to_id(&remote_ref) {
                if let Ok(obj) = repo.find_object(remote_oid, None) {
                    repo.reset(&obj, ResetType::Hard, None)
                        .map_err(|e| format!("Failed to reset: {}", e))?;

                    // Clean untracked files
                    clean_untracked(&workspace_path, &repo);

                    emit_git_changes_updated(&app);
                    return Ok(());
                }
            }
        }

        // Fallback: reset to HEAD
        if let Ok(head) = repo.head() {
            if let Some(oid) = head.target() {
                if let Ok(obj) = repo.find_object(oid, None) {
                    let _ = repo.reset(&obj, ResetType::Hard, None);
                }
            }
        }

        // Clean untracked
        clean_untracked(&workspace_path, &repo);

        emit_git_changes_updated(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Remove untracked files from the working directory
fn clean_untracked(workspace_path: &Path, repo: &Repository) {
    if let Ok(statuses) = repo.statuses(Some(StatusOptions::new().include_untracked(true))) {
        for entry in statuses.iter() {
            let s = entry.status();
            if s.contains(git2::Status::WT_NEW) {
                if let Some(path) = entry.path() {
                    let full_path = workspace_path.join(path);
                    if full_path.is_dir() {
                        let _ = std::fs::remove_dir_all(&full_path);
                    } else {
                        let _ = std::fs::remove_file(&full_path);
                    }
                }
            }
        }
    }
}

/// Clean up stale git lock files
#[tauri::command]
pub async fn git_cleanup_locks(
    fs_state: State<'_, crate::fs_commands::FsState>,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        cleanup_git_locks(&workspace_path);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Stage a file (git add)
#[tauri::command]
pub async fn git_stage_file(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    file_path: String,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        let mut index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {}", e))?;

        let full_path = workspace_path.join(&file_path);
        if full_path.exists() {
            index
                .add_path(Path::new(&file_path))
                .map_err(|e| format!("Failed to stage file: {}", e))?;
        } else {
            // File was deleted — remove from index
            index
                .remove_path(Path::new(&file_path))
                .map_err(|e| format!("Failed to stage deleted file: {}", e))?;
        }

        index
            .write()
            .map_err(|e| format!("Failed to write index: {}", e))?;

        emit_git_changes_updated(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Unstage a file (git reset HEAD -- file)
#[tauri::command]
pub async fn git_unstage_file(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    file_path: String,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        // Try to reset from HEAD; if no HEAD (fresh repo), remove from index
        let head_result = repo.head();
        let mut index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {}", e))?;

        if let Ok(head) = head_result {
            if let Ok(commit) = head.peel_to_commit() {
                if let Ok(tree) = commit.tree() {
                    // Check if file exists in HEAD
                    if let Ok(entry) = tree.get_path(Path::new(&file_path)) {
                        // Restore the index entry from HEAD
                        let obj = entry
                            .to_object(&repo)
                            .map_err(|e| format!("Failed to get object: {}", e))?;
                        let blob = obj
                            .peel_to_blob()
                            .map_err(|e| format!("Failed to get blob: {}", e))?;

                        let idx_entry = git2::IndexEntry {
                            ctime: git2::IndexTime::new(0, 0),
                            mtime: git2::IndexTime::new(0, 0),
                            dev: 0,
                            ino: 0,
                            mode: entry.filemode() as u32,
                            uid: 0,
                            gid: 0,
                            file_size: blob.size() as u32,
                            id: blob.id(),
                            flags: 0,
                            flags_extended: 0,
                            path: file_path.as_bytes().to_vec(),
                        };
                        index
                            .add(&idx_entry)
                            .map_err(|e| format!("Failed to restore index entry: {}", e))?;
                    } else {
                        // File doesn't exist in HEAD — remove from index
                        index
                            .remove_path(Path::new(&file_path))
                            .map_err(|e| format!("Failed to remove from index: {}", e))?;
                    }
                }
            }
        } else {
            // No HEAD (fresh repo) — just remove from index
            index
                .remove_path(Path::new(&file_path))
                .map_err(|e| format!("Failed to remove from index: {}", e))?;
        }

        index
            .write()
            .map_err(|e| format!("Failed to write index: {}", e))?;

        emit_git_changes_updated(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Stage all files (git add .)
#[tauri::command]
pub async fn git_stage_all(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        let mut index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {}", e))?;
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .map_err(|e| format!("Failed to stage all files: {}", e))?;

        // Also handle deleted files
        let statuses = repo
            .statuses(Some(StatusOptions::new().include_untracked(false)))
            .map_err(|e| format!("Failed to get status: {}", e))?;
        for entry in statuses.iter() {
            let s = entry.status();
            if s.contains(git2::Status::WT_DELETED) {
                if let Some(path) = entry.path() {
                    let _ = index.remove_path(Path::new(path));
                }
            }
        }

        index
            .write()
            .map_err(|e| format!("Failed to write index: {}", e))?;

        emit_git_changes_updated(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Commit staged changes locally (no push)
#[tauri::command]
pub async fn git_commit(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    commit_message: String,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        cleanup_git_locks(&workspace_path);

        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        let mut index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {}", e))?;

        // Check for staged changes
        let statuses = repo
            .statuses(Some(StatusOptions::new().include_untracked(false)))
            .map_err(|e| format!("Failed to get status: {}", e))?;

        let has_staged = statuses.iter().any(|entry| {
            entry.status().intersects(
                git2::Status::INDEX_NEW
                    | git2::Status::INDEX_MODIFIED
                    | git2::Status::INDEX_DELETED
                    | git2::Status::INDEX_RENAMED,
            )
        });

        if !has_staged {
            return Err("No staged changes to commit".to_string());
        }

        let sig = repo
            .signature()
            .or_else(|_| Signature::now("Solo User", "solo@local"))
            .map_err(|e| format!("Failed to create signature: {}", e))?;

        let tree_oid = index
            .write_tree()
            .map_err(|e| format!("Failed to write tree: {}", e))?;
        let tree = repo
            .find_tree(tree_oid)
            .map_err(|e| format!("Failed to find tree: {}", e))?;

        if let Ok(head) = repo.head() {
            let parent = head
                .peel_to_commit()
                .map_err(|e| format!("Failed to peel HEAD: {}", e))?;
            repo.commit(Some("HEAD"), &sig, &sig, &commit_message, &tree, &[&parent])
                .map_err(|e| format!("Failed to commit: {}", e))?;
        } else {
            // Fresh repo — no parent
            repo.commit(Some("HEAD"), &sig, &sig, &commit_message, &tree, &[])
                .map_err(|e| format!("Failed to create initial commit: {}", e))?;
        }

        emit_git_changes_updated(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Unstage all files (git reset HEAD)
#[tauri::command]
pub async fn git_unstage_all(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        if let Ok(head) = repo.head() {
            if let Ok(obj) = head.peel(git2::ObjectType::Commit) {
                repo.reset(&obj, ResetType::Mixed, None)
                    .map_err(|e| format!("Failed to unstage all: {}", e))?;
            }
        } else {
            // No HEAD — clear the index entirely
            let mut index = repo
                .index()
                .map_err(|e| format!("Failed to get index: {}", e))?;
            index
                .clear()
                .map_err(|e| format!("Failed to clear index: {}", e))?;
            index
                .write()
                .map_err(|e| format!("Failed to write index: {}", e))?;
        }

        emit_git_changes_updated(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Clone a git repository to a target path using system git.
/// If access_token is provided, it is injected into HTTPS URLs for private repo access.
#[tauri::command]
pub async fn git_clone(
    app: AppHandle,
    repository_url: String,
    target_path: String,
    access_token: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        emit_git_progress(&app, "clone", "Cloning repository...");

        // Inject token into HTTPS URL for authenticated clones
        let clone_url = match &access_token {
            Some(token) if repository_url.starts_with("https://") => {
                repository_url.replace("https://", &format!("https://x-access-token:{}@", token))
            }
            _ => repository_url,
        };

        let output = std::process::Command::new("git")
            .args(["clone", "--progress", &clone_url, &target_path])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .map_err(|e| format!("Failed to run git clone: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git clone failed: {}", stderr.trim()));
        }

        emit_git_progress(&app, "clone", "Clone complete");
        Ok(target_path)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Create a new local branch and check it out
#[tauri::command]
pub async fn git_create_branch(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    branch_name: String,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        cleanup_git_locks(&workspace_path);

        // Validate branch name
        let name = branch_name.trim();
        if name.is_empty() {
            return Err("Branch name cannot be empty".to_string());
        }
        if name.contains(' ')
            || name.contains("..")
            || name.contains('~')
            || name.contains('^')
            || name.contains(':')
            || name.contains('\\')
            || name.starts_with('-')
            || name.ends_with('/')
            || name.ends_with(".lock")
            || name.contains('\x00')
        {
            return Err(format!("Invalid branch name: '{}'", name));
        }

        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        // Get HEAD commit
        let head = repo
            .head()
            .map_err(|e| format!("Failed to get HEAD: {}", e))?;
        let commit = head
            .peel_to_commit()
            .map_err(|e| format!("Failed to peel HEAD to commit: {}", e))?;

        // Create branch (fails if it already exists)
        repo.branch(name, &commit, false)
            .map_err(|e| format!("Failed to create branch '{}': {}", name, e))?;

        // Checkout the new branch
        let refname = format!("refs/heads/{}", name);
        repo.set_head(&refname)
            .map_err(|e| format!("Failed to set HEAD to '{}': {}", name, e))?;

        let obj = commit.as_object();
        repo.checkout_tree(obj, None)
            .map_err(|e| format!("Failed to checkout '{}': {}", name, e))?;

        emit_git_changes_updated(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// =============================================================================
// Fetch, Branch, Merge, Stash Commands
// =============================================================================

/// Fetch from remote (update tracking refs)
#[tauri::command]
pub async fn git_fetch(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    access_token: String,
    github_repo_url: String,
    branch: String,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        emit_git_progress(&app, "fetch", "Fetching...");
        cleanup_git_locks(&workspace_path);

        let repo = ensure_local_repo_scope(&workspace_path)?;

        let remote_url = if is_ssh_url(&github_repo_url) {
            github_repo_url.clone()
        } else {
            github_repo_url.replace("https://", &format!("https://{}@", access_token))
        };
        upsert_remote(&repo, "github-integ", &remote_url)?;

        let result = (|| -> Result<(), String> {
            let mut remote = repo
                .find_remote("github-integ")
                .map_err(|e| format!("Failed to find remote: {}", e))?;
            let mut fetch_opts = make_fetch_options(&access_token);
            remote
                .fetch(&[&branch], Some(&mut fetch_opts), None)
                .map_err(|e| format!("Failed to fetch: {}", e))?;

            emit_git_progress(&app, "fetch", "Fetch complete");
            Ok(())
        })();

        let _ = upsert_remote(&repo, "github-integ", &github_repo_url);
        result
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// List local branches with ahead/behind counts
#[tauri::command]
pub async fn git_list_branches(
    fs_state: State<'_, crate::fs_commands::FsState>,
) -> Result<Vec<BranchInfo>, String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        let head_ref = repo.head().ok();
        let head_name = head_ref.as_ref().and_then(|h| h.shorthand().map(String::from));

        let mut branches = Vec::new();
        for branch_result in repo
            .branches(Some(git2::BranchType::Local))
            .map_err(|e| format!("Failed to list branches: {}", e))?
        {
            let (branch, _) = branch_result.map_err(|e| format!("Branch error: {}", e))?;
            let name = branch
                .name()
                .map_err(|e| format!("Invalid branch name: {}", e))?
                .unwrap_or("")
                .to_string();

            if name.is_empty() {
                continue;
            }

            let is_head = head_name.as_deref() == Some(&name);

            let upstream = branch
                .upstream()
                .ok()
                .and_then(|u| u.name().ok().flatten().map(String::from));

            let (ahead, behind) = if let Some(ref _ups) = upstream {
                if let (Ok(local_oid), Ok(upstream_branch)) = (
                    repo.refname_to_id(&format!("refs/heads/{}", name)),
                    branch.upstream(),
                ) {
                    if let Some(upstream_oid) = upstream_branch.get().target() {
                        repo.graph_ahead_behind(local_oid, upstream_oid)
                            .map(|(a, b)| (a as u32, b as u32))
                            .unwrap_or((0, 0))
                    } else {
                        (0, 0)
                    }
                } else {
                    (0, 0)
                }
            } else {
                // Try github-integ remote tracking
                let remote_ref = format!("refs/remotes/github-integ/{}", name);
                if let (Ok(local_oid), Ok(remote_oid)) = (
                    repo.refname_to_id(&format!("refs/heads/{}", name)),
                    repo.refname_to_id(&remote_ref),
                ) {
                    repo.graph_ahead_behind(local_oid, remote_oid)
                        .map(|(a, b)| (a as u32, b as u32))
                        .unwrap_or((0, 0))
                } else {
                    (0, 0)
                }
            };

            branches.push(BranchInfo {
                name,
                is_head,
                upstream,
                ahead,
                behind,
            });
        }

        // Sort: current branch first, then alphabetical
        branches.sort_by(|a, b| {
            b.is_head.cmp(&a.is_head).then_with(|| a.name.cmp(&b.name))
        });

        Ok(branches)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Switch to an existing branch
#[tauri::command]
pub async fn git_checkout_branch(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    branch_name: String,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        cleanup_git_locks(&workspace_path);

        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        let refname = format!("refs/heads/{}", branch_name);
        repo.set_head(&refname)
            .map_err(|e| format!("Failed to set HEAD to '{}': {}", branch_name, e))?;

        repo.checkout_head(Some(&mut CheckoutBuilder::new().safe()))
            .map_err(|e| format!("Checkout failed (dirty files may conflict): {}", e))?;

        emit_git_changes_updated(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Delete a local branch
#[tauri::command]
pub async fn git_delete_branch(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    branch_name: String,
    force: bool,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        // Cannot delete current branch
        if let Ok(head) = repo.head() {
            if head.shorthand() == Some(&branch_name) {
                return Err("Cannot delete the currently checked-out branch".to_string());
            }
        }

        let mut branch = repo
            .find_branch(&branch_name, git2::BranchType::Local)
            .map_err(|e| format!("Branch '{}' not found: {}", branch_name, e))?;

        if !force && !branch.is_head() {
            // Check if merged into HEAD
            if let (Ok(branch_oid), Ok(head_ref)) =
                (repo.refname_to_id(&format!("refs/heads/{}", branch_name)), repo.head())
            {
                if let Some(head_oid) = head_ref.target() {
                    if let Ok((_, behind)) = repo.graph_ahead_behind(branch_oid, head_oid) {
                        if behind > 0 {
                            // branch has commits not in HEAD
                        }
                    }
                }
            }
        }

        branch
            .delete()
            .map_err(|e| format!("Failed to delete branch: {}", e))?;

        emit_git_changes_updated(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Merge a source branch into the current HEAD
#[tauri::command]
pub async fn git_merge(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    source_branch: String,
) -> Result<GitMergeResult, String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        cleanup_git_locks(&workspace_path);

        let repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        let source_oid = repo
            .refname_to_id(&format!("refs/heads/{}", source_branch))
            .map_err(|e| format!("Branch '{}' not found: {}", source_branch, e))?;

        let annotated = repo
            .find_annotated_commit(source_oid)
            .map_err(|e| format!("Failed to find commit: {}", e))?;

        let (analysis, _preference) = repo
            .merge_analysis(&[&annotated])
            .map_err(|e| format!("Merge analysis failed: {}", e))?;

        if analysis.is_up_to_date() {
            return Ok(GitMergeResult {
                fast_forward: false,
                conflicts: vec![],
                committed: false,
            });
        }

        if analysis.is_fast_forward() {
            let source_commit = repo
                .find_commit(source_oid)
                .map_err(|e| format!("Failed to find commit: {}", e))?;
            let source_obj = source_commit.as_object();

            repo.checkout_tree(source_obj, Some(&mut CheckoutBuilder::new().safe()))
                .map_err(|e| format!("Fast-forward checkout failed: {}", e))?;

            let head = repo
                .head()
                .map_err(|e| format!("Failed to get HEAD: {}", e))?;
            let refname = head
                .name()
                .ok_or("HEAD is not a symbolic reference")?;
            repo.reference(refname, source_oid, true, &format!("fast-forward merge {}", source_branch))
                .map_err(|e| format!("Failed to update ref: {}", e))?;

            emit_git_changes_updated(&app);
            return Ok(GitMergeResult {
                fast_forward: true,
                conflicts: vec![],
                committed: true,
            });
        }

        // Normal merge
        repo.merge(&[&annotated], Some(&mut MergeOptions::new()), Some(&mut CheckoutBuilder::new().safe()))
            .map_err(|e| format!("Merge failed: {}", e))?;

        let index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {}", e))?;

        if index.has_conflicts() {
            let conflicts: Vec<String> = index
                .conflicts()
                .map_err(|e| format!("Failed to read conflicts: {}", e))?
                .filter_map(|c| c.ok())
                .filter_map(|c| {
                    c.our
                        .map(|e| String::from_utf8_lossy(&e.path).to_string())
                })
                .collect();

            return Ok(GitMergeResult {
                fast_forward: false,
                conflicts,
                committed: false,
            });
        }

        // Auto-commit the merge
        let mut index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {}", e))?;
        let tree_oid = index
            .write_tree()
            .map_err(|e| format!("Failed to write tree: {}", e))?;
        let tree = repo
            .find_tree(tree_oid)
            .map_err(|e| format!("Failed to find tree: {}", e))?;

        let sig = repo
            .signature()
            .or_else(|_| Signature::now("Solo User", "solo@local"))
            .map_err(|e| format!("Failed to create signature: {}", e))?;

        let head_commit = repo
            .head()
            .map_err(|e| format!("Failed to get HEAD: {}", e))?
            .peel_to_commit()
            .map_err(|e| format!("Failed to peel HEAD: {}", e))?;
        let source_commit = repo
            .find_commit(source_oid)
            .map_err(|e| format!("Failed to find source commit: {}", e))?;

        let msg = format!("Merge branch '{}' into HEAD", source_branch);
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &msg,
            &tree,
            &[&head_commit, &source_commit],
        )
        .map_err(|e| format!("Failed to create merge commit: {}", e))?;

        // Clean up merge state
        let _ = repo.cleanup_state();

        emit_git_changes_updated(&app);
        Ok(GitMergeResult {
            fast_forward: false,
            conflicts: vec![],
            committed: true,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Stash uncommitted changes
#[tauri::command]
pub async fn git_stash(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
    message: Option<String>,
    include_untracked: bool,
) -> Result<(), String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        let mut repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        let sig = repo
            .signature()
            .or_else(|_| Signature::now("Solo User", "solo@local"))
            .map_err(|e| format!("Failed to create signature: {}", e))?;

        let msg = message.as_deref().unwrap_or("Stash from Solo IDE");
        let flags = if include_untracked {
            Some(git2::StashFlags::INCLUDE_UNTRACKED)
        } else {
            None
        };

        repo.stash_save(&sig, msg, flags)
            .map_err(|e| format!("Failed to stash: {}", e))?;

        emit_git_changes_updated(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Pop the most recent stash
#[tauri::command]
pub async fn git_stash_pop(
    fs_state: State<'_, crate::fs_commands::FsState>,
    app: AppHandle,
) -> Result<GitStashPopResult, String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        let mut repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        match repo.stash_pop(0, None) {
            Ok(_) => {
                emit_git_changes_updated(&app);
                Ok(GitStashPopResult {
                    had_conflicts: false,
                    conflict_files: vec![],
                })
            }
            Err(e) => {
                // Check if there are conflicts in the index
                if let Ok(index) = repo.index() {
                    if index.has_conflicts() {
                        let conflicts: Vec<String> = index
                            .conflicts()
                            .ok()
                            .map(|iter| {
                                iter.filter_map(|c| c.ok())
                                    .filter_map(|c| {
                                        c.our.map(|e| String::from_utf8_lossy(&e.path).to_string())
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();

                        emit_git_changes_updated(&app);
                        return Ok(GitStashPopResult {
                            had_conflicts: true,
                            conflict_files: conflicts,
                        });
                    }
                }
                Err(format!("Failed to pop stash: {}", e))
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// List stash entries
#[tauri::command]
pub async fn git_stash_list(
    fs_state: State<'_, crate::fs_commands::FsState>,
) -> Result<Vec<StashEntry>, String> {
    let workspace_path = get_workspace_path(&fs_state).await?;

    tokio::task::spawn_blocking(move || {
        let mut repo =
            Repository::open(&workspace_path).map_err(|e| format!("Failed to open repo: {}", e))?;

        let mut entries = Vec::new();
        repo.stash_foreach(|index, message, _oid| {
            entries.push(StashEntry {
                index: index as u32,
                message: message.to_string(),
            });
            true
        })
        .map_err(|e| format!("Failed to list stashes: {}", e))?;

        Ok(entries)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// =============================================================================
// GitHub OAuth Commands (direct GitHub token for git operations)
// =============================================================================

/// Start GitHub OAuth flow — returns auth URL to open in browser
#[tauri::command]
pub async fn github_start_auth(
    state: State<'_, crate::provider_commands::ProviderAuthState>,
) -> Result<solo_auth::OAuthFlowResult, String> {
    info!("Starting GitHub OAuth flow");

    let (result, oauth_state) =
        solo_auth::GitHubOAuthConfig::build_auth_url().map_err(|e| e.to_string())?;

    state
        .oauth_pending
        .write()
        .await
        .insert(oauth_state.state.clone(), oauth_state);

    Ok(result)
}

/// Complete GitHub OAuth — exchange code for token and store it
#[tauri::command]
pub async fn github_complete_auth(
    code: String,
    oauth_state: String,
    state: State<'_, crate::provider_commands::ProviderAuthState>,
) -> Result<(), String> {
    info!("Completing GitHub OAuth flow");

    let pending_state = state
        .oauth_pending
        .write()
        .await
        .remove(&oauth_state)
        .ok_or_else(|| "GitHub OAuth state not found or expired".to_string())?;

    if pending_state.is_expired() {
        return Err("GitHub OAuth state has expired".to_string());
    }

    let token = solo_auth::GitHubOAuthConfig::exchange_code(&code)
        .await
        .map_err(|e| e.to_string())?;

    state
        .credentials
        .set_github_oauth_token(token)
        .await
        .map_err(|e| e.to_string())?;

    info!("GitHub OAuth token stored successfully");
    Ok(())
}

/// Get the stored GitHub access token (or null if not connected)
#[tauri::command]
pub async fn github_get_token(
    state: State<'_, crate::provider_commands::ProviderAuthState>,
) -> Result<Option<String>, String> {
    state
        .credentials
        .get_github_access_token()
        .await
        .map_err(|e| e.to_string())
}

/// Disconnect GitHub — clear stored token
#[tauri::command]
pub async fn github_disconnect(
    state: State<'_, crate::provider_commands::ProviderAuthState>,
) -> Result<(), String> {
    info!("Disconnecting GitHub OAuth");
    state
        .credentials
        .clear_github_oauth_token()
        .await
        .map_err(|e| e.to_string())
}
