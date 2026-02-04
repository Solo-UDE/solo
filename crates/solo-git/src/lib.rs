//! Solo Git — Git operations for Solo IDE
//!
//! Provides worktree management using `git2` (libgit2) for core operations
//! and CLI fallback for operations not supported by libgit2 (remove, move).

pub mod config;
pub mod error;

use config::{WorktreeConfig, WorktreeMetadata};
use error::GitError;
use solo_protocol::{CreateWorktreeRequest, WorktreeInfo};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, info, warn};

/// Manages git worktrees for a repository.
///
/// Opens `git2::Repository` per-operation to avoid `!Send`/`!Sync` issues.
/// Worktrees are stored at `~/.solo/worktrees/{repo-name}/{branch}-{short-uuid}/`.
/// Metadata is persisted in `~/.solo/worktrees/{repo-name}/worktrees.json`.
pub struct WorktreeManager {
    repo_path: PathBuf,
    worktrees_dir: PathBuf,
    config_path: PathBuf,
    max_worktrees: u32,
}

impl WorktreeManager {
    /// Create a new WorktreeManager for a repository path.
    pub fn new(repo_path: PathBuf) -> Result<Self, GitError> {
        // Validate that the path is a git repo by opening it
        let repo = git2::Repository::open(&repo_path)
            .map_err(|_| GitError::RepoNotFound(repo_path.display().to_string()))?;

        // Use the workdir or the repo path itself
        let actual_repo_path = repo
            .workdir()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| repo_path.clone());

        let worktrees_dir = config::worktrees_base_dir(&actual_repo_path)?;
        let config_path = config::config_path(&actual_repo_path)?;

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

            let branch = repo
                .head()
                .ok()
                .and_then(|r| {
                    if r.is_branch() {
                        r.shorthand().map(|s| s.to_string())
                    } else {
                        None
                    }
                });

            let is_dirty = repo.statuses(None)
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
                    let (head_sha, branch, is_dirty) = if let Ok(wt_repo) = git2::Repository::open(&wt_path) {
                        let sha = wt_repo.head().ok()
                            .and_then(|r| r.target())
                            .map(|oid| oid.to_string())
                            .unwrap_or_default();
                        let br = wt_repo.head().ok()
                            .and_then(|r| {
                                if r.is_branch() { r.shorthand().map(|s| s.to_string()) } else { None }
                            });
                        let dirty = wt_repo.statuses(None)
                            .map(|s| s.iter().any(|e| e.status() != git2::Status::CURRENT))
                            .unwrap_or(false);
                        (sha, br, dirty)
                    } else {
                        (String::new(), None, false)
                    };

                    // Merge metadata from config
                    let meta = config.worktrees.values()
                        .find(|m| m.path == wt_path.display().to_string());

                    let id = meta.map(|m| m.id.clone()).unwrap_or_else(|| name.to_string());
                    let is_locked = wt.is_locked()
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

        // Generate worktree ID and path
        let short_uuid = &uuid::Uuid::new_v4().to_string()[..8];
        let wt_id = format!("{}-{}", request.branch, short_uuid);
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
            if repo.find_branch(&request.branch, git2::BranchType::Local).is_ok() {
                return Err(GitError::BranchAlreadyExists(request.branch.clone()));
            }

            let branch = repo.branch(&request.branch, &base_commit, false)?;
            let branch_ref = branch.into_reference();
            let ref_name = branch_ref.name()
                .ok_or_else(|| GitError::Config("Invalid branch reference name".to_string()))?;

            repo.worktree(
                &wt_id,
                &wt_path,
                Some(git2::WorktreeAddOptions::new().reference(Some(&repo.find_reference(ref_name)?))),
            )?;
        } else {
            // Use existing branch
            let branch = repo.find_branch(&request.branch, git2::BranchType::Local)
                .map_err(|_| GitError::BranchNotFound(request.branch.clone()))?;
            let branch_ref = branch.into_reference();
            let ref_name = branch_ref.name()
                .ok_or_else(|| GitError::Config("Invalid branch reference name".to_string()))?;

            repo.worktree(
                &wt_id,
                &wt_path,
                Some(git2::WorktreeAddOptions::new().reference(Some(&repo.find_reference(ref_name)?))),
            )?;
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Get HEAD info from the new worktree
        let (head_sha, is_dirty) = if let Ok(wt_repo) = git2::Repository::open(&wt_path) {
            let sha = wt_repo.head().ok()
                .and_then(|r| r.target())
                .map(|oid| oid.to_string())
                .unwrap_or_default();
            let dirty = wt_repo.statuses(None)
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
        let meta = config.get(id)
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
            cmd.arg("--force");
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
                    "git worktree remove failed: {}", stderr.trim()
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
        let wt = repo.find_worktree(id)
            .map_err(|_| GitError::WorktreeNotFound(id.to_string()))?;

        let locked = wt.is_locked()
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
        let wt = repo.find_worktree(id)
            .map_err(|_| GitError::WorktreeNotFound(id.to_string()))?;

        let locked = wt.is_locked()
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
        let config = WorktreeConfig::load(&self.config_path).ok()?;
        config.get(id).map(|m| PathBuf::from(&m.path))
    }

    /// Get the main repository path.
    pub fn repo_path(&self) -> &Path {
        &self.repo_path
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
        let result = WorktreeManager::new(PathBuf::from("/nonexistent/path"));
        assert!(result.is_err());
    }

    #[test]
    fn test_list_includes_main() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(repo_path).unwrap();
        let list = mgr.list().unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].is_main);
        assert_eq!(list[0].id, "main");
    }

    #[test]
    fn test_create_and_list() {
        let (_dir, repo_path) = setup_test_repo();
        let mgr = WorktreeManager::new(repo_path).unwrap();

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
        let mgr = WorktreeManager::new(repo_path).unwrap();

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
        let mgr = WorktreeManager::new(repo_path).unwrap();

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
        let mgr = WorktreeManager::new(repo_path).unwrap();
        assert!(mgr.remove("main", false).is_err());
    }
}
