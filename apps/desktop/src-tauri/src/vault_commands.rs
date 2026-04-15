//! Vault command handlers — V1 (local-only: classifier + SQLite + FTS).
//!
//! The Vault is lazily initialized on first use at `$HOME/.solo/vault`.
//! Embeddings, cloud sync, and OCR land in later phases.

use std::sync::Arc;

use solo_protocol::{
    BackendEvent, EntryKind, MemoryType, PlacementMode, PlacementResult, PlacementSuggestion,
    VaultEntry, VaultListFilters, VaultScope, VaultSearchMode, VaultSearchResult,
};
use solo_vault::Vault;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

// =============================================================================
// State
// =============================================================================

pub struct VaultState {
    pub inner: Arc<RwLock<Option<Arc<Vault>>>>,
}

impl VaultState {
    pub fn new() -> Self {
        Self { inner: Arc::new(RwLock::new(None)) }
    }
}

impl Default for VaultState {
    fn default() -> Self { Self::new() }
}

async fn get_vault(state: &State<'_, VaultState>) -> Result<Arc<Vault>, String> {
    {
        let guard = state.inner.read().await;
        if let Some(v) = guard.as_ref() { return Ok(v.clone()); }
    }
    let mut guard = state.inner.write().await;
    if let Some(v) = guard.as_ref() { return Ok(v.clone()); }
    let root = Vault::default_root();
    info!(root = %root.display(), "Opening vault");
    let v = Arc::new(Vault::open(root).map_err(|e| e.to_string())?);
    *guard = Some(v.clone());
    Ok(v)
}

// =============================================================================
// Commands
// =============================================================================

#[tauri::command]
pub async fn vault_drop_paths(
    paths: Vec<String>,
    scope: VaultScope,
    memory_type: MemoryType,
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Result<Vec<String>, String> {
    let vault = get_vault(&state).await?;
    debug!(count = paths.len(), "vault_drop_paths");

    let results = vault.drop_paths(&paths, scope, memory_type);
    let mut ids = Vec::with_capacity(results.len());

    for res in results {
        match res {
            Ok(entry) => {
                let _ = app.emit(
                    "backend-event",
                    BackendEvent::VaultEntryAdded { entry_id: entry.id.clone() },
                );
                ids.push(entry.id);
            }
            Err(e) => {
                warn!("vault_drop_paths: ingestion failed: {}", e);
            }
        }
    }

    // Update Unsorted badge
    let count = vault.unsorted_count();
    let _ = app.emit(
        "backend-event",
        BackendEvent::VaultUnsortedCountChanged { count },
    );

    Ok(ids)
}

#[tauri::command]
pub async fn vault_list(
    scope: VaultScope,
    filters: VaultListFilters,
    state: State<'_, VaultState>,
) -> Result<Vec<VaultEntry>, String> {
    let vault = get_vault(&state).await?;
    vault.list(&scope, &filters).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_get(
    entry_id: String,
    state: State<'_, VaultState>,
) -> Result<Option<VaultEntry>, String> {
    let vault = get_vault(&state).await?;
    vault.get(&entry_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_update_tags(
    entry_id: String,
    tags: Vec<String>,
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Result<Option<VaultEntry>, String> {
    let vault = get_vault(&state).await?;
    let updated = vault.update_tags(&entry_id, &tags).map_err(|e| e.to_string())?;
    if updated.is_some() {
        let _ = app.emit("backend-event", BackendEvent::VaultEntryUpdated { entry_id });
    }
    Ok(updated)
}

#[tauri::command]
pub async fn vault_set_pinned(
    entry_id: String,
    pinned: bool,
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Result<Option<VaultEntry>, String> {
    let vault = get_vault(&state).await?;
    let updated = vault.set_pinned(&entry_id, pinned).map_err(|e| e.to_string())?;
    if updated.is_some() {
        let _ = app.emit("backend-event", BackendEvent::VaultEntryUpdated { entry_id });
    }
    Ok(updated)
}

#[tauri::command]
pub async fn vault_move_scope(
    entry_id: String,
    new_scope: VaultScope,
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Result<Option<VaultEntry>, String> {
    let vault = get_vault(&state).await?;
    let updated = vault.move_scope(&entry_id, new_scope).map_err(|e| e.to_string())?;
    if updated.is_some() {
        let _ = app.emit("backend-event", BackendEvent::VaultEntryUpdated { entry_id });
    }
    Ok(updated)
}

#[tauri::command]
pub async fn vault_move_bucket(
    entry_id: String,
    new_kind: EntryKind,
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Result<Option<VaultEntry>, String> {
    let vault = get_vault(&state).await?;
    let updated = vault.move_bucket(&entry_id, new_kind).map_err(|e| e.to_string())?;
    if updated.is_some() {
        let _ = app.emit("backend-event", BackendEvent::VaultEntryUpdated { entry_id });
        let count = vault.unsorted_count();
        let _ = app.emit(
            "backend-event",
            BackendEvent::VaultUnsortedCountChanged { count },
        );
    }
    Ok(updated)
}

#[tauri::command]
pub async fn vault_delete(
    entry_id: String,
    _also_remote: bool,
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    let vault = get_vault(&state).await?;
    vault.delete(&entry_id).map_err(|e| e.to_string())?;
    let _ = app.emit(
        "backend-event",
        BackendEvent::VaultEntryDeleted { entry_id: entry_id.clone() },
    );
    let count = vault.unsorted_count();
    let _ = app.emit(
        "backend-event",
        BackendEvent::VaultUnsortedCountChanged { count },
    );
    Ok(())
}

#[tauri::command]
pub async fn vault_search(
    query: String,
    scope: VaultScope,
    top_k: usize,
    mode: VaultSearchMode,
    state: State<'_, VaultState>,
) -> Result<Vec<VaultSearchResult>, String> {
    let vault = get_vault(&state).await?;
    match mode {
        VaultSearchMode::Fts => vault
            .fts_search(&query, &scope, top_k)
            .map_err(|e| e.to_string()),
        VaultSearchMode::Semantic => {
            // Semantic search lands in V1.2; fall back to FTS so the UI works today.
            vault
                .fts_search(&query, &scope, top_k)
                .map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
pub async fn vault_suggest_placement(
    _entry_id: String,
    _workspace_path: String,
    _state: State<'_, VaultState>,
) -> Result<Option<PlacementSuggestion>, String> {
    // Workspace-placement suggester lands in V2.
    Ok(None)
}

#[tauri::command]
pub async fn vault_accept_placement(
    entry_id: String,
    _target_path: String,
    mode: PlacementMode,
    _state: State<'_, VaultState>,
) -> Result<PlacementResult, String> {
    Ok(PlacementResult { entry_id, workspace_path: None, mode })
}

#[tauri::command]
pub async fn vault_reindex(
    _entry_id: String,
    _state: State<'_, VaultState>,
) -> Result<(), String> {
    // V1.2 will re-run the pipeline using the stored blob path.
    Err("vault_reindex: lands in V1.2 alongside embeddings".into())
}

#[tauri::command]
pub async fn vault_log_classifier_correction(
    _entry_id: String,
    _old_kind: EntryKind,
    _new_kind: EntryKind,
    _state: State<'_, VaultState>,
) -> Result<(), String> {
    // V1: no-op. V2 will append to `classifier_corrections.jsonl`.
    Ok(())
}

#[tauri::command]
pub async fn vault_unsorted_count(state: State<'_, VaultState>) -> Result<u32, String> {
    let vault = get_vault(&state).await?;
    Ok(vault.unsorted_count())
}
