//! Vault command handlers.
//!
//! V1    : classifier + SQLite + FTS5 lexical search.
//! V1.2  : semantic embeddings + cosine-in-RAM search; best-effort embed
//!         during ingest; backfill command for post-hoc recovery.
//! V1.2.1: **local** embeddings via `fastembed-rs` (`all-MiniLM-L6-v2`,
//!         384 dims, ~90 MB model lazy-downloaded to
//!         `~/.solo/vault/models/`). Zero API keys, zero per-user cost,
//!         zero network per query. The first-ever vault interaction kicks
//!         off a background task to pull the model; the UI stays
//!         responsive throughout and FTS keeps working.

use std::sync::Arc;

use solo_protocol::{
    BackendEvent, CloudSyncState, EntryKind, MemoryType, PlacementMode, PlacementResult,
    PlacementSuggestion, VaultEntry, VaultListFilters, VaultScope, VaultSearchMode,
    VaultSearchResult,
};
use solo_vault::{BackfillProgress, BackfillStats, ReextractProgress, ReextractStats, Vault};
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

/// Resolve the singleton Vault, opening it lazily on first call. After
/// the very first open we also kick off a background task to download +
/// load the local embedding model — subsequent calls are no-ops.
async fn get_vault(vault_state: &State<'_, VaultState>) -> Result<Arc<Vault>, String> {
    // Fast path — already-open vault.
    {
        let guard = vault_state.inner.read().await;
        if let Some(v) = guard.as_ref() {
            return Ok(v.clone());
        }
    }
    // Slow path — open lazily.
    let mut guard = vault_state.inner.write().await;
    if let Some(v) = guard.as_ref() {
        return Ok(v.clone());
    }
    let root = Vault::default_root();
    info!(root = %root.display(), "Opening vault");
    let v = Arc::new(Vault::open(root).map_err(|e| e.to_string())?);
    *guard = Some(v.clone());
    // Non-blocking model load. If the user's offline or the first download
    // is in progress, FTS still works and ingest succeeds; semantic search
    // activates as soon as the model lands.
    v.spawn_local_embedder_load();
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
    auth_state: State<'_, crate::auth_commands::AuthState>,
    provider_auth: State<'_, crate::provider_commands::ProviderAuthState>,
) -> Result<Vec<String>, String> {
    let vault = get_vault(&state).await?;
    debug!(
        count = paths.len(),
        has_provider = vault.has_embedding_provider(),
        "vault_drop_paths"
    );

    let results = vault.drop_paths(&paths, scope, memory_type).await;
    let mut ids = Vec::with_capacity(results.len());
    let mut ingested_entries: Vec<VaultEntry> = Vec::new();

    for res in results {
        match res {
            Ok(entry) => {
                let _ = app.emit(
                    "backend-event",
                    BackendEvent::VaultEntryAdded { entry_id: entry.id.clone() },
                );
                ids.push(entry.id.clone());
                ingested_entries.push(entry);
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

    // fire-and-forget: best-effort remote sync
    let token = crate::auth_commands::fresh_id_token_snapshot(&auth_state, &provider_auth).await;
    if token.is_none() {
        warn!("vault_sync: no fresh id token, skipping remote sync");
    }
    let vault_clone = vault.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(token) = token {
            for entry in &ingested_entries {
                match crate::vault_sync_commands::remote_create_entry(&token, entry).await {
                    Ok(remote_id) => {
                        info!(entry_id = %entry.id, %remote_id, "vault_sync: remote create ok");
                        // Upload file to S3 if there is a local blob
                        if let Some(blob_path) = &entry.vault_blob_path {
                            let filename = entry.source_path.as_deref()
                                .and_then(|source| {
                                    std::path::Path::new(source)
                                        .file_name()
                                        .and_then(|n| n.to_str())
                                })
                                .or_else(|| {
                                    std::path::Path::new(blob_path)
                                        .file_name()
                                        .and_then(|n| n.to_str())
                                })
                                .unwrap_or("file");
                            let content_type = entry
                                .mime
                                .as_deref()
                                .unwrap_or("application/octet-stream");
                            match crate::vault_sync_commands::remote_request_upload_url(
                                &token, &remote_id, filename, content_type,
                            ).await {
                                Ok((presigned_url, content_type)) => {
                                    match crate::vault_sync_commands::upload_file_to_s3(
                                        &presigned_url, blob_path, &content_type,
                                    ).await {
                                        Ok(()) => {
                                            info!(entry_id = %entry.id, "vault_sync: s3 upload ok");
                                            let _ = vault_clone.update_cloud_sync_state(&entry.id, CloudSyncState::Synced);
                                        }
                                        Err(e) => warn!(entry_id = %entry.id, error = %e, "vault_sync: s3 upload failed"),
                                    }
                                }
                                Err(e) => warn!(entry_id = %entry.id, error = %e, "vault_sync: upload url failed"),
                            }
                        } else {
                            let _ = vault_clone.update_cloud_sync_state(&entry.id, CloudSyncState::Synced);
                        }
                    }
                    Err(e) => {
                        warn!(entry_id = %entry.id, error = %e, "vault_sync: remote create failed");
                    }
                }
            }
        }
    });

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
    let updated = vault.move_scope(&entry_id, &new_scope).map_err(|e| e.to_string())?;
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
) -> Result<VaultBackfillResult, String> {
    let vault = get_vault(&state).await?;
    if !vault.has_embedding_provider() {
        warn!("vault_backfill_embeddings: local model not loaded yet — aborting");
        return Err(
            "Local embedding model is still loading. Try again in a few seconds."
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
) -> Result<u64, String> {
    let vault = get_vault(&state).await?;
    vault.pending_embeddings_count().map_err(|e| e.to_string())
}

/// Re-run local text extraction for legacy entries that are marked indexed
/// but have zero chunks or raw binary-garbage chunks. This is the migration
/// path for PDFs/documents/data files dropped before binary extractors existed.
#[tauri::command]
pub async fn vault_reextract(
    batch_size: Option<u32>,
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Result<VaultReextractResult, String> {
    let vault = get_vault(&state).await?;
    let app_handle = app.clone();
    let batch = batch_size.unwrap_or(16).max(1) as usize;
    info!(batch, "vault_reextract.start");

    let stats: ReextractStats = vault
        .reextract_legacy_entries(batch, move |progress: ReextractProgress| {
            let _ = app_handle.emit(
                "backend-event",
                BackendEvent::VaultReextractProgress {
                    total: progress.total,
                    completed: progress.completed,
                    recovered: progress.recovered,
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
        recovered = stats.recovered,
        failed = stats.failed,
        embedded = stats.embedded,
        total_ms = stats.total_ms,
        "vault_reextract.done"
    );

    Ok(VaultReextractResult {
        total: stats.total,
        recovered: stats.recovered,
        failed: stats.failed,
        embedded: stats.embedded,
        total_ms: stats.total_ms,
    })
}

#[tauri::command]
pub async fn vault_pending_reextract_count(state: State<'_, VaultState>) -> Result<u64, String> {
    let vault = get_vault(&state).await?;
    vault.pending_reextract_count().map_err(|e| e.to_string())
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
) -> Result<u32, String> {
    let vault = get_vault(&state).await?;
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

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultReextractResult {
    pub total: u64,
    pub recovered: u64,
    pub failed: u64,
    pub embedded: u64,
    pub total_ms: u64,
}
