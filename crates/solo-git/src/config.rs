//! Worktree metadata persistence
//!
//! Stores worktree metadata in ~/.solo/worktrees/{repo-name}/worktrees.json
//! to track agent associations and creation timestamps.

use crate::error::GitError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeMetadata {
    pub id: String,
    pub branch: String,
    pub path: String,
    pub created_at: u64,
    pub agent_session_id: Option<String>,
    pub is_locked: bool,
    pub lock_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorktreeConfig {
    pub worktrees: HashMap<String, WorktreeMetadata>,
    /// Shell commands to run in new worktrees after creation
    #[serde(default)]
    pub setup_commands: Vec<String>,
    /// Auto-prune worktrees older than this many days (None = disabled)
    #[serde(default)]
    pub max_age_days: Option<u32>,
}

impl WorktreeConfig {
    /// Load config from disk, returning default if file doesn't exist.
    pub fn load(config_path: &Path) -> Result<Self, GitError> {
        if !config_path.exists() {
            return Ok(Self::default());
        }
        let data = std::fs::read_to_string(config_path)
            .map_err(|e| GitError::Config(format!("Failed to read config: {}", e)))?;
        serde_json::from_str(&data)
            .map_err(|e| GitError::Config(format!("Failed to parse config: {}", e)))
    }

    /// Save config to disk, creating parent directories if needed.
    pub fn save(&self, config_path: &Path) -> Result<(), GitError> {
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_string_pretty(self)
            .map_err(|e| GitError::Config(format!("Failed to serialize config: {}", e)))?;
        std::fs::write(config_path, data)?;
        Ok(())
    }

    pub fn insert(&mut self, meta: WorktreeMetadata) {
        self.worktrees.insert(meta.id.clone(), meta);
    }

    pub fn remove(&mut self, id: &str) -> Option<WorktreeMetadata> {
        self.worktrees.remove(id)
    }

    pub fn get(&self, id: &str) -> Option<&WorktreeMetadata> {
        self.worktrees.get(id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut WorktreeMetadata> {
        self.worktrees.get_mut(id)
    }
}

/// Get the worktrees base directory: ~/.solo/worktrees/{repo-name}/
pub fn worktrees_base_dir(repo_path: &Path) -> Result<PathBuf, GitError> {
    let home = dirs_home()?;
    let repo_name = repo_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    Ok(home.join(".solo").join("worktrees").join(repo_name))
}

/// Get the config file path: ~/.solo/worktrees/{repo-name}/worktrees.json
pub fn config_path(repo_path: &Path) -> Result<PathBuf, GitError> {
    Ok(worktrees_base_dir(repo_path)?.join("worktrees.json"))
}

fn dirs_home() -> Result<PathBuf, GitError> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| GitError::Config("Could not determine home directory".to_string()))
}
