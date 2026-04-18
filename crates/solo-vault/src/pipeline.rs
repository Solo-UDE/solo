//! Local indexing pipeline — validate → extract → chunk → store → embed → notify.
//!
//! V1: text-only extraction. PDF/image/OCR land in V2.
//! V1.2: best-effort embedding during ingest. Failures are logged and
//!       recoverable via `vault_backfill_embeddings`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use solo_embeddings::{Embedding, EmbeddingError, EmbeddingProvider};
use solo_protocol::{
    CloudSyncState, EntryKind, IndexStatus, MemoryType, RetrievalStats, VaultChunk, VaultEntry,
    VaultScope,
};
use tracing::{debug, info, warn};

use crate::classifier;
use crate::store::{Store, EMBEDDING_DIM};
use crate::{Result, VaultError};

/// Max bytes the pipeline will accept for a single entry.
const MAX_BYTES: u64 = 50 * 1024 * 1024;

/// Words per chunk. ~500 words ≈ 650 tokens for the `OpenAI` embedder, so this
/// stays well under the context limit with room for overlap.
const CHUNK_WORDS: usize = 500;
const CHUNK_OVERLAP_WORDS: usize = 50;

/// Output of ingesting a single path.
pub struct Ingested {
    pub entry: VaultEntry,
    pub chunks: Vec<VaultChunk>,
}

/// Copy a dropped file into the vault blob store and produce a full entry +
/// chunks ready to persist. This does not touch the Store itself — the
/// caller is responsible for `upsert_entry` + `insert_chunk`.
pub fn ingest_file(
    src: &Path,
    blobs_dir: &Path,
    scope: VaultScope,
    memory_type: MemoryType,
) -> Result<Ingested> {
    // 1. Validate
    let meta = fs::metadata(src).map_err(VaultError::Io)?;
    if !meta.is_file() {
        return Err(VaultError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "not a regular file",
        )));
    }
    if meta.len() > MAX_BYTES {
        return Err(VaultError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("file exceeds {} MB limit", MAX_BYTES / 1024 / 1024),
        )));
    }

    // 2. Classify + copy to blob store
    let classification = classifier::classify(src);
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("bin");
    let id = uuid::Uuid::new_v4().to_string();
    let blob_name = format!("{id}.{ext}");
    fs::create_dir_all(blobs_dir).map_err(VaultError::Io)?;
    let blob_path = blobs_dir.join(&blob_name);
    fs::copy(src, &blob_path).map_err(VaultError::Io)?;

    // 3. Extract text (best-effort; non-text kinds simply have no chunks)
    let extracted = extract_text(src, classification.kind);

    // 4. Chunk
    let chunks = chunk_text(&extracted);

    // 5. Build entry
    let now = unix_now();
    let title = src
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(&id)
        .to_string();

    let entry = VaultEntry {
        id: id.clone(),
        kind: classification.kind,
        subkind: classification.subkind.clone(),
        title,
        content: None,
        source_path: Some(src.to_string_lossy().into_owned()),
        vault_blob_path: Some(blob_path.to_string_lossy().into_owned()),
        scope,
        memory_type,
        pinned: false,
        tags: Vec::new(),
        mime: classification.mime.clone(),
        size_bytes: Some(meta.len()),
        index_status: IndexStatus::Indexed,
        cloud_sync_state: CloudSyncState::Offline,
        classifier_confidence: classification.confidence,
        retrieval_stats: RetrievalStats::default(),
        created_at: now,
        updated_at: now,
    };

    let chunk_records = chunks
        .into_iter()
        .enumerate()
        .map(|(i, content)| VaultChunk {
            id: uuid::Uuid::new_v4().to_string(),
            entry_id: id.clone(),
            chunk_index: i as u32,
            token_count: Some(approx_token_count(&content)),
            content,
        })
        .collect();

    Ok(Ingested {
        entry,
        chunks: chunk_records,
    })
}

/// One-shot helper that ingests a path, persists it, and best-effort
/// embeds the resulting chunks.
///
/// Embedding failure is non-fatal: we log a structured warning and return
/// the entry with NULL embeddings. The user can recover via
/// `vault_backfill_embeddings`.
pub async fn ingest_and_store(
    src: &Path,
    blobs_dir: &Path,
    store: &Store,
    scope: VaultScope,
    memory_type: MemoryType,
    embed_provider: Option<Arc<dyn EmbeddingProvider>>,
) -> Result<VaultEntry> {
    let Ingested { entry, chunks } = ingest_file(src, blobs_dir, scope, memory_type)?;

    // Persist entry + chunk rows (FTS index rebuilt transactionally by insert_chunk).
    store.upsert_entry(&entry)?;
    for chunk in &chunks {
        store.insert_chunk(chunk)?;
    }

    // Best-effort embed. No-op for zero chunks (e.g. binary files) or when
    // no provider is configured (e.g. user has no OpenAI key set).
    if chunks.is_empty() {
        debug!(entry_id = %entry.id, "vault.embed.skip reason=no_chunks");
    } else if let Some(provider) = embed_provider.as_deref() {
        let total_chars: usize = chunks.iter().map(|c| c.content.len()).sum();
        info!(
            entry_id = %entry.id,
            chunks_n = chunks.len(),
            total_chars,
            "vault.embed.start"
        );
        let (vectors, stats) = embed_chunks(&chunks, provider).await;
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
            if let Err(e) = store.update_chunk_embedding(chunk_id, &emb.values) {
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

/// Summary telemetry from an embedding pass. Returned from `embed_chunks`
/// and re-logged by `ingest_and_store` / `backfill_embeddings`.
#[derive(Debug, Clone, Copy, Default)]
pub struct EmbedStats {
    /// Dimensionality reported by the provider on the first successful
    /// batch (0 if everything failed).
    pub dim: usize,
    /// Chunks that embedded successfully.
    pub succeeded: u64,
    /// Chunks that failed (after exhausting retries).
    pub failed: u64,
    /// Count of retry attempts across all batches (for rate-limit
    /// observability).
    pub retries: u64,
    /// Total wall-clock time spent in `embed_chunks` in milliseconds.
    pub total_ms: u64,
    /// `total_ms / succeeded` for quick eyeballing.
    pub avg_ms_per_chunk: f64,
}

/// Batch-embed a slice of chunks with exponential backoff on rate limits.
///
/// Returns `(vectors, stats)`:
/// - `vectors` is a `(chunk_id, Embedding)` list for successfully embedded
///   chunks. Failed chunks are simply absent (and counted in `stats.failed`).
/// - `stats` is observability metadata.
///
/// Per-batch errors are logged with enough context to triage. The function
/// never panics and never returns Err — it embeds what it can and reports.
///
/// Tunables: `BATCH_SIZE` = 64 (`OpenAI` can handle 2048 texts but 64 keeps
/// per-request latency low and lets backoff be useful); `MAX_RETRIES` = 3
/// with wait = `retry_after * 2^attempt` seconds (capped at 60s).
pub async fn embed_chunks(
    chunks: &[VaultChunk],
    provider: &dyn EmbeddingProvider,
) -> (Vec<(String, Embedding)>, EmbedStats) {
    const BATCH_SIZE: usize = 64;
    const MAX_RETRIES: u32 = 3;

    let start = Instant::now();
    let mut stats = EmbedStats::default();
    let mut vectors: Vec<(String, Embedding)> = Vec::with_capacity(chunks.len());

    if chunks.is_empty() {
        return (vectors, stats);
    }

    for (batch_i, batch) in chunks.chunks(BATCH_SIZE).enumerate() {
        let texts: Vec<String> = batch.iter().map(|c| c.content.clone()).collect();

        let mut attempt: u32 = 0;
        loop {
            let batch_start = Instant::now();
            match provider.embed_many(&texts).await {
                Ok(embs) => {
                    let latency_ms = batch_start.elapsed().as_millis() as u64;
                    if stats.dim == 0 {
                        stats.dim = embs.first().map_or(0, |e| e.dimensions);
                    }
                    let received = embs.len();
                    for (chunk, emb) in batch.iter().zip(embs.into_iter()) {
                        vectors.push((chunk.id.clone(), emb));
                    }
                    stats.succeeded += received as u64;
                    info!(
                        batch_i,
                        batch_size = batch.len(),
                        latency_ms,
                        attempt,
                        "vault.embed.batch"
                    );
                    break;
                }
                Err(EmbeddingError::RateLimited(retry_after_s))
                    if attempt < MAX_RETRIES =>
                {
                    let base = u64::from(retry_after_s.clamp(1, 60));
                    let wait_s = (base * (1u64 << attempt)).min(60);
                    warn!(
                        batch_i,
                        attempt,
                        retry_after_s = wait_s,
                        "vault.embed.retry"
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(wait_s)).await;
                    attempt += 1;
                    stats.retries += 1;
                }
                Err(e) => {
                    warn!(
                        batch_i,
                        attempt,
                        batch_size = batch.len(),
                        err = %e,
                        "vault.embed.skip"
                    );
                    stats.failed += batch.len() as u64;
                    break;
                }
            }
        }
    }

    stats.total_ms = start.elapsed().as_millis() as u64;
    stats.avg_ms_per_chunk = if stats.succeeded > 0 {
        stats.total_ms as f64 / stats.succeeded as f64
    } else {
        0.0
    };
    (vectors, stats)
}

fn extract_text(src: &Path, kind: EntryKind) -> String {
    match kind {
        EntryKind::Document
        | EntryKind::Code
        | EntryKind::Snippet
        | EntryKind::Data
        | EntryKind::Config
        | EntryKind::Web
        | EntryKind::Note
        | EntryKind::Keyvalue => read_utf8_lossy(src).unwrap_or_default(),
        // Binary kinds: no text in V1; V2 will wire pdf-parse/OCR.
        _ => String::new(),
    }
}

fn read_utf8_lossy(src: &Path) -> Option<String> {
    let bytes = fs::read(src).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn chunk_text(text: &str) -> Vec<String> {
    if text.trim().is_empty() {
        return Vec::new();
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let step = CHUNK_WORDS.saturating_sub(CHUNK_OVERLAP_WORDS).max(1);
    let mut i = 0;
    while i < words.len() {
        let end = (i + CHUNK_WORDS).min(words.len());
        out.push(words[i..end].join(" "));
        if end == words.len() {
            break;
        }
        i += step;
    }
    out
}

fn approx_token_count(chunk: &str) -> u32 {
    // Rough conversion: ~1.3 tokens per word for English. Close enough for
    // budgeting; a real tokenizer replaces this alongside the embedder.
    let words = chunk.split_whitespace().count();
    ((words as f32) * 1.3).round() as u32
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Compute the default blobs dir under the vault root.
#[inline]
pub fn blobs_dir(root: &Path) -> PathBuf {
    root.join("blobs")
}
