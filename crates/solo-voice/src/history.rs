//! Voice transcript history — SQLite-backed log of completed pipeline runs.
//!
//! Full implementation arrives in a later task. This module provides the
//! types and interface used by `voice_commands.rs` so that Phase 1 compiles.

use crate::error::{Result, VoiceError};
use std::path::Path;

/// A single history entry persisted to SQLite.
pub struct HistoryRow {
    pub id: String,
    pub mode: String,
    pub raw_transcript: String,
    pub formatted: String,
    pub target_app_bundle_id: Option<String>,
    pub target_app_name: Option<String>,
    pub duration_ms: u32,
    pub linked_session_id: Option<String>,
    pub created_at: i64,
}

/// Handle to the history database.
pub struct History {
    _path: std::path::PathBuf,
}

impl History {
    /// Open (or create) the history database at `path`.
    pub fn open(path: &Path) -> Result<Self> {
        // Stub: actual SQLite open/migrate is implemented in a later task.
        // Ensure the parent directory exists so `voice_enable` doesn't fail.
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| VoiceError::History(e.to_string()))?;
        }
        Ok(Self {
            _path: path.to_path_buf(),
        })
    }

    /// Insert a new history row. No-op in the stub.
    pub fn insert(&self, _row: &HistoryRow) -> Result<()> {
        Ok(())
    }

    /// Return the `limit` most-recent rows. Returns empty vec in the stub.
    pub fn list(&self, _limit: u32) -> Result<Vec<HistoryRow>> {
        Ok(Vec::new())
    }

    /// Delete a row by id. No-op in the stub.
    pub fn delete(&self, _id: &str) -> Result<()> {
        Ok(())
    }
}
