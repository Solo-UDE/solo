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
    BackendEvent, CloudSyncState, EntryKind, IndexStatus, MemoryType, PlacementMode,
    PlacementResult, PlacementSuggestion, RetrievalStats, VaultChunk, VaultEntry, VaultListFilters,
    VaultRetrievalSource, VaultScope, VaultSearchMode, VaultSearchResult,
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

fn set_cloud_sync_state(vault: &Vault, app: &AppHandle, entry_id: &str, state: CloudSyncState) {
    match vault.update_cloud_sync_state(entry_id, state) {
        Ok(()) => {
            let _ = app.emit(
                "backend-event",
                BackendEvent::VaultCloudSyncUpdated {
                    entry_id: entry_id.to_string(),
                    state,
                },
            );
        }
        Err(error) => {
            warn!(entry_id = %entry_id, state = ?state, error = %error, "vault_sync: local state update failed");
        }
    }
}

#[derive(serde::Serialize)]
struct CloudVaultSearchBody<'a> {
    query: &'a str,
    limit: usize,
    mode: VaultSearchMode,
    scope_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    scope_project_id: Option<&'a str>,
}

#[derive(serde::Deserialize)]
struct CloudVaultSearchResponse {
    results: Vec<CloudVaultSearchRow>,
    cloud_error: Option<String>,
}

#[derive(serde::Deserialize)]
struct CloudVaultSearchRow {
    chunk_id: String,
    chunk_index: u32,
    snippet: String,
    score: f32,
    source: Option<VaultRetrievalSource>,
    mode: Option<VaultSearchMode>,
    embedding_model: Option<String>,
    entry: CloudVaultEntryRow,
}

#[derive(serde::Deserialize)]
struct CloudVaultEntryRow {
    id: String,
    kind: EntryKind,
    subkind: Option<String>,
    title: String,
    content: Option<String>,
    source_path: Option<String>,
    vault_blob_path: Option<String>,
    scope_type: String,
    scope_project_id: Option<String>,
    memory_type: MemoryType,
    pinned: i64,
    tags: String,
    mime: Option<String>,
    size_bytes: Option<u64>,
    index_status: IndexStatus,
    cloud_sync_state: CloudSyncState,
    classifier_confidence: f32,
    hit_count: u32,
    last_retrieved_at: Option<u64>,
    created_at: u64,
    updated_at: u64,
}

impl CloudVaultEntryRow {
    fn into_entry(self) -> VaultEntry {
        let scope = if self.scope_type == "project" {
            VaultScope::Project {
                project_id: self.scope_project_id.unwrap_or_default(),
            }
        } else {
            VaultScope::Global
        };
        let tags = serde_json::from_str::<Vec<String>>(&self.tags).unwrap_or_default();

        VaultEntry {
            id: self.id,
            kind: self.kind,
            subkind: self.subkind,
            title: self.title,
            content: self.content,
            source_path: self.source_path,
            vault_blob_path: self.vault_blob_path,
            scope,
            memory_type: self.memory_type,
            pinned: self.pinned != 0,
            tags,
            mime: self.mime,
            size_bytes: self.size_bytes,
            index_status: self.index_status,
            cloud_sync_state: self.cloud_sync_state,
            classifier_confidence: self.classifier_confidence,
            retrieval_stats: RetrievalStats {
                hit_count: self.hit_count,
                last_retrieved_at: self.last_retrieved_at,
            },
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

fn search_body<'a>(
    query: &'a str,
    scope: &'a VaultScope,
    top_k: usize,
    mode: VaultSearchMode,
) -> CloudVaultSearchBody<'a> {
    match scope {
        VaultScope::Global => CloudVaultSearchBody {
            query,
            limit: top_k,
            mode,
            scope_type: "global",
            scope_project_id: None,
        },
        VaultScope::Project { project_id } => CloudVaultSearchBody {
            query,
            limit: top_k,
            mode,
            scope_type: "project",
            scope_project_id: Some(project_id.as_str()),
        },
    }
}

async fn remote_search_vault(
    token: &str,
    query: &str,
    scope: &VaultScope,
    top_k: usize,
    mode: VaultSearchMode,
) -> Result<Vec<VaultSearchResult>, String> {
    let base = crate::desktop_config::vault_api_endpoint();
    let url = format!("{}/vault/search", base.trim_end_matches('/'));
    let body = search_body(query, scope, top_k, mode);
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("vault cloud search: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("vault cloud search failed ({status}): {body_text}"));
    }

    let parsed = resp
        .json::<CloudVaultSearchResponse>()
        .await
        .map_err(|e| format!("vault cloud search parse: {e}"))?;
    if let Some(error) = parsed.cloud_error.as_deref() {
        warn!(error = %error, "vault.search.cloud_partial_error");
    }

    Ok(parsed
        .results
        .into_iter()
        .map(|row| {
            let entry = row.entry.into_entry();
            VaultSearchResult {
                chunk: VaultChunk {
                    id: row.chunk_id,
                    entry_id: entry.id.clone(),
                    chunk_index: row.chunk_index,
                    content: row.snippet,
                    token_count: None,
                },
                entry,
                source: row.source.unwrap_or(VaultRetrievalSource::Cloud),
                mode: row.mode.unwrap_or(mode),
                embedding_model: row.embedding_model,
                score: row.score,
            }
        })
        .collect())
}

struct FusedVaultSearchResult {
    result: VaultSearchResult,
    fused_score: f32,
}

fn fuse_search_results(
    lists: Vec<Vec<VaultSearchResult>>,
    mode: VaultSearchMode,
    mark_cross_source_duplicates: bool,
    top_k: usize,
) -> Vec<VaultSearchResult> {
    const RRF_K: f32 = 60.0;
    let mut fused: std::collections::HashMap<String, FusedVaultSearchResult> =
        std::collections::HashMap::new();

    for list in lists {
        for (index, mut result) in list.into_iter().enumerate() {
            result.mode = mode;
            let key = format!("{}:{}", result.entry.id, result.chunk.chunk_index);
            let contribution = 1.0 / (RRF_K + index as f32 + 1.0);
            if let Some(existing) = fused.get_mut(&key) {
                existing.fused_score += contribution;
                if matches!(existing.result.source, VaultRetrievalSource::Cloud)
                    && matches!(result.source, VaultRetrievalSource::Local)
                {
                    std::mem::swap(&mut existing.result, &mut result);
                }
                if mark_cross_source_duplicates && existing.result.source != result.source {
                    existing.result.source = VaultRetrievalSource::Hybrid;
                }
            } else {
                fused.insert(
                    key,
                    FusedVaultSearchResult {
                        result,
                        fused_score: contribution,
                    },
                );
            }
        }
    }

    let mut out = fused.into_values().collect::<Vec<_>>();
    out.sort_by(|a, b| {
        b.fused_score
            .partial_cmp(&a.fused_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                b.result
                    .score
                    .partial_cmp(&a.result.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| {
                format!("{}:{}", a.result.entry.id, a.result.chunk.chunk_index).cmp(&format!(
                    "{}:{}",
                    b.result.entry.id, b.result.chunk.chunk_index
                ))
            })
    });
    let top_score = out.first().map_or(1.0, |r| r.fused_score);
    out.into_iter()
        .take(top_k)
        .map(|mut item| {
            item.result.score = if top_score > 0.0 {
                item.fused_score / top_score
            } else {
                0.0
            };
            item.result
        })
        .collect()
}

async fn local_search_vault(
    vault: &Vault,
    query: &str,
    scope: &VaultScope,
    top_k: usize,
    mode: VaultSearchMode,
) -> Result<Vec<VaultSearchResult>, String> {
    match mode {
        VaultSearchMode::Fts => vault
            .fts_search(query, scope, top_k)
            .map_err(|e| e.to_string()),
        VaultSearchMode::Semantic => vault
            .semantic_search(query, scope, top_k)
            .await
            .map_err(|e| e.to_string()),
        VaultSearchMode::Hybrid => {
            let fts = vault
                .fts_search(query, scope, top_k)
                .map_err(|e| e.to_string())?;
            let semantic = vault
                .semantic_search(query, scope, top_k)
                .await
                .map_err(|e| e.to_string())?;
            Ok(fuse_search_results(vec![fts, semantic], mode, false, top_k))
        }
    }
}

fn upload_filename(entry: &VaultEntry) -> String {
    entry
        .source_path
        .as_deref()
        .and_then(|source| {
            std::path::Path::new(source)
                .file_name()
                .and_then(|n| n.to_str())
        })
        .or_else(|| {
            entry.vault_blob_path.as_deref().and_then(|blob| {
                std::path::Path::new(blob)
                    .file_name()
                    .and_then(|n| n.to_str())
            })
        })
        .unwrap_or("file")
        .to_string()
}

async fn remote_entry_for_sync(
    token: &str,
    entry: &VaultEntry,
) -> Result<
    (
        String,
        Option<crate::vault_sync_commands::RemoteEntryStatus>,
    ),
    String,
> {
    match crate::vault_sync_commands::remote_try_get_entry_status(token, &entry.id).await {
        Ok(Some(status)) => {
            let remote_id = status.id.clone();
            Ok((remote_id, Some(status)))
        }
        Ok(None) => match crate::vault_sync_commands::remote_create_entry(token, entry).await {
            Ok(remote_id) => Ok((remote_id, None)),
            Err(create_error) => {
                match crate::vault_sync_commands::remote_try_get_entry_status(token, &entry.id)
                    .await
                {
                    Ok(Some(status)) => {
                        let remote_id = status.id.clone();
                        Ok((remote_id, Some(status)))
                    }
                    Ok(None) | Err(_) => Err(create_error),
                }
            }
        },
        Err(status_error) => Err(status_error),
    }
}

async fn sync_entry_to_cloud(
    vault: &Vault,
    app: &AppHandle,
    token: &str,
    entry: &VaultEntry,
) -> Result<CloudSyncState, String> {
    set_cloud_sync_state(vault, app, &entry.id, CloudSyncState::Pending);

    let (remote_id, existing_status) = match remote_entry_for_sync(token, entry).await {
        Ok(result) => result,
        Err(error) => {
            set_cloud_sync_state(vault, app, &entry.id, CloudSyncState::Failed);
            return Err(error);
        }
    };

    if let Some(status) = existing_status.as_ref() {
        let resolved = status.resolved_cloud_sync_state();
        if matches!(resolved, CloudSyncState::Synced) {
            set_cloud_sync_state(vault, app, &entry.id, resolved);
            return Ok(resolved);
        }
        if matches!(status.cloud_sync_state, CloudSyncState::IndexingRemote) {
            set_cloud_sync_state(vault, app, &entry.id, resolved);
            let status = crate::vault_sync_commands::remote_poll_entry_until_terminal(
                token,
                &remote_id,
                100,
                std::time::Duration::from_secs(3),
            )
            .await?;
            let resolved = status.resolved_cloud_sync_state();
            info!(
                entry_id = %entry.id,
                remote_entry_id = %status.id,
                index_status = ?status.index_status,
                cloud_sync_state = ?status.cloud_sync_state,
                resolved_cloud_sync_state = ?resolved,
                chunk_count = ?status.chunk_count,
                index_error = ?status.index_error,
                "vault_sync: existing remote terminal status"
            );
            set_cloud_sync_state(vault, app, &entry.id, resolved);
            return Ok(resolved);
        }
    }

    let Some(blob_path) = entry.vault_blob_path.as_deref() else {
        set_cloud_sync_state(vault, app, &entry.id, CloudSyncState::Synced);
        return Ok(CloudSyncState::Synced);
    };

    let filename = upload_filename(entry);
    let content_type = entry.mime.as_deref().unwrap_or("application/octet-stream");
    set_cloud_sync_state(vault, app, &entry.id, CloudSyncState::Uploading);

    let upload = match crate::vault_sync_commands::remote_request_upload_url(
        token,
        &remote_id,
        &filename,
        content_type,
    )
    .await
    {
        Ok(upload) => {
            info!(
                entry_id = %entry.id,
                %remote_id,
                s3_key = %upload.s3_key,
                content_type = %upload.content_type,
                expires_in = upload.expires_in,
                "vault_sync: upload url ok"
            );
            upload
        }
        Err(error) => {
            set_cloud_sync_state(vault, app, &entry.id, CloudSyncState::Failed);
            return Err(error);
        }
    };

    if let Err(error) = crate::vault_sync_commands::upload_file_to_s3(
        &upload.upload_url,
        blob_path,
        &upload.content_type,
    )
    .await
    {
        set_cloud_sync_state(vault, app, &entry.id, CloudSyncState::Failed);
        return Err(error);
    }

    info!(
        entry_id = %entry.id,
        %remote_id,
        s3_key = %upload.s3_key,
        "vault_sync: s3 upload ok"
    );

    let complete =
        match crate::vault_sync_commands::remote_complete_upload(token, &remote_id, &upload.s3_key)
            .await
        {
            Ok(complete) => {
                info!(
                    entry_id = %entry.id,
                    remote_entry_id = %complete.entry_id,
                    s3_key = %complete.s3_key,
                    index_status = ?complete.index_status,
                    cloud_sync_state = ?complete.cloud_sync_state,
                    indexing_started = complete.indexing_started,
                    "vault_sync: upload complete ok"
                );
                complete
            }
            Err(error) => {
                set_cloud_sync_state(vault, app, &entry.id, CloudSyncState::Failed);
                return Err(error);
            }
        };

    let complete_state = complete.resolved_cloud_sync_state();
    set_cloud_sync_state(vault, app, &entry.id, complete_state);
    if matches!(
        complete_state,
        CloudSyncState::Synced | CloudSyncState::Failed
    ) {
        return Ok(complete_state);
    }

    let status = crate::vault_sync_commands::remote_poll_entry_until_terminal(
        token,
        &remote_id,
        100,
        std::time::Duration::from_secs(3),
    )
    .await?;
    let resolved = status.resolved_cloud_sync_state();
    info!(
        entry_id = %entry.id,
        remote_entry_id = %status.id,
        index_status = ?status.index_status,
        cloud_sync_state = ?status.cloud_sync_state,
        resolved_cloud_sync_state = ?resolved,
        chunk_count = ?status.chunk_count,
        index_error = ?status.index_error,
        "vault_sync: remote terminal status"
    );
    set_cloud_sync_state(vault, app, &entry.id, resolved);
    Ok(resolved)
}

// =============================================================================
// Commands
// =============================================================================

#[tauri::command]
pub async fn vault_drop_paths(
    paths: Vec<String>,
    scope: VaultScope,
    memory_type: MemoryType,
    sync_to_cloud: bool,
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
                    BackendEvent::VaultEntryAdded {
                        entry_id: entry.id.clone(),
                    },
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

    if !sync_to_cloud {
        return Ok(ids);
    }

    // fire-and-forget: best-effort remote sync
    let token = crate::auth_commands::fresh_id_token_snapshot(&auth_state, &provider_auth).await;
    if token.is_none() {
        warn!("vault_sync: no fresh id token, skipping remote sync");
    }
    let vault_clone = vault.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(token) = token {
            for entry in &ingested_entries {
                match sync_entry_to_cloud(&vault_clone, &app_clone, &token, entry).await {
                    Ok(state) => {
                        info!(entry_id = %entry.id, cloud_sync_state = ?state, "vault_sync: entry sync done");
                    }
                    Err(error) => {
                        warn!(entry_id = %entry.id, error = %error, "vault_sync: entry sync failed");
                    }
                }
            }
        }
    });

    Ok(ids)
}

#[tauri::command]
pub async fn vault_add_text(
    text: String,
    title: Option<String>,
    scope: VaultScope,
    memory_type: MemoryType,
    sync_to_cloud: bool,
    app: AppHandle,
    state: State<'_, VaultState>,
    auth_state: State<'_, crate::auth_commands::AuthState>,
    provider_auth: State<'_, crate::provider_commands::ProviderAuthState>,
) -> Result<VaultEntry, String> {
    let vault = get_vault(&state).await?;
    let entry = vault
        .add_text_entry(&text, title, scope, memory_type)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "backend-event",
        BackendEvent::VaultEntryAdded {
            entry_id: entry.id.clone(),
        },
    );
    let count = vault.unsorted_count();
    let _ = app.emit(
        "backend-event",
        BackendEvent::VaultUnsortedCountChanged { count },
    );

    if sync_to_cloud {
        let token =
            crate::auth_commands::fresh_id_token_snapshot(&auth_state, &provider_auth).await;
        if token.is_none() {
            warn!("vault_add_text: no fresh id token, skipping remote sync");
        }
        let vault_clone = vault.clone();
        let app_clone = app.clone();
        let entry_clone = entry.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(token) = token {
                match sync_entry_to_cloud(&vault_clone, &app_clone, &token, &entry_clone).await {
                    Ok(state) => {
                        info!(entry_id = %entry_clone.id, cloud_sync_state = ?state, "vault_add_text: entry sync done");
                    }
                    Err(error) => {
                        warn!(entry_id = %entry_clone.id, error = %error, "vault_add_text: entry sync failed");
                    }
                }
            }
        });
    }

    Ok(entry)
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
pub async fn vault_sync_entry(
    entry_id: String,
    app: AppHandle,
    state: State<'_, VaultState>,
    auth_state: State<'_, crate::auth_commands::AuthState>,
    provider_auth: State<'_, crate::provider_commands::ProviderAuthState>,
) -> Result<Option<VaultEntry>, String> {
    let vault = get_vault(&state).await?;
    let Some(entry) = vault.get(&entry_id).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let token = crate::auth_commands::fresh_id_token_snapshot(&auth_state, &provider_auth)
        .await
        .ok_or_else(|| "Sign in to Solo before syncing vault entries to cloud.".to_string())?;

    sync_entry_to_cloud(&vault, &app, &token, &entry).await?;
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
    let updated = vault
        .update_tags(&entry_id, &tags)
        .map_err(|e| e.to_string())?;
    if updated.is_some() {
        let _ = app.emit(
            "backend-event",
            BackendEvent::VaultEntryUpdated { entry_id },
        );
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
    let updated = vault
        .set_pinned(&entry_id, pinned)
        .map_err(|e| e.to_string())?;
    if updated.is_some() {
        let _ = app.emit(
            "backend-event",
            BackendEvent::VaultEntryUpdated { entry_id },
        );
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
    let updated = vault
        .move_scope(&entry_id, &new_scope)
        .map_err(|e| e.to_string())?;
    if updated.is_some() {
        let _ = app.emit(
            "backend-event",
            BackendEvent::VaultEntryUpdated { entry_id },
        );
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
    let updated = vault
        .move_bucket(&entry_id, new_kind)
        .map_err(|e| e.to_string())?;
    if updated.is_some() {
        let _ = app.emit(
            "backend-event",
            BackendEvent::VaultEntryUpdated { entry_id },
        );
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
    also_remote: bool,
    app: AppHandle,
    state: State<'_, VaultState>,
    auth_state: State<'_, crate::auth_commands::AuthState>,
    provider_auth: State<'_, crate::provider_commands::ProviderAuthState>,
) -> Result<(), String> {
    let vault = get_vault(&state).await?;
    if also_remote {
        info!(entry_id = %entry_id, "vault_delete: remote delete requested");
        match crate::auth_commands::fresh_id_token_snapshot(&auth_state, &provider_auth).await {
            Some(token) => {
                match crate::vault_sync_commands::remote_delete_entry(&token, &entry_id).await {
                    Ok(()) => {
                        info!(entry_id = %entry_id, "vault_delete: remote delete ok");
                    }
                    Err(error) => {
                        warn!(
                            entry_id = %entry_id,
                            error = %error,
                            "vault_delete: remote delete failed; deleting local entry anyway"
                        );
                    }
                }
            }
            None => {
                warn!(
                    entry_id = %entry_id,
                    "vault_delete: no Cognito session for remote delete; deleting local entry anyway"
                );
            }
        }
    }
    vault.delete(&entry_id).map_err(|e| e.to_string())?;
    let _ = app.emit(
        "backend-event",
        BackendEvent::VaultEntryDeleted {
            entry_id: entry_id.clone(),
        },
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
    app: AppHandle,
    state: State<'_, VaultState>,
    auth_state: State<'_, crate::auth_commands::AuthState>,
    provider_auth: State<'_, crate::provider_commands::ProviderAuthState>,
    source: VaultRetrievalSource,
) -> Result<Vec<VaultSearchResult>, String> {
    let vault = get_vault(&state).await?;
    match source {
        VaultRetrievalSource::Local => {
            local_search_vault(&vault, &query, &scope, top_k, mode).await
        }
        VaultRetrievalSource::Cloud => {
            let token = crate::auth_commands::fresh_id_token_snapshot(&auth_state, &provider_auth)
                .await
                .ok_or_else(|| "Sign in to search cloud vault entries".to_string())?;
            remote_search_vault(&token, &query, &scope, top_k, mode).await
        }
        VaultRetrievalSource::Hybrid => {
            let local = local_search_vault(&vault, &query, &scope, top_k, mode).await?;
            let Some(token) =
                crate::auth_commands::fresh_id_token_snapshot(&auth_state, &provider_auth).await
            else {
                let _ = app.emit(
                    "backend-event",
                    BackendEvent::VaultRetrievalWarning {
                        message: "Cloud retrieval skipped: sign in required".to_string(),
                    },
                );
                return Ok(local);
            };
            match remote_search_vault(&token, &query, &scope, top_k, mode).await {
                Ok(cloud) => Ok(fuse_search_results(vec![local, cloud], mode, true, top_k)),
                Err(error) => {
                    warn!(error = %error, "vault.search.cloud_degraded_to_local");
                    let _ = app.emit(
                        "backend-event",
                        BackendEvent::VaultRetrievalWarning {
                            message: "Cloud retrieval failed; showing local matches".to_string(),
                        },
                    );
                    Ok(local)
                }
            }
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
    Ok(PlacementResult {
        entry_id,
        workspace_path: None,
        mode,
    })
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
            "Local embedding model is still loading. Try again in a few seconds.".to_string(),
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
pub async fn vault_pending_embeddings_count(state: State<'_, VaultState>) -> Result<u64, String> {
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
pub async fn vault_unsorted_count(state: State<'_, VaultState>) -> Result<u32, String> {
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
