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
//! V1.2: local `SQLite` store with `FTS5` lexical + cosine-in-RAM semantic
//! search. Embeddings are best-effort during ingest; recoverable via
//! `backfill_embeddings`. Cloud sync and OCR land later.

pub mod classifier;
pub mod extractors;
pub mod local_embed;
pub mod memory;
pub mod pipeline;
pub mod placement;
pub mod store;
pub mod sync;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use solo_embeddings::EmbeddingProvider;
use thiserror::Error;
use tracing::{debug, info, warn};

pub use solo_protocol::{
    CloudSyncState, EntryKind, IndexStatus, MemoryType, PlacementMode, PlacementResult,
    PlacementSuggestion, RetrievalStats, VaultChunk, VaultEntry, VaultListFilters,
    VaultRetrievalSource, VaultScope, VaultSearchMode, VaultSearchResult,
};

use crate::extractors::{LocalTextExtractor, TextExtractor};
pub use crate::pipeline::EmbedStats;
use crate::store::{Store, EMBEDDING_DIM};

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

/// Progress tick emitted by `backfill_embeddings` between batches so the
/// UI can render a "rebuilding index" toast.
#[derive(Debug, Clone, Copy)]
pub struct BackfillProgress {
    pub total: u64,
    pub completed: u64,
    pub failed: u64,
    pub elapsed_ms: u64,
    pub done: bool,
}

/// Terminal stats for a backfill run. Returned from `backfill_embeddings`
/// so callers can log / surface in UI.
#[derive(Debug, Clone, Copy, Default)]
pub struct BackfillStats {
    pub total: u64,
    pub embedded: u64,
    pub failed: u64,
    pub retries: u64,
    pub total_ms: u64,
}

/// Progress tick emitted by `reextract_legacy_entries`.
#[derive(Debug, Clone, Copy)]
pub struct ReextractProgress {
    pub total: u64,
    pub completed: u64,
    pub recovered: u64,
    pub failed: u64,
    pub elapsed_ms: u64,
    pub done: bool,
}

/// Terminal stats for a re-extraction run.
#[derive(Debug, Clone, Copy, Default)]
pub struct ReextractStats {
    pub total: u64,
    pub recovered: u64,
    pub failed: u64,
    pub embedded: u64,
    pub total_ms: u64,
}

pub struct Vault {
    pub root: PathBuf,
    store: Store,
    /// Pluggable text extractor. Defaults to local parsers; cloud sync can
    /// install a remote/chained extractor without changing ingest callers.
    text_extractor: RwLock<Arc<dyn TextExtractor>>,
    /// Interior-mutable so `vault_commands` can inject / swap the provider
    /// after the vault has been wrapped in an `Arc` (e.g. when the user
    /// adds their `OpenAI` key mid-session).
    embed_provider: RwLock<Option<Arc<dyn EmbeddingProvider>>>,
    /// Rate-limits the "semantic search without a provider" warning to one
    /// per session so logs stay readable.
    no_provider_warned: AtomicBool,
}

impl Vault {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        let store = Store::open(root.join("index.sqlite"))?;
        Ok(Self {
            root,
            store,
            text_extractor: RwLock::new(Arc::new(LocalTextExtractor)),
            embed_provider: RwLock::new(None),
            no_provider_warned: AtomicBool::new(false),
        })
    }

    /// Attach an embedding provider to this vault. Consumes & returns
    /// `self` so it composes in a builder chain on `Vault::open(...)?`.
    #[must_use]
    pub fn with_embedding_provider(self, provider: Arc<dyn EmbeddingProvider>) -> Self {
        self.set_embedding_provider(Some(provider));
        self
    }

    /// Replace (or clear) the embedding provider after construction. This
    /// takes `&self` (uses interior mutability) so it works through an
    /// `Arc<Vault>`.
    pub fn set_embedding_provider(&self, provider: Option<Arc<dyn EmbeddingProvider>>) {
        if let Some(p) = provider.as_deref() {
            info!(
                model = p.model_name(),
                dim = p.dimensions(),
                "vault.provider.attached"
            );
        } else {
            info!("vault.provider.cleared");
        }
        *self
            .embed_provider
            .write()
            .expect("vault provider lock poisoned") = provider;
        self.no_provider_warned.store(false, Ordering::Relaxed);
    }

    fn current_provider(&self) -> Option<Arc<dyn EmbeddingProvider>> {
        self.embed_provider
            .read()
            .expect("vault provider lock poisoned")
            .clone()
    }

    pub fn set_text_extractor(&self, extractor: Arc<dyn TextExtractor>) {
        info!(extractor = extractor.name(), "vault.extractor.attached");
        *self
            .text_extractor
            .write()
            .expect("vault extractor lock poisoned") = extractor;
    }

    fn current_text_extractor(&self) -> Arc<dyn TextExtractor> {
        self.text_extractor
            .read()
            .expect("vault extractor lock poisoned")
            .clone()
    }

    pub fn has_embedding_provider(&self) -> bool {
        self.embed_provider
            .read()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    /// Kick off a background tokio task to download (if missing) and load
    /// the local embedding model from `<root>/models/`. Fire-and-forget —
    /// the Vault stays fully usable during the download; once ready the
    /// task calls `set_embedding_provider` and semantic search activates.
    ///
    /// Safe to call multiple times: no-op if a provider is already attached
    /// or a load is already in flight (we rely on the `SetOnce` pattern —
    /// `set_embedding_provider` is idempotent when called with the same
    /// provider, and callers should only invoke this once per vault open).
    pub fn spawn_local_embedder_load(self: &std::sync::Arc<Self>) {
        if self.has_embedding_provider() {
            debug!("vault.local_embed.already_attached");
            return;
        }
        let vault = self.clone();
        let root = vault.root.clone();
        tokio::spawn(async move {
            match crate::local_embed::LocalEmbeddingProvider::load(&root).await {
                Ok(provider) => {
                    vault.set_embedding_provider(Some(std::sync::Arc::new(provider)));
                }
                Err(e) => {
                    warn!(err = %e, "vault.local_embed.load_failed (semantic will fall back to fts)");
                }
            }
        });
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

    pub async fn drop_paths(
        &self,
        paths: &[String],
        scope: VaultScope,
        memory_type: MemoryType,
        label_ids: Vec<String>,
        expires_at: Option<u64>,
    ) -> Vec<Result<VaultEntry>> {
        let blobs = self.blobs_dir();
        let provider = self.current_provider();
        let extractor = self.current_text_extractor();
        let mut out = Vec::with_capacity(paths.len());
        for p in paths {
            let res = pipeline::ingest_and_store(
                Path::new(p),
                &blobs,
                &self.store,
                scope.clone(),
                memory_type,
                label_ids.clone(),
                expires_at,
                provider.clone(),
                extractor.clone(),
            )
            .await;
            out.push(res);
        }
        out
    }

    pub async fn add_text_entry(
        &self,
        text: &str,
        title: Option<String>,
        scope: VaultScope,
        memory_type: MemoryType,
        label_ids: Vec<String>,
        expires_at: Option<u64>,
    ) -> Result<VaultEntry> {
        let content = text.trim();
        if content.is_empty() {
            return Err(VaultError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "vault text entry cannot be empty",
            )));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = unix_now();
        let chunks = pipeline::chunk_records_for_entry(&id, pipeline::chunk_text(content));
        let entry = VaultEntry {
            id: id.clone(),
            kind: EntryKind::Note,
            subkind: Some("chat_selection".to_string()),
            title: text_entry_title(content, title),
            content: Some(content.to_string()),
            source_path: None,
            vault_blob_path: None,
            scope,
            memory_type,
            pinned: false,
            tags: vec!["chat".to_string()],
            label_ids,
            expires_at,
            mime: Some("text/plain".to_string()),
            size_bytes: Some(content.len() as u64),
            index_status: IndexStatus::Indexed,
            cloud_sync_state: CloudSyncState::Offline,
            classifier_confidence: 1.0,
            retrieval_stats: RetrievalStats::default(),
            created_at: now,
            updated_at: now,
        };

        self.store.upsert_entry(&entry)?;
        for chunk in &chunks {
            self.store.insert_chunk(chunk)?;
        }

        if chunks.is_empty() {
            debug!(entry_id = %entry.id, "vault.embed.skip reason=no_chunks");
        } else if let Some(provider) = self.current_provider() {
            let total_chars: usize = chunks.iter().map(|c| c.content.len()).sum();
            info!(
                entry_id = %entry.id,
                chunks_n = chunks.len(),
                total_chars,
                source = "chat_selection",
                "vault.embed.start"
            );
            let (vectors, stats) = pipeline::embed_chunks(&chunks, provider.as_ref()).await;
            for (chunk_id, emb) in &vectors {
                if emb.values.len() != EMBEDDING_DIM {
                    warn!(
                        chunk_id,
                        got_dim = emb.values.len(),
                        expected_dim = EMBEDDING_DIM,
                        "vault.embed.dim_mismatch (provider returned wrong shape)"
                    );
                    continue;
                }
                if let Err(e) = self.store.update_chunk_embedding(chunk_id, &emb.values) {
                    warn!(chunk_id, err = %e, "vault.embed.write_failed");
                }
            }
            info!(
                entry_id = %entry.id,
                dim = stats.dim,
                chunks_n = chunks.len(),
                total_ms = stats.total_ms,
                ms_per_chunk = stats.avg_ms_per_chunk,
                succeeded = stats.succeeded,
                failed = stats.failed,
                retries = stats.retries,
                "vault.embed.done"
            );
        } else {
            debug!(entry_id = %entry.id, "vault.embed.skip reason=no_provider");
        }

        Ok(entry)
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

    pub fn update_labels_and_expiry(
        &self,
        id: &str,
        label_ids: &[String],
        expires_at: Option<u64>,
    ) -> Result<Option<VaultEntry>> {
        self.store
            .update_labels_and_expiry(id, label_ids, expires_at, unix_now())
    }

    pub fn prune_label_id(&self, label_id: &str) -> Result<Vec<String>> {
        self.store.prune_label_id(label_id, unix_now())
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<Option<VaultEntry>> {
        self.store.set_pinned(id, pinned, unix_now())
    }

    pub fn move_scope(&self, id: &str, new_scope: &VaultScope) -> Result<Option<VaultEntry>> {
        self.store.move_scope(id, new_scope, unix_now())
    }

    pub fn move_bucket(&self, id: &str, new_kind: EntryKind) -> Result<Option<VaultEntry>> {
        self.store.move_bucket(id, new_kind, unix_now())
    }

    pub fn update_cloud_sync_state(&self, id: &str, state: CloudSyncState) -> Result<()> {
        self.store.update_cloud_sync_state(id, state, unix_now())
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
        include_expired: bool,
    ) -> Result<Vec<VaultSearchResult>> {
        let start = Instant::now();
        info!(
            mode = "fts",
            query_len = query.len(),
            scope = scope_label(scope),
            top_k,
            "vault.search.query"
        );
        let hits = self
            .store
            .fts_search(query, scope, top_k, include_expired)?;
        let now = unix_now();
        for (_, entry, _) in &hits {
            let _ = self.store.bump_retrieval(&entry.id, now);
        }
        let total_ms = start.elapsed().as_millis() as u64;
        let top_score = hits.first().map_or(0.0, |(_, _, s)| *s);
        info!(
            mode = "fts",
            total_ms,
            returned_n = hits.len(),
            top_score = f64::from(top_score),
            "vault.search.done"
        );
        Ok(hits
            .into_iter()
            .map(|(chunk, entry, score)| VaultSearchResult {
                chunk,
                entry,
                source: VaultRetrievalSource::Local,
                mode: VaultSearchMode::Fts,
                embedding_model: None,
                score,
            })
            .collect())
    }

    /// Semantic (cosine) search. Falls back to FTS when no provider is
    /// configured, and warns once per session.
    pub async fn semantic_search(
        &self,
        query: &str,
        scope: &VaultScope,
        top_k: usize,
        include_expired: bool,
    ) -> Result<Vec<VaultSearchResult>> {
        let start = Instant::now();
        info!(
            mode = "semantic",
            query_len = query.len(),
            scope = scope_label(scope),
            top_k,
            "vault.search.query"
        );

        let Some(provider) = self.current_provider() else {
            if !self.no_provider_warned.swap(true, Ordering::Relaxed) {
                warn!(
                    reason = "no_provider",
                    "vault.search.fallback (semantic → fts, add an OpenAI key to enable)"
                );
            }
            return self.fts_search(query, scope, top_k, include_expired);
        };

        let embed_start = Instant::now();
        let query_emb = match provider.embed(query).await {
            Ok(e) => e,
            Err(e) => {
                warn!(
                    err = %e,
                    "vault.search.embed_query_failed (falling back to fts)"
                );
                return self.fts_search(query, scope, top_k, include_expired);
            }
        };
        info!(
            latency_ms = embed_start.elapsed().as_millis() as u64,
            dim = query_emb.dimensions,
            "vault.search.embed_query"
        );

        let hits = self
            .store
            .semantic_search(&query_emb.values, scope, top_k, include_expired)?;
        let now = unix_now();
        for (_, entry, _) in &hits {
            let _ = self.store.bump_retrieval(&entry.id, now);
        }
        let total_ms = start.elapsed().as_millis() as u64;
        info!(
            mode = "semantic",
            total_ms,
            returned_n = hits.len(),
            "vault.search.done"
        );
        Ok(hits
            .into_iter()
            .map(|(chunk, entry, score)| VaultSearchResult {
                chunk,
                entry,
                source: VaultRetrievalSource::Local,
                mode: VaultSearchMode::Semantic,
                embedding_model: Some("Xenova/all-MiniLM-L6-v2".to_string()),
                score,
            })
            .collect())
    }

    /// Walk every chunk with a NULL embedding and fill it in. Calls
    /// `on_progress` after each batch — suitable for wiring to a Tauri
    /// event emitter so the UI can render a rebuilding toast.
    ///
    /// Returns totals. Logs every batch via `tracing`.
    pub async fn backfill_embeddings(
        &self,
        batch_size: usize,
        mut on_progress: impl FnMut(BackfillProgress),
    ) -> Result<BackfillStats> {
        let provider = self.current_provider().ok_or_else(|| {
            warn!("vault.backfill.no_provider");
            VaultError::NotImplemented("no embedding provider configured")
        })?;
        let provider = provider.as_ref();

        let total = self.store.count_chunks_missing_embeddings()?;
        info!(total_pending = total, batch_size, "vault.backfill.start");

        let start = Instant::now();
        let mut completed: u64 = 0;
        let mut failed: u64 = 0;
        let mut total_retries: u64 = 0;
        let chunk_budget = batch_size.max(1);

        // Initial tick so UI shows 0 / total immediately.
        on_progress(BackfillProgress {
            total,
            completed,
            failed,
            elapsed_ms: 0,
            done: false,
        });

        loop {
            let pending = self.store.chunks_missing_embeddings(chunk_budget)?;
            if pending.is_empty() {
                break;
            }

            // Reuse the ingest embedder — wraps retries and batching.
            let pseudo_chunks: Vec<VaultChunk> = pending
                .iter()
                .map(|(id, content)| VaultChunk {
                    id: id.clone(),
                    entry_id: String::new(), // unused by embed_chunks
                    chunk_index: 0,
                    content: content.clone(),
                    token_count: None,
                })
                .collect();

            let batch_start = Instant::now();
            let (vectors, stats) = pipeline::embed_chunks(&pseudo_chunks, provider).await;
            total_retries += stats.retries;

            let mut wrote: u64 = 0;
            for (chunk_id, emb) in vectors {
                match self.store.update_chunk_embedding(&chunk_id, &emb.values) {
                    Ok(()) => wrote += 1,
                    Err(e) => {
                        warn!(chunk_id, err = %e, "vault.backfill.write_failed");
                        failed += 1;
                    }
                }
            }

            let missed = (pending.len() as u64).saturating_sub(wrote);
            completed += wrote;
            failed += missed;

            let elapsed_ms = start.elapsed().as_millis() as u64;
            info!(
                batch_ms = batch_start.elapsed().as_millis() as u64,
                batch_size = pending.len(),
                wrote,
                missed,
                completed,
                failed,
                elapsed_ms,
                "vault.backfill.batch"
            );

            on_progress(BackfillProgress {
                total,
                completed,
                failed,
                elapsed_ms,
                done: false,
            });

            // If we wrote nothing this round, bail — repeated calls would loop.
            if wrote == 0 && stats.failed == 0 && stats.succeeded == 0 {
                warn!("vault.backfill.stall (no progress, aborting)");
                break;
            }
        }

        let total_ms = start.elapsed().as_millis() as u64;
        let throughput = if total_ms > 0 {
            (completed as f64) * 1000.0 / (total_ms as f64)
        } else {
            0.0
        };
        info!(
            total_ms,
            embedded = completed,
            failed,
            retries = total_retries,
            throughput_per_s = throughput,
            "vault.backfill.done"
        );

        on_progress(BackfillProgress {
            total,
            completed,
            failed,
            elapsed_ms: total_ms,
            done: true,
        });

        Ok(BackfillStats {
            total,
            embedded: completed,
            failed,
            retries: total_retries,
            total_ms,
        })
    }

    /// Expose the count of chunks still needing embedding so the UI can
    /// badge a "rebuild index" button.
    pub fn pending_embeddings_count(&self) -> Result<u64> {
        self.store.count_chunks_missing_embeddings()
    }

    pub fn pending_reextract_count(&self) -> Result<u64> {
        self.store.count_reextractable_legacy_entries()
    }

    /// Re-run extraction for legacy entries that were previously marked
    /// indexed with zero chunks or raw binary-garbage chunks. This recovers
    /// PDFs/documents/data files after adding new local extractors.
    pub async fn reextract_legacy_entries(
        &self,
        batch_size: usize,
        mut on_progress: impl FnMut(ReextractProgress),
    ) -> Result<ReextractStats> {
        let total = self.store.count_reextractable_legacy_entries()?;
        let extractor = self.current_text_extractor();
        let provider = self.current_provider();
        let chunk_budget = batch_size.max(1);
        let start = Instant::now();
        let mut completed = 0;
        let mut recovered = 0;
        let mut failed = 0;
        let mut embedded = 0;

        info!(total, batch_size = chunk_budget, "vault.reextract.start");
        on_progress(ReextractProgress {
            total,
            completed,
            recovered,
            failed,
            elapsed_ms: 0,
            done: false,
        });

        loop {
            let entries = self.store.reextractable_legacy_entries(chunk_budget)?;
            if entries.is_empty() {
                break;
            }

            for entry in entries {
                completed += 1;
                let Some(blob_path) = entry.vault_blob_path.as_deref() else {
                    failed += 1;
                    continue;
                };
                let blob_path = PathBuf::from(blob_path);
                let (chunks, extraction_failed) = pipeline::extract_chunks_for_entry(
                    &entry.id,
                    &blob_path,
                    entry.kind,
                    entry.subkind.clone(),
                    entry.mime.clone(),
                    extractor.as_ref(),
                )
                .await;

                let status = if extraction_failed {
                    IndexStatus::ExtractionFailed
                } else {
                    IndexStatus::Indexed
                };
                self.store.replace_chunks_for_entry(&entry.id, &chunks)?;
                self.store
                    .update_index_status(&entry.id, status, unix_now())?;

                if extraction_failed || chunks.is_empty() {
                    failed += 1;
                } else {
                    recovered += 1;
                    if let Some(provider) = provider.as_deref() {
                        let (vectors, stats) = pipeline::embed_chunks(&chunks, provider).await;
                        for (chunk_id, emb) in vectors {
                            if self
                                .store
                                .update_chunk_embedding(&chunk_id, &emb.values)
                                .is_ok()
                            {
                                embedded += 1;
                            }
                        }
                        if stats.failed > 0 {
                            warn!(
                                entry_id = %entry.id,
                                failed = stats.failed,
                                "vault.reextract.embed_partial_failure"
                            );
                        }
                    }
                }
            }

            on_progress(ReextractProgress {
                total,
                completed,
                recovered,
                failed,
                elapsed_ms: start.elapsed().as_millis() as u64,
                done: false,
            });
        }

        let total_ms = start.elapsed().as_millis() as u64;
        info!(
            total,
            completed, recovered, failed, embedded, total_ms, "vault.reextract.done"
        );
        on_progress(ReextractProgress {
            total,
            completed,
            recovered,
            failed,
            elapsed_ms: total_ms,
            done: true,
        });

        Ok(ReextractStats {
            total,
            recovered,
            failed,
            embedded,
            total_ms,
        })
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

fn scope_label(scope: &VaultScope) -> String {
    match scope {
        VaultScope::Global => "global".to_string(),
        VaultScope::Project { project_id } => format!("project:{}", project_id),
    }
}

fn text_entry_title(content: &str, title: Option<String>) -> String {
    if let Some(title) = title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return title;
    }

    let first_line = content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Chat selection");
    let chars = first_line.chars().collect::<Vec<_>>();
    if chars.len() <= 96 {
        first_line.to_string()
    } else {
        let mut clipped = chars.into_iter().take(96).collect::<String>();
        clipped.push_str("...");
        clipped
    }
}

// Silence unused-import warning for `debug` that only activates under debug logs.
#[allow(dead_code)]
fn _debug_marker() {
    debug!("noop");
}
