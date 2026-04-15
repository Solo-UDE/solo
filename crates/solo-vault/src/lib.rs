#![warn(clippy::all, clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc
)]

//! Solo Vault — agent memory system.
//!
//! The vault is the IDE-side memory store that makes dragged-and-dropped files
//! and notes durably retrievable by the agent. This crate is the V0 scaffold;
//! real pipelines (classifier, extractors, SQLite store, sync worker) land in
//! subsequent phases.

pub mod classifier;
pub mod memory;
pub mod pipeline;
pub mod placement;
pub mod store;
pub mod sync;

use std::path::PathBuf;
use thiserror::Error;
use tokio::sync::RwLock;

pub use solo_protocol::{
    CloudSyncState, EntryKind, IndexStatus, MemoryType, PlacementMode, PlacementResult,
    PlacementSuggestion, RetrievalStats, VaultChunk, VaultEntry, VaultListFilters,
    VaultScope, VaultSearchMode, VaultSearchResult,
};

/// Vault-level error surface returned over IPC as a String.
#[derive(Debug, Error)]
pub enum VaultError {
    #[error("vault not initialized")]
    NotInitialized,
    #[error("entry not found: {0}")]
    EntryNotFound(String),
    #[error("not yet implemented: {0}")]
    NotImplemented(&'static str),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, VaultError>;

/// The `Vault` is the top-level state handle owned by the Tauri app.
///
/// V0 scaffold — the inner store is a placeholder. Phase V1 will back this
/// with SQLite (entries + chunks + FTS5 + sqlite-vec).
pub struct Vault {
    /// Root directory for blobs, thumbnails, and the SQLite index file.
    pub root: PathBuf,
    /// Guarded inner state (future: `store::SqliteStore`).
    inner: RwLock<Inner>,
}

#[derive(Default)]
struct Inner {
    /// Count of entries currently parked in the Unsorted review tray.
    pub unsorted_count: u32,
}

impl Vault {
    /// Create a new Vault rooted at the given directory. The directory is
    /// created if it does not already exist.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        if !root.exists() {
            std::fs::create_dir_all(&root)?;
        }
        Ok(Self {
            root,
            inner: RwLock::new(Inner::default()),
        })
    }

    /// Number of entries currently in the Unsorted review tray.
    pub async fn unsorted_count(&self) -> u32 {
        self.inner.read().await.unsorted_count
    }
}
