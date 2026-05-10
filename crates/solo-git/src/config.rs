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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeConfig {
    pub worktrees: HashMap<String, WorktreeMetadata>,
    /// Shell commands to run in new worktrees after creation.
    /// Default includes `bun install`, which runs the root postinstall hook
    /// that builds the agent-bridge sidecar (`agent-bridge/dist/index.js`).
    /// Without this, new worktrees can't start agent sessions because the
    /// sidecar binary is missing.
    #[serde(default = "default_setup_commands")]
    pub setup_commands: Vec<String>,
    /// Auto-prune worktrees older than this many days (None = disabled)
    #[serde(default)]
    pub max_age_days: Option<u32>,
}

fn default_setup_commands() -> Vec<String> {
    vec!["bun install".to_string()]
}

impl Default for WorktreeConfig {
    fn default() -> Self {
        Self {
            worktrees: HashMap::new(),
            setup_commands: default_setup_commands(),
            max_age_days: None,
        }
    }
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

/// Deterministic FNV-1a hash for path disambiguation.
/// MUST remain stable across Rust versions — do not use DefaultHasher.
fn stable_path_hash(path: &Path) -> String {
    let bytes = path.to_string_lossy();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325; // FNV-1a offset basis
    for b in bytes.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x0100_0000_01b3); // FNV-1a prime
    }
    format!("{:08x}", hash & 0xFFFF_FFFF)
}

/// Get the worktrees base directory: ~/.solo/worktrees/{repo-name}-{hash}/
///
/// The hash is derived from the full canonical repo path, preventing collisions
/// between repos with the same folder name in different locations.
pub fn worktrees_base_dir(repo_path: &Path) -> Result<PathBuf, GitError> {
    let home = dirs_home()?;
    let repo_name = repo_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let hash = stable_path_hash(repo_path);
    Ok(home
        .join(".solo")
        .join("worktrees")
        .join(format!("{}-{}", repo_name, hash)))
}

fn dirs_home() -> Result<PathBuf, GitError> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .map_err(|_| GitError::Config("Could not determine home directory".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_metadata(id: &str) -> WorktreeMetadata {
        WorktreeMetadata {
            id: id.to_string(),
            branch: format!("feature-{}", id),
            path: format!("/tmp/worktrees/{}", id),
            created_at: 1_700_000_000,
            agent_session_id: Some("session-42".to_string()),
            is_locked: false,
            lock_reason: None,
        }
    }

    #[test]
    fn test_config_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("worktrees.json");

        let mut config = WorktreeConfig {
            setup_commands: vec!["bun install".to_string()],
            max_age_days: Some(30),
            ..WorktreeConfig::default()
        };
        config.insert(sample_metadata("wt-1"));
        config.insert(sample_metadata("wt-2"));

        config.save(&path).unwrap();
        let loaded = WorktreeConfig::load(&path).unwrap();

        assert_eq!(loaded.worktrees.len(), 2);
        assert_eq!(loaded.setup_commands, vec!["bun install".to_string()]);
        assert_eq!(loaded.max_age_days, Some(30));
        let m = loaded.get("wt-1").unwrap();
        assert_eq!(m.branch, "feature-wt-1");
        assert_eq!(m.agent_session_id.as_deref(), Some("session-42"));
    }

    #[test]
    fn test_config_load_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nonexistent.json");

        let config = WorktreeConfig::load(&path).unwrap();
        assert!(config.worktrees.is_empty());
        // Default setup_commands is `["bun install"]` so new worktrees install
        // dependencies (including the agent-bridge sidecar via postinstall).
        assert_eq!(config.setup_commands, vec!["bun install".to_string()]);
        assert_eq!(config.max_age_days, None);
    }

    #[test]
    fn test_config_insert_and_get() {
        let mut config = WorktreeConfig::default();
        config.insert(sample_metadata("abc"));

        let m = config.get("abc").unwrap();
        assert_eq!(m.id, "abc");
        assert_eq!(m.branch, "feature-abc");
        assert_eq!(m.path, "/tmp/worktrees/abc");
        assert_eq!(m.created_at, 1_700_000_000);
        assert!(!m.is_locked);
    }

    #[test]
    fn test_config_remove() {
        let mut config = WorktreeConfig::default();
        config.insert(sample_metadata("rm-me"));
        assert!(config.get("rm-me").is_some());

        let removed = config.remove("rm-me");
        assert!(removed.is_some());
        assert!(config.get("rm-me").is_none());
    }

    #[test]
    fn test_config_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join("a")
            .join("b")
            .join("c")
            .join("worktrees.json");

        let config = WorktreeConfig::default();
        config.save(&path).unwrap();

        assert!(path.exists());
    }

    // -- stable_path_hash tests --

    #[test]
    fn test_stable_path_hash_deterministic() {
        let p = Path::new("/Users/dev/projects/my-app");
        assert_eq!(stable_path_hash(p), stable_path_hash(p));
    }

    #[test]
    fn test_stable_path_hash_different_paths() {
        let a = Path::new("/Users/alice/my-app");
        let b = Path::new("/Users/bob/my-app");
        assert_ne!(stable_path_hash(a), stable_path_hash(b));
    }

    #[test]
    fn test_worktrees_base_dir_includes_hash() {
        let p = Path::new("/Users/dev/my-app");
        let dir = worktrees_base_dir(p).unwrap();
        let dir_name = dir.file_name().unwrap().to_string_lossy().to_string();
        // Should be "my-app-{8hexchars}"
        assert!(dir_name.starts_with("my-app-"), "got: {}", dir_name);
        assert_eq!(dir_name.len(), "my-app-".len() + 8, "got: {}", dir_name);
    }

    #[test]
    fn test_worktrees_base_dir_differs_for_same_name() {
        let a = Path::new("/Users/alice/my-app");
        let b = Path::new("/Users/bob/my-app");
        let dir_a = worktrees_base_dir(a).unwrap();
        let dir_b = worktrees_base_dir(b).unwrap();
        assert_ne!(dir_a, dir_b);
    }
}
