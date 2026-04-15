//! Vault command handlers — V0 scaffold.
//!
//! All commands return empty / `NotImplemented` for now. The real
//! implementations land in Phase V1 (classifier + SQLite + pipeline).

use std::sync::Arc;

use solo_protocol::{
    PlacementResult, PlacementSuggestion, VaultEntry, VaultListFilters, VaultScope,
    VaultSearchMode, VaultSearchResult,
};
use solo_vault::Vault;
use tauri::State;
use tokio::sync::RwLock;

// =============================================================================
// State
// =============================================================================

/// Tauri-managed vault state. Holds an optional `Vault` — the vault is lazily
/// initialized on first use (once we know the user's app data dir / workspace).
pub struct VaultState {
    pub inner: Arc<RwLock<Option<Arc<Vault>>>>,
}

impl VaultState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(None)),
        }
    }
}

impl Default for VaultState {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Commands (V0 stubs)
// =============================================================================

/// Drop one or more filesystem paths into the vault.
///
/// V0: always returns an empty list — V1 wires up the classifier + pipeline.
#[tauri::command]
pub async fn vault_drop_paths(
    paths: Vec<String>,
    _scope: VaultScope,
    _memory_type: solo_protocol::MemoryType,
    _state: State<'_, VaultState>,
) -> Result<Vec<String>, String> {
    tracing::debug!(count = paths.len(), "vault_drop_paths (stub)");
    Ok(Vec::new())
}

/// List vault entries filtered by scope + filters.
#[tauri::command]
pub async fn vault_list(
    _scope: VaultScope,
    _filters: VaultListFilters,
    _state: State<'_, VaultState>,
) -> Result<Vec<VaultEntry>, String> {
    Ok(Vec::new())
}

/// Fetch a single entry.
#[tauri::command]
pub async fn vault_get(
    _entry_id: String,
    _state: State<'_, VaultState>,
) -> Result<Option<VaultEntry>, String> {
    Ok(None)
}

/// Update the tags on an entry.
#[tauri::command]
pub async fn vault_update_tags(
    _entry_id: String,
    _tags: Vec<String>,
    _state: State<'_, VaultState>,
) -> Result<Option<VaultEntry>, String> {
    Err("vault_update_tags: not yet implemented".into())
}

/// Pin or unpin an entry as a source of truth.
#[tauri::command]
pub async fn vault_set_pinned(
    _entry_id: String,
    _pinned: bool,
    _state: State<'_, VaultState>,
) -> Result<Option<VaultEntry>, String> {
    Err("vault_set_pinned: not yet implemented".into())
}

/// Move an entry between Global and Project scopes.
#[tauri::command]
pub async fn vault_move_scope(
    _entry_id: String,
    _new_scope: VaultScope,
    _state: State<'_, VaultState>,
) -> Result<Option<VaultEntry>, String> {
    Err("vault_move_scope: not yet implemented".into())
}

/// Move an entry from the Unsorted tray into a specific bucket (kind).
#[tauri::command]
pub async fn vault_move_bucket(
    _entry_id: String,
    _new_kind: solo_protocol::EntryKind,
    _state: State<'_, VaultState>,
) -> Result<Option<VaultEntry>, String> {
    Err("vault_move_bucket: not yet implemented".into())
}

/// Delete an entry locally (and optionally from the cloud).
#[tauri::command]
pub async fn vault_delete(
    _entry_id: String,
    _also_remote: bool,
    _state: State<'_, VaultState>,
) -> Result<(), String> {
    Err("vault_delete: not yet implemented".into())
}

/// Search the vault. Respects scope and pinned boosting.
#[tauri::command]
pub async fn vault_search(
    _query: String,
    _scope: VaultScope,
    _top_k: usize,
    _mode: VaultSearchMode,
    _state: State<'_, VaultState>,
) -> Result<Vec<VaultSearchResult>, String> {
    Ok(Vec::new())
}

/// Compute a workspace-placement suggestion for an entry.
#[tauri::command]
pub async fn vault_suggest_placement(
    _entry_id: String,
    _workspace_path: String,
    _state: State<'_, VaultState>,
) -> Result<Option<PlacementSuggestion>, String> {
    Ok(None)
}

/// Apply a placement suggestion.
#[tauri::command]
pub async fn vault_accept_placement(
    entry_id: String,
    _target_path: String,
    mode: solo_protocol::PlacementMode,
    _state: State<'_, VaultState>,
) -> Result<PlacementResult, String> {
    Ok(PlacementResult {
        entry_id,
        workspace_path: None,
        mode,
    })
}

/// Re-run the indexing pipeline for an entry.
#[tauri::command]
pub async fn vault_reindex(
    _entry_id: String,
    _state: State<'_, VaultState>,
) -> Result<(), String> {
    Err("vault_reindex: not yet implemented".into())
}

/// Log a classifier correction (user manually moved an entry to a different
/// bucket) for later rule tuning.
#[tauri::command]
pub async fn vault_log_classifier_correction(
    _entry_id: String,
    _old_kind: solo_protocol::EntryKind,
    _new_kind: solo_protocol::EntryKind,
    _state: State<'_, VaultState>,
) -> Result<(), String> {
    Ok(())
}

/// Count of entries currently in the Unsorted review tray.
#[tauri::command]
pub async fn vault_unsorted_count(state: State<'_, VaultState>) -> Result<u32, String> {
    let guard = state.inner.read().await;
    match guard.as_ref() {
        Some(v) => Ok(v.unsorted_count().await),
        None => Ok(0),
    }
}
