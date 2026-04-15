//! Local indexing pipeline — validate → extract → chunk → store → notify.
//!
//! V1: text-only extraction. PDF/image/OCR land in V2. Embeddings in V1.2.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use solo_protocol::{
    CloudSyncState, EntryKind, IndexStatus, MemoryType, RetrievalStats, VaultChunk, VaultEntry,
    VaultScope,
};

use crate::classifier;
use crate::store::Store;
use crate::{Result, VaultError};

/// Max bytes the pipeline will accept for a single entry.
const MAX_BYTES: u64 = 50 * 1024 * 1024;

/// Words per chunk. ~500 words ≈ 650 tokens for the OpenAI embedder, so this
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
        index_status: if chunks.is_empty() {
            IndexStatus::Indexed
        } else {
            IndexStatus::Indexed
        },
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

/// One-shot helper that ingests a path and persists it to the given Store.
pub fn ingest_and_store(
    src: &Path,
    blobs_dir: &Path,
    store: &Store,
    scope: VaultScope,
    memory_type: MemoryType,
) -> Result<VaultEntry> {
    let Ingested { entry, chunks } = ingest_file(src, blobs_dir, scope, memory_type)?;
    store.upsert_entry(&entry)?;
    for chunk in &chunks {
        store.insert_chunk(chunk)?;
    }
    Ok(entry)
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
