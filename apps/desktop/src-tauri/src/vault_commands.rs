//! Vault command handlers.
//!
//! V1   : classifier + SQLite + FTS5 lexical search.
//! V1.2 : semantic embeddings (OpenAI `text-embedding-3-small`) with
//!        cosine-in-RAM search; best-effort embedding during ingest;
//!        backfill command for after-the-fact recovery.
//!
//! Shared embedding provider: the vault uses the same
//! `Arc<dyn EmbeddingProvider>` stored in `EmbeddingState`. Whenever a
//! command runs, we re-sync the provider (cheap — just an `Arc` clone)
//! so that adding an OpenAI key mid-session immediately unlocks semantic
//! retrieval for the vault.

use std::sync::Arc;

use solo_protocol::{
    BackendEvent, EntryKind, MemoryType, PlacementMode, PlacementResult, PlacementSuggestion,
    VaultEntry, VaultListFilters, VaultScope, VaultSearchMode, VaultSearchResult,
};
use solo_vault::{BackfillProgress, BackfillStats, Vault};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use crate::embedding_commands::EmbeddingState;

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

/// Resolve the singleton Vault, opening it if needed, and re-sync the
/// embedding provider from `EmbeddingState` on every call.
///
/// Provider-sync is O(1) (atomic read + compare) so doing it per command
/// avoids the user-adds-key-mid-session footgun without any measurable
/// overhead.
async fn get_vault(
    vault_state: &State<'_, VaultState>,
    embed_state: &State<'_, EmbeddingState>,
) -> Result<Arc<Vault>, String> {
    // Fast path — already-open vault.
    {
        let guard = vault_state.inner.read().await;
        if let Some(v) = guard.as_ref() {
            sync_provider(v, embed_state).await;
            return Ok(v.clone());
        }
    }
    // Slow path — open lazily.
    let mut guard = vault_state.inner.write().await;
    if let Some(v) = guard.as_ref() {
        sync_provider(v, embed_state).await;
        return Ok(v.clone());
    }
    let root = Vault::default_root();
    info!(root = %root.display(), "Opening vault");
    let v = Arc::new(Vault::open(root).map_err(|e| e.to_string())?);
    sync_provider(&v, embed_state).await;
    *guard = Some(v.clone());
    Ok(v)
}

/// Mirror the current `EmbeddingState::provider` onto the Vault.
/// Cheap: reads a tokio RwLock + an Arc clone. Logs only when the provider
/// transitions between present / absent.
async fn sync_provider(vault: &Vault, embed_state: &State<'_, EmbeddingState>) {
    let shared = embed_state.current_provider().await;
    match (&shared, vault.has_embedding_provider()) {
        (Some(_), false) => vault.set_embedding_provider(shared),
        (None, true) => vault.set_embedding_provider(None),
        _ => {} // no change
    }
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
    embed_state: State<'_, EmbeddingState>,
) -> Result<Vec<String>, String> {
    let vault = get_vault(&state, &embed_state).await?;
    debug!(
        count = paths.len(),
        has_provider = vault.has_embedding_provider(),
        "vault_drop_paths"
    );

    let results = vault.drop_paths(&paths, scope, memory_type).await;
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
    embed_state: State<'_, EmbeddingState>,
) -> Result<Vec<VaultEntry>, String> {
    let vault = get_vault(&state, &embed_state).await?;
    vault.list(&scope, &filters).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_get(
    entry_id: String,
    state: State<'_, VaultState>,
    embed_state: State<'_, EmbeddingState>,
) -> Result<Option<VaultEntry>, String> {
    let vault = get_vault(&state, &embed_state).await?;
    vault.get(&entry_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_update_tags(
    entry_id: String,
    tags: Vec<String>,
    app: AppHandle,
    state: State<'_, VaultState>,
    embed_state: State<'_, EmbeddingState>,
) -> Result<Option<VaultEntry>, String> {
    let vault = get_vault(&state, &embed_state).await?;
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
    embed_state: State<'_, EmbeddingState>,
) -> Result<Option<VaultEntry>, String> {
    let vault = get_vault(&state, &embed_state).await?;
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
    embed_state: State<'_, EmbeddingState>,
) -> Result<Option<VaultEntry>, String> {
    let vault = get_vault(&state, &embed_state).await?;
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
    embed_state: State<'_, EmbeddingState>,
) -> Result<Option<VaultEntry>, String> {
    let vault = get_vault(&state, &embed_state).await?;
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
    embed_state: State<'_, EmbeddingState>,
) -> Result<(), String> {
    let vault = get_vault(&state, &embed_state).await?;
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
    embed_state: State<'_, EmbeddingState>,
) -> Result<Vec<VaultSearchResult>, String> {
    let vault = get_vault(&state, &embed_state).await?;
    match mode {
        VaultSearchMode::Fts => vault
            .fts_search(&query, &scope, top_k)
            .map_err(|e| e.to_string()),
        VaultSearchMode::Semantic => vault
            .semantic_search(&query, &scope, top_k)
            .await
            .map_err(|e| e.to_string()),
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

/// Run the semantic-embeddings backfill over every chunk with a NULL
/// embedding. Streams `BackendEvent::VaultBackfillProgress` per batch so
/// the UI can render a "rebuilding index…" toast, and emits a final
/// event with `done = true` carrying totals.
///
/// Fails fast if no embedding provider is configured (caller must have
/// called `embedding_init` first — usually done automatically from the
/// frontend once an OpenAI key is present).
#[tauri::command]
pub async fn vault_backfill_embeddings(
    batch_size: Option<u32>,
    app: AppHandle,
    state: State<'_, VaultState>,
    embed_state: State<'_, EmbeddingState>,
) -> Result<VaultBackfillResult, String> {
    let vault = get_vault(&state, &embed_state).await?;
    if !vault.has_embedding_provider() {
        warn!("vault_backfill_embeddings: no provider — aborting");
        return Err(
            "No embedding provider configured. Add an OpenAI key in Settings first."
                .to_string(),
        );
    }

    // Emit a progress event per batch. The closure clones the AppHandle
    // cheaply and writes through tauri's MPSC channel.
    let app_handle = app.clone();
    let batch = batch_size.unwrap_or(64).max(1) as usize;
    info!(batch, "vault_backfill_embeddings.start");

    let stats: BackfillStats = vault
        .backfill_embeddings(batch, move |progress: BackfillProgress| {
            let _ = app_handle.emit(
                "backend-event",
                BackendEvent::VaultBackfillProgress {
                    total: progress.total,
                    completed: progress.completed,
                    failed: progress.failed,
                    elapsed_ms: progress.elapsed_ms,
                    done: progress.done,
                },
            );
        })
        .await
        .map_err(|e| e.to_string())?;

    info!(
        total = stats.total,
        embedded = stats.embedded,
        failed = stats.failed,
        retries = stats.retries,
        total_ms = stats.total_ms,
        "vault_backfill_embeddings.done"
    );

    Ok(VaultBackfillResult {
        total: stats.total,
        embedded: stats.embedded,
        failed: stats.failed,
        retries: stats.retries,
        total_ms: stats.total_ms,
    })
}

/// Count of chunks still awaiting an embedding. Used to badge the
/// "Rebuild embeddings" button in the UI.
#[tauri::command]
pub async fn vault_pending_embeddings_count(
    state: State<'_, VaultState>,
    embed_state: State<'_, EmbeddingState>,
) -> Result<u64, String> {
    let vault = get_vault(&state, &embed_state).await?;
    vault.pending_embeddings_count().map_err(|e| e.to_string())
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
pub async fn vault_unsorted_count(
    state: State<'_, VaultState>,
    embed_state: State<'_, EmbeddingState>,
) -> Result<u32, String> {
    let vault = get_vault(&state, &embed_state).await?;
    Ok(vault.unsorted_count())
}

// =============================================================================
// Response types
// =============================================================================

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultBackfillResult {
    pub total: u64,
    pub embedded: u64,
    pub failed: u64,
    pub retries: u64,
    pub total_ms: u64,
}
