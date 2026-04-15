#![warn(clippy::all, clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::uninlined_format_args,
    clippy::too_many_arguments
)]

//! Solo Vault — agent memory system.
//!
//! V1: local SQLite store + rule-based classifier + text-only extraction +
//! FTS5 lexical search. Embeddings, cloud sync, and OCR land in later phases.

pub mod classifier;
pub mod memory;
pub mod pipeline;
pub mod placement;
pub mod store;
pub mod sync;

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use thiserror::Error;

pub use solo_protocol::{
    CloudSyncState, EntryKind, IndexStatus, MemoryType, PlacementMode, PlacementResult,
    PlacementSuggestion, RetrievalStats, VaultChunk, VaultEntry, VaultListFilters, VaultScope,
    VaultSearchMode, VaultSearchResult,
};

use crate::store::Store;

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

pub struct Vault {
    pub root: PathBuf,
    store: Store,
}

impl Vault {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        let store = Store::open(root.join("index.sqlite"))?;
        Ok(Self { root, store })
    }

    pub fn default_root() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".solo")
            .join("vault")
    }

    pub fn blobs_dir(&self) -> PathBuf {
        pipeline::blobs_dir(&self.root)
    }

    pub fn drop_paths(
        &self,
        paths: &[String],
        scope: VaultScope,
        memory_type: MemoryType,
    ) -> Vec<Result<VaultEntry>> {
        let blobs = self.blobs_dir();
        paths
            .iter()
            .map(|p| {
                pipeline::ingest_and_store(
                    Path::new(p),
                    &blobs,
                    &self.store,
                    scope.clone(),
                    memory_type,
                )
            })
            .collect()
    }

    pub fn list(&self, scope: &VaultScope, filters: &VaultListFilters) -> Result<Vec<VaultEntry>> {
        self.store.list_entries(scope, filters)
    }

    pub fn get(&self, id: &str) -> Result<Option<VaultEntry>> {
        self.store.get_entry(id)
    }

    pub fn update_tags(&self, id: &str, tags: &[String]) -> Result<Option<VaultEntry>> {
        self.store.update_tags(id, tags, unix_now())
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<Option<VaultEntry>> {
        self.store.set_pinned(id, pinned, unix_now())
    }

    pub fn move_scope(&self, id: &str, new_scope: VaultScope) -> Result<Option<VaultEntry>> {
        self.store.move_scope(id, &new_scope, unix_now())
    }

    pub fn move_bucket(&self, id: &str, new_kind: EntryKind) -> Result<Option<VaultEntry>> {
        self.store.move_bucket(id, new_kind, unix_now())
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        if let Some(entry) = self.store.get_entry(id)? {
            if let Some(blob) = entry.vault_blob_path.as_deref() {
                let _ = std::fs::remove_file(blob);
            }
        }
        self.store.delete_entry(id)
    }

    pub fn fts_search(
        &self,
        query: &str,
        scope: &VaultScope,
        top_k: usize,
    ) -> Result<Vec<VaultSearchResult>> {
        let hits = self.store.fts_search(query, scope, top_k)?;
        let now = unix_now();
        for (_, entry, _) in &hits {
            let _ = self.store.bump_retrieval(&entry.id, now);
        }
        Ok(hits
            .into_iter()
            .map(|(chunk, entry, score)| VaultSearchResult { chunk, entry, score })
            .collect())
    }

    pub fn unsorted_count(&self) -> u32 {
        self.store.unsorted_count().unwrap_or(0)
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
