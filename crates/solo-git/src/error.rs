//! Git error types for Solo IDE

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("Git repository not found at: {0}")]
    RepoNotFound(String),

    #[error("Worktree not found: {0}")]
    WorktreeNotFound(String),

    #[error("Worktree already exists: {0}")]
    WorktreeAlreadyExists(String),

    #[error("Branch already exists: {0}")]
    BranchAlreadyExists(String),

    #[error("Branch not found: {0}")]
    BranchNotFound(String),

    #[error("Worktree is locked: {0}")]
    WorktreeLocked(String),

    #[error("Worktree is not locked: {0}")]
    WorktreeNotLocked(String),

    #[error("Maximum worktree count ({0}) reached")]
    MaxWorktreesReached(u32),

    #[error("Git error: {0}")]
    Git2(#[from] git2::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Config error: {0}")]
    Config(String),

    #[error("Command failed: {0}")]
    CommandFailed(String),
}
