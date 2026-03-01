#![warn(clippy::all, clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::wildcard_imports,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::uninlined_format_args,
    clippy::doc_markdown,
    clippy::return_self_not_must_use,
    clippy::redundant_closure_for_method_calls,
    clippy::single_match_else,
    clippy::if_not_else,
    clippy::match_same_arms,
    clippy::map_unwrap_or,
    clippy::similar_names,
    clippy::struct_excessive_bools
)]

//! Solo Git — Git operations for Solo IDE
//!
//! Provides worktree management using `git2` (libgit2) for core operations
//! and CLI fallback for operations not supported by libgit2 (remove, move).

pub mod config;
pub mod error;

use config::{WorktreeConfig, WorktreeMetadata};
use error::GitError;
use solo_protocol::{CreateWorktreeRequest, WorktreeDiffEntry, WorktreeInfo};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, info, warn};

/// Sanitize a branch name for use as a filesystem-safe worktree ID component.
///
/// Replaces `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, spaces, and other
/// non-alphanumeric chars (except `-`, `_`, `.`) with `-`. Collapses consecutive
/// dashes, trims leading/trailing dashes and dots, and truncates to 60 chars.
fn sanitize_worktree_id(branch: &str) -> String {
    let sanitized: String = branch
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();

    // Collapse consecutive dashes
    let mut result = String::with_capacity(sanitized.len());
    let mut prev_dash = false;
    for c in sanitized.chars() {
        if c == '-' {
            if !prev_dash {
                result.push('-');
            }
            prev_dash = true;
        } else {
            result.push(c);
            prev_dash = false;
        }
    }

    let trimmed = result.trim_matches(&['-', '.'][..]);
    // Truncate to 60 chars to avoid path-length issues
    if trimmed.len() > 60 {
        trimmed[..60].trim_end_matches('-').to_string()
    } else {
        trimmed.to_string()
    }
}

/// Manages git worktrees for a repository.
///
/// Opens `git2::Repository` per-operation to avoid `!Send`/`!Sync` issues.
/// Worktrees are stored at `~/.solo/worktrees/{repo-name}-{hash}/{branch}-{short-uuid}/`.
/// Metadata is persisted in `~/.solo/worktrees/{repo-name}-{hash}/worktrees.json`.
pub struct WorktreeManager {
    repo_path: PathBuf,
    worktrees_dir: PathBuf,
    config_path: PathBuf,
    max_worktrees: u32,
}

impl WorktreeManager {
    /// Create a new WorktreeManager for a repository path.
    pub fn new(repo_path: &Path) -> Result<Self, GitError> {
        // Validate that the path is a git repo by opening it
        let repo = git2::Repository::open(repo_path)
            .map_err(|_| GitError::RepoNotFound(repo_path.display().to_string()))?;

        // Use the workdir or the repo path itself
        let actual_repo_path = repo
            .workdir()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| repo_path.to_path_buf());

        // Canonicalize once — git2 already resolved symlinks, but this
        // ensures macOS /tmp → /private/tmp is handled consistently
        let actual_repo_path = actual_repo_path
            .canonicalize()
            .unwrap_or(actual_repo_path);

        let worktrees_dir = config::worktrees_base_dir(&actual_repo_path)?;
        let config_path = worktrees_dir.join("worktrees.json");

        Ok(Self {
            repo_path: actual_repo_path,
            worktrees_dir,
            config_path,
            max_worktrees: 10,
        })
    }

    /// List all worktrees (main + linked).
    pub fn list(&self) -> Result<Vec<WorktreeInfo>, GitError> {
        let repo = git2::Repository::open(&self.repo_path)?;
        let config = WorktreeConfig::load(&self.config_path)?;
        let mut result = Vec::new();

        // Add main worktree
        if let Some(workdir) = repo.workdir() {
            let head_sha = repo
                .head()
                .ok()
                .and_then(|r| r.target())
                .map(|oid| oid.to_string())
                .unwrap_or_default();

            let branch = repo.head().ok().and_then(|r| {
                if r.is_branch() {
                    r.shorthand().map(|s| s.to_string())
                } else {
                    None
                }
            });

            let is_dirty = repo
                .statuses(None)
                .map(|s| s.iter().any(|e| e.status() != git2::Status::CURRENT))
                .unwrap_or(false);

            result.push(WorktreeInfo {
                id: "main".to_string(),
                path: workdir.display().to_string(),
                branch,
                head_sha,
                is_main: true,
                is_locked: false,
                lock_reason: None,
                is_dirty,
                agent_session_id: None,
                created_at: 0,
            });
        }

        // Add linked worktrees from git2
        let wt_names = repo.worktrees()?;
        for i in 0..wt_names.len() {
            if let Some(name) = wt_names.get(i) {
                if let Ok(wt) = repo.find_worktree(name) {
                    let wt_path = wt.path().to_path_buf();

                    // Open the worktree repo for HEAD info
                    let (head_sha, branch, is_dirty) =
                        if let Ok(wt_repo) = git2::Repository::open(&wt_path) {
                            let sha = wt_repo
                                .head()
                                .ok()
                                .and_then(|r| r.target())
                                .map(|oid| oid.to_string())
                                .unwrap_or_default();
                            let br = wt_repo.head().ok().and_then(|r| {
                                if r.is_branch() {
                                    r.shorthand().map(|s| s.to_string())
                                } else {
                                    None
                                }
                            });
                            let dirty = wt_repo
                                .statuses(None)
                                .map(|s| s.iter().any(|e| e.status() != git2::Status::CURRENT))
                                .unwrap_or(false);
                            (sha, br, dirty)
                        } else {
                            (String::new(), None, false)
                        };

                    // Merge metadata from config
                    let meta = config
                        .worktrees
                        .values()
                        .find(|m| m.path == wt_path.display().to_string());

                    let id = meta
                        .map(|m| m.id.clone())
                        .unwrap_or_else(|| name.to_string());
                    let is_locked = wt
                        .is_locked()
                        .map(|status| matches!(status, git2::WorktreeLockStatus::Locked(_)))
                        .unwrap_or(false);
                    let lock_reason = meta.and_then(|m| m.lock_reason.clone());
                    let agent_session_id = meta.and_then(|m| m.agent_session_id.clone());
                    let created_at = meta.map(|m| m.created_at).unwrap_or(0);

                    result.push(WorktreeInfo {
                        id,
                        path: wt_path.display().to_string(),
                        branch,
                        head_sha,
                        is_main: false,
                        is_locked,
                        lock_reason,
                        is_dirty,
                        agent_session_id,
                        created_at,
                    });
                }
            }
        }

        Ok(result)
    }

    /// Create a new worktree.
    pub fn create(&self, request: &CreateWorktreeRequest) -> Result<WorktreeInfo, GitError> {
        let config = WorktreeConfig::load(&self.config_path)?;
        if config.worktrees.len() as u32 >= self.max_worktrees {
            return Err(GitError::MaxWorktreesReached(self.max_worktrees));
        }

        let repo = git2::Repository::open(&self.repo_path)?;

        // Generate worktree ID and path (sanitize branch name for filesystem safety)
        let short_uuid = &uuid::Uuid::new_v4().to_string()[..8];
        let safe_branch = sanitize_worktree_id(&request.branch);
        let wt_id = format!("{}-{}", safe_branch, short_uuid);
        let wt_path = self.worktrees_dir.join(&wt_id);

        if wt_path.exists() {
            return Err(GitError::WorktreeAlreadyExists(wt_id));
        }

        info!(branch = %request.branch, path = %wt_path.display(), "Creating worktree");

        // Ensure parent directory exists
        std::fs::create_dir_all(&self.worktrees_dir)?;

        if request.create_branch {
            // Create a new branch from base (or HEAD)
            let base_ref = request.base.as_deref().unwrap_or("HEAD");
            let base_obj = repo.revparse_single(base_ref)?;
            let base_commit = base_obj.peel_to_commit()?;

            // Check if branch already exists
            if repo
                .find_branch(&request.branch, git2::BranchType::Local)
                .is_ok()
            {
                return Err(GitError::BranchAlreadyExists(request.branch.clone()));
            }

            let branch = repo.branch(&request.branch, &base_commit, false)?;
            let branch_ref = branch.into_reference();
            let ref_name = branch_ref
                .name()
                .ok_or_else(|| GitError::Config("Invalid branch reference name".to_string()))?;

            repo.worktree(
                &wt_id,
                &wt_path,
                Some(
                    git2::WorktreeAddOptions::new()
                        .reference(Some(&repo.find_reference(ref_name)?)),
                ),
            )?;
        } else {
            // Use existing branch
            let branch = repo
                .find_branch(&request.branch, git2::BranchType::Local)
                .map_err(|_| GitError::BranchNotFound(request.branch.clone()))?;
            let branch_ref = branch.into_reference();
            let ref_name = branch_ref
                .name()
                .ok_or_else(|| GitError::Config("Invalid branch reference name".to_string()))?;

            repo.worktree(
                &wt_id,
                &wt_path,
                Some(
                    git2::WorktreeAddOptions::new()
                        .reference(Some(&repo.find_reference(ref_name)?)),
                ),
            )?;
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Get HEAD info from the new worktree
        let (head_sha, is_dirty) = if let Ok(wt_repo) = git2::Repository::open(&wt_path) {
            let sha = wt_repo
                .head()
                .ok()
                .and_then(|r| r.target())
                .map(|oid| oid.to_string())
                .unwrap_or_default();
            let dirty = wt_repo
                .statuses(None)
                .map(|s| s.iter().any(|e| e.status() != git2::Status::CURRENT))
                .unwrap_or(false);
            (sha, dirty)
        } else {
            (String::new(), false)
        };

        // Save metadata
        let meta = WorktreeMetadata {
            id: wt_id.clone(),
            branch: request.branch.clone(),
            path: wt_path.display().to_string(),
            created_at: now,
            agent_session_id: None,
            is_locked: false,
            lock_reason: None,
        };

        let mut config = WorktreeConfig::load(&self.config_path)?;
        config.insert(meta);
        config.save(&self.config_path)?;

        Ok(WorktreeInfo {
            id: wt_id,
            path: wt_path.display().to_string(),
            branch: Some(request.branch.clone()),
            head_sha,
            is_main: false,
            is_locked: false,
            lock_reason: None,
            is_dirty,
            agent_session_id: None,
            created_at: now,
        })
    }

    /// Remove a worktree. Uses `git worktree remove` CLI as libgit2 lacks remove support.
    pub fn remove(&self, id: &str, force: bool) -> Result<(), GitError> {
        if id == "main" {
            return Err(GitError::Config("Cannot remove main worktree".to_string()));
        }

        let mut config = WorktreeConfig::load(&self.config_path)?;
        let meta = config
            .get(id)
            .ok_or_else(|| GitError::WorktreeNotFound(id.to_string()))?;

        if meta.is_locked && !force {
            return Err(GitError::WorktreeLocked(id.to_string()));
        }

        let wt_path = &meta.path;
        info!(id = %id, path = %wt_path, force, "Removing worktree");

        // Use git CLI for removal (libgit2 doesn't support worktree remove)
        let mut cmd = std::process::Command::new("git");
        cmd.current_dir(&self.repo_path)
            .arg("worktree")
            .arg("remove");
        if force {
            // Double --force overrides both dirty-files and lock protection
            cmd.arg("--force").arg("--force");
        }
        cmd.arg(wt_path);

        let output = cmd.output()?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // If the worktree directory is already gone, just clean up the config
            if !Path::new(wt_path).exists() {
                warn!(id = %id, "Worktree directory already removed, cleaning up config");
            } else {
                return Err(GitError::CommandFailed(format!(
                    "git worktree remove failed: {}",
                    stderr.trim()
                )));
            }
        }

        // Clean up config
        config.remove(id);
        config.save(&self.config_path)?;

        // Also prune stale worktrees
        let _ = std::process::Command::new("git")
            .current_dir(&self.repo_path)
            .args(["worktree", "prune"])
            .output();

        Ok(())
    }

    /// Get a single worktree by ID.
    pub fn get(&self, id: &str) -> Result<WorktreeInfo, GitError> {
        self.list()?
            .into_iter()
            .find(|wt| wt.id == id)
            .ok_or_else(|| GitError::WorktreeNotFound(id.to_string()))
    }

    /// Lock a worktree to prevent accidental removal.
    pub fn lock(&self, id: &str, reason: Option<&str>) -> Result<(), GitError> {
        if id == "main" {
            return Err(GitError::Config("Cannot lock main worktree".to_string()));
        }

        let repo = git2::Repository::open(&self.repo_path)?;
        let wt = repo
            .find_worktree(id)
            .map_err(|_| GitError::WorktreeNotFound(id.to_string()))?;

        let locked = wt
            .is_locked()
            .map(|status| matches!(status, git2::WorktreeLockStatus::Locked(_)))
            .unwrap_or(false);
        if locked {
            return Err(GitError::WorktreeLocked(id.to_string()));
        }

        wt.lock(reason)?;

        // Update config
        let mut config = WorktreeConfig::load(&self.config_path)?;
        if let Some(meta) = config.get_mut(id) {
            meta.is_locked = true;
            meta.lock_reason = reason.map(|s| s.to_string());
            config.save(&self.config_path)?;
        }

        debug!(id = %id, "Worktree locked");
        Ok(())
    }

    /// Unlock a worktree.
    pub fn unlock(&self, id: &str) -> Result<(), GitError> {
        if id == "main" {
            return Err(GitError::Config("Cannot unlock main worktree".to_string()));
        }

        let repo = git2::Repository::open(&self.repo_path)?;
        let wt = repo
            .find_worktree(id)
            .map_err(|_| GitError::WorktreeNotFound(id.to_string()))?;

        let locked = wt
            .is_locked()
            .map(|status| matches!(status, git2::WorktreeLockStatus::Locked(_)))
            .unwrap_or(false);
        if !locked {
            return Err(GitError::WorktreeNotLocked(id.to_string()));
        }

        wt.unlock()?;

        // Update config
        let mut config = WorktreeConfig::load(&self.config_path)?;
        if let Some(meta) = config.get_mut(id) {
            meta.is_locked = false;
            meta.lock_reason = None;
            config.save(&self.config_path)?;
        }

        debug!(id = %id, "Worktree unlocked");
        Ok(())
    }

    /// Get the filesystem path for a worktree ID. Returns None if not found.
    pub fn worktree_path(&self, id: &str) -> Option<PathBuf> {
        if id == "main" {
            return Some(self.repo_path.clone());
        }

        // Solo config first (worktrees created through Solo)
        if let Ok(config) = WorktreeConfig::load(&self.config_path) {
            if let Some(meta) = config.get(id) {
                return Some(PathBuf::from(&meta.path));
            }
        }

        // Fallback: check git2 worktrees by name
        if let Ok(repo) = git2::Repository::open(&self.repo_path) {
            if let Ok(wt) = repo.find_worktree(id) {
                return Some(wt.path().to_path_buf());
            }
        }

        None
    }

    /// Get the main repository path.
    pub fn repo_path(&self) -> &Path {
        &self.repo_path
    }

    /// Set the setup commands that run after worktree creation.
    pub fn set_setup_commands(&self, commands: Vec<String>) -> Result<(), GitError> {
        let mut config = WorktreeConfig::load(&self.config_path)?;
        config.setup_commands = commands;
        config.save(&self.config_path)
    }

    /// Get the current setup commands.
    pub fn get_setup_commands(&self) -> Result<Vec<String>, GitError> {
        let config = WorktreeConfig::load(&self.config_path)?;
        Ok(config.setup_commands)
    }

    /// Prune stale worktrees whose directories no longer exist or that exceed max_age_days.
    /// Returns the IDs of pruned worktrees.
    pub fn prune_stale(&self) -> Result<Vec<String>, GitError> {
        let mut config = WorktreeConfig::load(&self.config_path)?;
        let max_age_days = config.max_age_days;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut pruned = Vec::new();
        let ids: Vec<String> = config.worktrees.keys().cloned().collect();

        for id in ids {
            let meta = config.worktrees.get(&id).unwrap();
            let path = Path::new(&meta.path);

            // Skip locked worktrees
            if meta.is_locked {
                continue;
            }

            let should_prune = if !path.exists() {
                // Directory gone — always prune
                info!(id = %id, "Pruning worktree with missing directory");
                true
            } else if let Some(max_days) = max_age_days {
                let age_secs = now.saturating_sub(meta.created_at);
                let age_days = age_secs / 86400;
                if age_days > u64::from(max_days) {
                    info!(id = %id, age_days, max_days, "Pruning stale worktree");
                    true
                } else {
                    false
                }
            } else {
                false
            };

            if should_prune {
                // Try to remove via git CLI if the directory exists
                if path.exists() {
                    let output = std::process::Command::new("git")
                        .current_dir(&self.repo_path)
                        .args(["worktree", "remove", "--force", &meta.path])
                        .output();
                    if let Err(e) = output {
                        warn!(id = %id, error = %e, "Failed to git worktree remove during prune");
                    }
                }
                pruned.push(id.clone());
                config.worktrees.remove(&id);
            }
        }

        // Run git worktree prune for any remaining stale refs
        let _ = std::process::Command::new("git")
            .current_dir(&self.repo_path)
            .args(["worktree", "prune"])
            .output();

        config.save(&self.config_path)?;
        Ok(pruned)
    }

    /// Bind an agent session to a worktree.
    pub fn set_agent_session(&self, id: &str, session_id: &str) -> Result<(), GitError> {
        let mut config = WorktreeConfig::load(&self.config_path)?;
        let meta = config
            .get_mut(id)
            .ok_or_else(|| GitError::WorktreeNotFound(id.to_string()))?;
        meta.agent_session_id = Some(session_id.to_string());
        config.save(&self.config_path)
    }

    /// Clear the agent session binding from a worktree.
    pub fn clear_agent_session(&self, id: &str) -> Result<(), GitError> {
        let mut config = WorktreeConfig::load(&self.config_path)?;
        let meta = config
            .get_mut(id)
            .ok_or_else(|| GitError::WorktreeNotFound(id.to_string()))?;
        meta.agent_session_id = None;
        config.save(&self.config_path)
    }

    /// Find the worktree ID bound to an agent session. Returns None if no match.
    pub fn find_by_agent_session(&self, session_id: &str) -> Result<Option<String>, GitError> {
        let config = WorktreeConfig::load(&self.config_path)?;
        Ok(config
            .worktrees
            .values()
            .find(|m| m.agent_session_id.as_deref() == Some(session_id))
            .map(|m| m.id.clone()))
    }

    /// Diff a worktree against its merge-base with the main branch.
    /// Returns changed files with status and line counts.
    pub fn diff_from_base(&self, id: &str) -> Result<Vec<WorktreeDiffEntry>, GitError> {
        if id == "main" {
            return Ok(Vec::new());
        }

        let config = WorktreeConfig::load(&self.config_path)?;
        let meta = config
            .get(id)
            .ok_or_else(|| GitError::WorktreeNotFound(id.to_string()))?;

        let wt_path = PathBuf::from(&meta.path);
        let wt_repo = git2::Repository::open(&wt_path)?;

        // Find the main branch HEAD
        let main_repo = git2::Repository::open(&self.repo_path)?;
        let main_head = main_repo
            .head()
            .map_err(|_| GitError::Config("Could not resolve main HEAD".to_string()))?
            .peel_to_commit()
            .map_err(|_| GitError::Config("Main HEAD is not a commit".to_string()))?;

        // Worktree HEAD
        let wt_head = wt_repo
            .head()
            .map_err(|_| GitError::Config("Could not resolve worktree HEAD".to_string()))?
            .peel_to_commit()
            .map_err(|_| GitError::Config("Worktree HEAD is not a commit".to_string()))?;

        // Find merge-base
        let base_oid = main_repo
            .merge_base(main_head.id(), wt_head.id())
            .map_err(|_| {
                GitError::Config("Could not find merge-base between main and worktree".to_string())
            })?;

        let base_commit = main_repo.find_commit(base_oid)?;
        let base_tree = base_commit.tree()?;
        let wt_tree = wt_head.tree()?;

        let diff = main_repo.diff_tree_to_tree(Some(&base_tree), Some(&wt_tree), None)?;

        let mut entries = Vec::new();
        let stats = diff.stats()?;
        let _ = stats; // We iterate deltas individually

        for delta in diff.deltas() {
            let status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "renamed",
                git2::Delta::Copied => "copied",
                _ => "modified",
            };

            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.display().to_string())
                .unwrap_or_default();

            entries.push(WorktreeDiffEntry {
                path,
                status: status.to_string(),
                additions: 0,
                deletions: 0,
            });
        }

        // Collect per-file line stats using libgit2's diff line callback
        // (avoids spawning a git subprocess)
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
                    if let Some(entry) = entries.iter_mut().find(|e| e.path == path) {
                        match line.origin() {
                            '+' => entry.additions += 1,
                            '-' => entry.deletions += 1,
                            _ => {}
                        }
                    }
                }
                true
            }),
        );

        Ok(entries)
    }

    /// Create a named branch pointing at a worktree's current HEAD.
    /// Useful for detached-HEAD worktrees that need a branch before merging.
    pub fn promote_to_branch(&self, id: &str, branch_name: &str) -> Result<(), GitError> {
        if id == "main" {
            return Err(GitError::Config("Cannot promote main worktree".to_string()));
        }

        let config = WorktreeConfig::load(&self.config_path)?;
        let meta = config
            .get(id)
            .ok_or_else(|| GitError::WorktreeNotFound(id.to_string()))?;

        let wt_path = PathBuf::from(&meta.path);
        let wt_repo = git2::Repository::open(&wt_path)?;
        let head = wt_repo
            .head()
            .map_err(|_| GitError::Config("Could not resolve worktree HEAD".to_string()))?;
        let wt_commit = head
            .peel_to_commit()
            .map_err(|_| GitError::Config("Worktree HEAD is not a commit".to_string()))?;
        let commit_oid = wt_commit.id();

        // Create the branch in the main repo so it's visible everywhere.
        // Re-resolve the commit via the main repo since libgit2 rejects cross-repo objects.
        let main_repo = git2::Repository::open(&self.repo_path)?;
        if main_repo
            .find_branch(branch_name, git2::BranchType::Local)
            .is_ok()
        {
            return Err(GitError::BranchAlreadyExists(branch_name.to_string()));
        }

        let commit = main_repo.find_commit(commit_oid)?;
        main_repo.branch(branch_name, &commit, false)?;
        info!(id = %id, branch = %branch_name, "Promoted worktree to branch");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn setup_test_repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path().to_path_buf();

        Command::new("git")
            .args(["init", "--initial-branch=main"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        // Create initial commit so HEAD exists
        std::fs::write(repo_path.join("README.md"), "# Test").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&repo_path)
            .output()
            .unwrap();

        (dir, repo_path)
    }

    #[test]
    fn test_new_validates_repo() {
        let result = WorktreeManager::new(Path::new("/nonexistent/path"));
        assert!(result.is_err());
    }

    #[test]
    fn test_list_includes_main() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        let list = mgr.list().unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].is_main);
        assert_eq!(list[0].id, "main");
    }

    #[test]
    fn test_create_and_list() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();

        let req = CreateWorktreeRequest {
            branch: "feature-test".to_string(),
            path: None,
            create_branch: true,
            base: None,
        };

        let info = mgr.create(&req).unwrap();
        assert!(!info.is_main);
        assert_eq!(info.branch, Some("feature-test".to_string()));
        assert!(Path::new(&info.path).exists());

        let list = mgr.list().unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn test_create_and_remove() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();

        let req = CreateWorktreeRequest {
            branch: "feature-remove".to_string(),
            path: None,
            create_branch: true,
            base: None,
        };

        let info = mgr.create(&req).unwrap();
        let wt_path = PathBuf::from(&info.path);
        assert!(wt_path.exists());

        mgr.remove(&info.id, false).unwrap();
        assert!(!wt_path.exists());

        let list = mgr.list().unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn test_lock_unlock() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();

        let req = CreateWorktreeRequest {
            branch: "feature-lock".to_string(),
            path: None,
            create_branch: true,
            base: None,
        };

        let info = mgr.create(&req).unwrap();

        mgr.lock(&info.id, Some("agent working")).unwrap();
        let locked = mgr.get(&info.id).unwrap();
        assert!(locked.is_locked);

        // Removing locked worktree should fail without force
        assert!(mgr.remove(&info.id, false).is_err());

        mgr.unlock(&info.id).unwrap();
        let unlocked = mgr.get(&info.id).unwrap();
        assert!(!unlocked.is_locked);
    }

    #[test]
    fn test_cannot_remove_main() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        assert!(mgr.remove("main", false).is_err());
    }

    // -- Helper for diff tests --

    fn commit_file(repo_path: &Path, name: &str, content: &str) {
        std::fs::write(repo_path.join(name), content).unwrap();
        Command::new("git")
            .args(["add", name])
            .current_dir(repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", &format!("add {}", name)])
            .current_dir(repo_path)
            .output()
            .unwrap();
    }

    fn create_test_worktree(mgr: &WorktreeManager, branch: &str) -> WorktreeInfo {
        mgr.create(&CreateWorktreeRequest {
            branch: branch.to_string(),
            path: None,
            create_branch: true,
            base: None,
        })
        .unwrap()
    }

    // -- B. WorktreeManager tests — uncovered API methods --

    #[test]
    fn test_get_worktree() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        let info = create_test_worktree(&mgr, "feature-get");

        let fetched = mgr.get(&info.id).unwrap();
        assert_eq!(fetched.id, info.id);
        assert_eq!(fetched.branch, Some("feature-get".to_string()));
        assert!(!fetched.is_main);
        assert!(!fetched.head_sha.is_empty());
        assert!(fetched.created_at > 0);
        assert!(Path::new(&fetched.path).exists());
    }

    /// Canonicalize a path for comparison (resolves macOS /var → /private/var symlink).
    fn canon(p: &Path) -> PathBuf {
        p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
    }

    #[test]
    fn test_worktree_path_returns_correct_paths() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();

        // "main" returns the repo path
        let main_path = mgr.worktree_path("main").unwrap();
        assert_eq!(canon(&main_path), canon(&repo_path));

        let info = create_test_worktree(&mgr, "feature-path");

        // Created worktree returns its path
        let wt_path = mgr.worktree_path(&info.id);
        assert!(wt_path.is_some());
        assert_eq!(canon(&wt_path.unwrap()), canon(Path::new(&info.path)));

        // Nonexistent returns None
        assert!(mgr.worktree_path("nonexistent").is_none());
    }

    #[test]
    fn test_repo_path() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        assert_eq!(canon(mgr.repo_path()), canon(&repo_path));
    }

    // -- C. Agent session binding tests --

    #[test]
    fn test_agent_session_bind_and_find() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        let info = create_test_worktree(&mgr, "feature-agent");

        mgr.set_agent_session(&info.id, "sess-abc").unwrap();
        let found = mgr.find_by_agent_session("sess-abc").unwrap();
        assert_eq!(found, Some(info.id));
    }

    #[test]
    fn test_agent_session_clear() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        let info = create_test_worktree(&mgr, "feature-clear-agent");

        mgr.set_agent_session(&info.id, "sess-xyz").unwrap();
        mgr.clear_agent_session(&info.id).unwrap();

        let found = mgr.find_by_agent_session("sess-xyz").unwrap();
        assert_eq!(found, None);
    }

    #[test]
    fn test_find_agent_session_no_match() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();

        let found = mgr.find_by_agent_session("nonexistent-session").unwrap();
        assert_eq!(found, None);
    }

    // -- D. Setup commands tests --

    #[test]
    fn test_setup_commands_roundtrip() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();

        mgr.set_setup_commands(vec!["bun install".to_string(), "bun run build".to_string()])
            .unwrap();
        let cmds = mgr.get_setup_commands().unwrap();
        assert_eq!(cmds, vec!["bun install", "bun run build"]);
    }

    #[test]
    fn test_setup_commands_default_empty() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();

        let cmds = mgr.get_setup_commands().unwrap();
        assert!(cmds.is_empty());
    }

    // -- E. Prune tests --

    #[test]
    fn test_prune_missing_directory() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        let info = create_test_worktree(&mgr, "feature-prune");

        // Manually nuke the worktree directory
        std::fs::remove_dir_all(&info.path).unwrap();

        let pruned = mgr.prune_stale().unwrap();
        assert!(pruned.contains(&info.id));

        // Config should no longer reference this worktree
        assert!(mgr.worktree_path(&info.id).is_none());
    }

    #[test]
    fn test_prune_skips_locked() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        let info = create_test_worktree(&mgr, "feature-prune-lock");

        mgr.lock(&info.id, Some("in use")).unwrap();

        // Manually nuke the directory
        std::fs::remove_dir_all(&info.path).unwrap();

        let pruned = mgr.prune_stale().unwrap();
        assert!(
            !pruned.contains(&info.id),
            "locked worktree should not be pruned"
        );
    }

    // -- F. Diff and promote tests --

    #[test]
    fn test_diff_from_base() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        let info = create_test_worktree(&mgr, "feature-diff");

        // Commit a new file in the worktree
        let wt_path = PathBuf::from(&info.path);
        commit_file(&wt_path, "new-file.txt", "hello world\nsecond line\n");

        let entries = mgr.diff_from_base(&info.id).unwrap();
        assert!(!entries.is_empty());

        let entry = entries.iter().find(|e| e.path == "new-file.txt").unwrap();
        assert_eq!(entry.status, "added");
        assert!(entry.additions > 0);
    }

    #[test]
    fn test_diff_main_returns_empty() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();

        let entries = mgr.diff_from_base("main").unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_promote_to_branch() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        let info = create_test_worktree(&mgr, "feature-promote");

        mgr.promote_to_branch(&info.id, "promoted-branch").unwrap();

        // Verify the branch exists in the main repo
        let repo = git2::Repository::open(&repo_path).unwrap();
        assert!(repo
            .find_branch("promoted-branch", git2::BranchType::Local)
            .is_ok());
    }

    #[test]
    fn test_promote_duplicate_branch_fails() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        let info = create_test_worktree(&mgr, "feature-promote-dup");

        mgr.promote_to_branch(&info.id, "dup-branch").unwrap();
        let result = mgr.promote_to_branch(&info.id, "dup-branch");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, GitError::BranchAlreadyExists(_)),
            "expected BranchAlreadyExists, got: {:?}",
            err
        );
    }

    // -- G. Edge case / error tests --

    #[test]
    fn test_create_existing_branch_fails() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();

        create_test_worktree(&mgr, "feature-dup-branch");

        let result = mgr.create(&CreateWorktreeRequest {
            branch: "feature-dup-branch".to_string(),
            path: None,
            create_branch: true,
            base: None,
        });
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, GitError::BranchAlreadyExists(_)),
            "expected BranchAlreadyExists, got: {:?}",
            err
        );
    }

    #[test]
    fn test_lock_main_fails() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        assert!(mgr.lock("main", None).is_err());
    }

    #[test]
    fn test_unlock_main_fails() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        assert!(mgr.unlock("main").is_err());
    }

    #[test]
    fn test_force_remove_locked() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();
        let info = create_test_worktree(&mgr, "feature-force-rm");

        mgr.lock(&info.id, Some("locked for test")).unwrap();

        // Non-force should fail
        assert!(mgr.remove(&info.id, false).is_err());

        // Force should succeed
        mgr.remove(&info.id, true).unwrap();

        let list = mgr.list().unwrap();
        assert_eq!(list.len(), 1, "only main should remain");
    }

    // -- H. sanitize_worktree_id tests --

    #[test]
    fn test_sanitize_slash_branch() {
        assert_eq!(sanitize_worktree_id("feat/UI"), "feat-UI");
    }

    #[test]
    fn test_sanitize_deeply_nested() {
        assert_eq!(
            sanitize_worktree_id("feature/deeply/nested"),
            "feature-deeply-nested"
        );
    }

    #[test]
    fn test_sanitize_special_chars() {
        assert_eq!(sanitize_worktree_id("fix: bug #123"), "fix-bug-123");
    }

    #[test]
    fn test_sanitize_passthrough() {
        assert_eq!(sanitize_worktree_id("normal-branch"), "normal-branch");
    }

    #[test]
    fn test_sanitize_leading_trailing() {
        assert_eq!(sanitize_worktree_id("/leading-slash/"), "leading-slash");
    }

    #[test]
    fn test_sanitize_dots() {
        assert_eq!(sanitize_worktree_id("...dots..."), "dots");
    }

    #[test]
    fn test_sanitize_long_branch() {
        let long = "a".repeat(80);
        let result = sanitize_worktree_id(&long);
        assert!(result.len() <= 60, "got len {}", result.len());
    }

    #[test]
    fn test_sanitize_preserves_underscore_and_dot() {
        assert_eq!(
            sanitize_worktree_id("feat_name.v2"),
            "feat_name.v2"
        );
    }

    // -- I. Slash branch integration test --

    #[test]
    fn test_create_worktree_with_slash_branch() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(&repo_path).unwrap();

        let req = CreateWorktreeRequest {
            branch: "feat/slash-test".to_string(),
            path: None,
            create_branch: true,
            base: None,
        };

        let info = mgr.create(&req).unwrap();
        assert!(!info.id.contains('/'), "ID must not contain slash: {}", info.id);
        assert!(info.id.starts_with("feat-slash-test-"), "ID should start with sanitized branch: {}", info.id);
        assert_eq!(info.branch, Some("feat/slash-test".to_string()));
        assert!(Path::new(&info.path).exists());

        // Verify we can list and find it
        let list = mgr.list().unwrap();
        assert_eq!(list.len(), 2);
    }
}
