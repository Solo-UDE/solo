//! `SQLite` + `FTS5` store for vault entries and chunks.
//!
//! V1: scalar columns + FTS5 for lexical search.
//! V1.2: semantic search — vectors stored as little-endian f32 BLOB in the
//!       existing `chunks.embedding` column; cosine similarity computed in
//!       RAM at query time.
//!
//! ## Observability
//! Every public fn emits structured `tracing` events. Enable with
//! `RUST_LOG=solo_vault=debug` to see per-candidate scan timings.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json;
use solo_embeddings::cosine_similarity;
use solo_protocol::{
    CloudSyncState, EntryKind, IndexStatus, MemoryType, RetrievalStats, VaultChunk, VaultEntry,
    VaultListFilters, VaultScope,
};
use tracing::{debug, error, info, warn};

use crate::{Result, VaultError};

/// Dimension of the embedding vectors we store.
///
/// V1.2.1 default: **384** — matches `all-MiniLM-L6-v2` from fastembed-rs.
/// We deliberately picked (a) "bump this constant and force a backfill"
/// over (b) per-row dim coexistence: the `blob_to_f32_vec` dim check rejects
/// any pre-existing 1536-dim rows from the V1.2 `OpenAI` era and the search
/// path auto-nulls them. `vault_backfill_embeddings` then re-embeds them
/// with the local model.
pub const EMBEDDING_DIM: usize = 384;

const SCHEMA: &str = r"
CREATE TABLE IF NOT EXISTS entries (
    id                      TEXT PRIMARY KEY,
    kind                    TEXT NOT NULL,
    subkind                 TEXT,
    title                   TEXT NOT NULL,
    content                 TEXT,
    source_path             TEXT,
    vault_blob_path         TEXT,
    scope_type              TEXT NOT NULL,
    scope_project_id        TEXT,
    memory_type             TEXT NOT NULL,
    pinned                  INTEGER NOT NULL DEFAULT 0,
    tags                    TEXT NOT NULL DEFAULT '[]',
    label_ids               TEXT NOT NULL DEFAULT '[]',
    expires_at              INTEGER,
    mime                    TEXT,
    size_bytes              INTEGER,
    index_status            TEXT NOT NULL,
    cloud_sync_state        TEXT NOT NULL,
    classifier_confidence   REAL NOT NULL,
    hit_count               INTEGER NOT NULL DEFAULT 0,
    last_retrieved_at       INTEGER,
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_scope ON entries(scope_type, scope_project_id);
CREATE INDEX IF NOT EXISTS idx_entries_kind  ON entries(kind);
CREATE INDEX IF NOT EXISTS idx_entries_pin   ON entries(pinned);

CREATE TABLE IF NOT EXISTS chunks (
    id           TEXT PRIMARY KEY,
    entry_id     TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    chunk_index  INTEGER NOT NULL,
    content      TEXT NOT NULL,
    token_count  INTEGER,
    embedding    BLOB,
    UNIQUE (entry_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_entry ON chunks(entry_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    entry_id UNINDEXED,
    chunk_id UNINDEXED,
    tokenize = 'porter'
);
";

const REEXTRACTABLE_LEGACY_ENTRY_WHERE: &str = r"
    vault_blob_path IS NOT NULL
    AND index_status = 'indexed'
    AND (
        (
            NOT EXISTS (SELECT 1 FROM chunks c WHERE c.entry_id = entries.id)
            AND (
                (kind = 'document' AND subkind IN ('pdf', 'word', 'rtf', 'epub'))
                OR (kind = 'data' AND subkind IN ('excel', 'parquet'))
                OR (kind = 'image' AND subkind = 'svg')
                OR (kind = 'archive' AND subkind IN ('zip', 'tar', 'gzip', 'bzip2'))
            )
        )
        OR EXISTS (
            SELECT 1 FROM chunks c
            WHERE c.entry_id = entries.id
              AND c.chunk_index = 0
              AND (
                  (kind = 'document' AND subkind = 'pdf' AND (
                      c.content LIKE '%PDF-%'
                      OR c.content LIKE '%/FlateDecode%'
                      OR c.content LIKE '%' || char(65533) || '%'
                  ))
                  OR (kind = 'document' AND subkind IN ('word', 'epub') AND (
                      c.content LIKE 'PK%'
                      OR c.content LIKE '%' || char(65533) || '%'
                  ))
                  OR (kind = 'document' AND subkind = 'rtf' AND (
                      c.content LIKE '{%'
                      AND c.content LIKE '%rtf%'
                  ))
                  OR (kind = 'data' AND subkind = 'excel' AND (
                      c.content LIKE 'PK%'
                      OR c.content LIKE '%' || char(65533) || '%'
                  ))
                  OR (kind = 'data' AND subkind = 'parquet' AND (
                      c.content LIKE 'PAR1%'
                      OR c.content LIKE '%' || char(65533) || '%'
                  ))
              )
        )
    )
";

pub struct Store {
    conn: Mutex<Connection>,
    db_path: PathBuf,
}

fn migrate_entries_metadata(conn: &Connection) -> Result<()> {
    if !entry_column_exists(conn, "label_ids")? {
        conn.execute(
            "ALTER TABLE entries ADD COLUMN label_ids TEXT NOT NULL DEFAULT '[]'",
            [],
        )
        .map_err(to_vault)?;
    }
    if !entry_column_exists(conn, "expires_at")? {
        conn.execute("ALTER TABLE entries ADD COLUMN expires_at INTEGER", [])
            .map_err(to_vault)?;
    }
    Ok(())
}

fn entry_column_exists(conn: &Connection, name: &str) -> Result<bool> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM pragma_table_info('entries') WHERE name = ?1",
            params![name],
            |_| Ok(()),
        )
        .optional()
        .map_err(to_vault)?
        .is_some();
    Ok(exists)
}

impl Store {
    pub fn open(db_path: impl AsRef<Path>) -> Result<Self> {
        let db_path = db_path.as_ref().to_path_buf();
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&db_path).map_err(to_vault)?;
        conn.execute_batch(SCHEMA).map_err(to_vault)?;
        migrate_entries_metadata(&conn)?;
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_entries_expires ON entries(expires_at);",
        )
        .map_err(to_vault)?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(to_vault)?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(to_vault)?;
        Ok(Self {
            conn: Mutex::new(conn),
            db_path,
        })
    }

    #[allow(dead_code)]
    pub fn path(&self) -> &Path {
        &self.db_path
    }

    pub fn upsert_entry(&self, entry: &VaultEntry) -> Result<()> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        let (scope_type, scope_project_id) = split_scope(&entry.scope);
        conn.execute(
            "INSERT INTO entries (
                id, kind, subkind, title, content, source_path, vault_blob_path,
                scope_type, scope_project_id, memory_type, pinned, tags,
                label_ids, expires_at, mime, size_bytes, index_status, cloud_sync_state,
                classifier_confidence, hit_count, last_retrieved_at,
                created_at, updated_at
             ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind,
                subkind = excluded.subkind,
                title = excluded.title,
                content = excluded.content,
                source_path = excluded.source_path,
                vault_blob_path = excluded.vault_blob_path,
                scope_type = excluded.scope_type,
                scope_project_id = excluded.scope_project_id,
                memory_type = excluded.memory_type,
                pinned = excluded.pinned,
                tags = excluded.tags,
                label_ids = excluded.label_ids,
                expires_at = excluded.expires_at,
                mime = excluded.mime,
                size_bytes = excluded.size_bytes,
                index_status = excluded.index_status,
                cloud_sync_state = excluded.cloud_sync_state,
                classifier_confidence = excluded.classifier_confidence,
                hit_count = excluded.hit_count,
                last_retrieved_at = excluded.last_retrieved_at,
                updated_at = excluded.updated_at
            ",
            params![
                entry.id,
                kind_to_str(entry.kind),
                entry.subkind,
                entry.title,
                entry.content,
                entry.source_path,
                entry.vault_blob_path,
                scope_type,
                scope_project_id,
                memory_to_str(entry.memory_type),
                i64::from(entry.pinned),
                serde_json::to_string(&entry.tags).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&entry.label_ids).unwrap_or_else(|_| "[]".into()),
                entry.expires_at.map(|n| n as i64),
                entry.mime,
                entry.size_bytes.map(|n| n as i64),
                status_to_str(entry.index_status),
                sync_to_str(entry.cloud_sync_state),
                f64::from(entry.classifier_confidence),
                i64::from(entry.retrieval_stats.hit_count),
                entry.retrieval_stats.last_retrieved_at.map(|n| n as i64),
                entry.created_at as i64,
                entry.updated_at as i64,
            ],
        )
        .map_err(to_vault)?;
        Ok(())
    }

    pub fn get_entry(&self, id: &str) -> Result<Option<VaultEntry>> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        let mut stmt = conn
            .prepare("SELECT * FROM entries WHERE id = ?1")
            .map_err(to_vault)?;
        let row = stmt
            .query_row(params![id], row_to_entry)
            .optional()
            .map_err(to_vault)?;
        Ok(row)
    }

    pub fn list_entries(
        &self,
        scope: &VaultScope,
        filters: &VaultListFilters,
    ) -> Result<Vec<VaultEntry>> {
        let (_scope_type, scope_project_id) = split_scope(scope);
        let conn = self.conn.lock().expect("vault store mutex poisoned");

        let sql = if matches!(scope, VaultScope::Project { .. }) {
            "SELECT * FROM entries
             WHERE scope_type = 'global'
                OR (scope_type = 'project' AND scope_project_id = ?1)
             ORDER BY pinned DESC, updated_at DESC"
        } else {
            "SELECT * FROM entries
             WHERE scope_type = 'global'
             ORDER BY pinned DESC, updated_at DESC"
        };

        let mut stmt = conn.prepare(sql).map_err(to_vault)?;
        let rows: rusqlite::Result<Vec<VaultEntry>> = if matches!(scope, VaultScope::Project { .. })
        {
            stmt.query_map(params![scope_project_id], row_to_entry)
                .map_err(to_vault)?
                .collect()
        } else {
            stmt.query_map([], row_to_entry)
                .map_err(to_vault)?
                .collect()
        };
        let mut entries = rows.map_err(to_vault)?;

        if let Some(kind) = filters.kind {
            entries.retain(|e| e.kind == kind);
        }
        if let Some(true) = filters.pinned {
            entries.retain(|e| e.pinned);
        }
        if let Some(true) = filters.unsorted {
            entries.retain(|e| e.kind == EntryKind::Unsorted);
        }
        let now = unix_now();
        match filters.expired {
            Some(true) => entries.retain(|e| is_expired(e, now)),
            _ => entries.retain(|e| !is_expired(e, now)),
        }
        if let Some(q) = filters.query.as_deref() {
            let q = q.to_ascii_lowercase();
            entries.retain(|e| {
                e.title.to_ascii_lowercase().contains(&q)
                    || e.tags.iter().any(|t| t.to_ascii_lowercase().contains(&q))
            });
        }
        Ok(entries)
    }

    pub fn delete_entry(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        conn.execute("DELETE FROM entries WHERE id = ?1", params![id])
            .map_err(to_vault)?;
        conn.execute("DELETE FROM chunks_fts WHERE entry_id = ?1", params![id])
            .map_err(to_vault)?;
        Ok(())
    }

    pub fn update_tags(&self, id: &str, tags: &[String], now: u64) -> Result<Option<VaultEntry>> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        conn.execute(
            "UPDATE entries SET tags = ?1, updated_at = ?2 WHERE id = ?3",
            params![
                serde_json::to_string(tags).unwrap_or_else(|_| "[]".into()),
                now as i64,
                id
            ],
        )
        .map_err(to_vault)?;
        drop(conn);
        self.get_entry(id)
    }

    pub fn update_labels_and_expiry(
        &self,
        id: &str,
        label_ids: &[String],
        expires_at: Option<u64>,
        now: u64,
    ) -> Result<Option<VaultEntry>> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        conn.execute(
            "UPDATE entries SET label_ids = ?1, expires_at = ?2, updated_at = ?3 WHERE id = ?4",
            params![
                serde_json::to_string(label_ids).unwrap_or_else(|_| "[]".into()),
                expires_at.map(|n| n as i64),
                now as i64,
                id
            ],
        )
        .map_err(to_vault)?;
        drop(conn);
        self.get_entry(id)
    }

    pub fn prune_label_id(&self, label_id: &str, now: u64) -> Result<Vec<String>> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        let mut stmt = conn
            .prepare("SELECT id, label_ids FROM entries WHERE label_ids LIKE ?1")
            .map_err(to_vault)?;
        let candidates: Vec<(String, String)> = stmt
            .query_map(params![format!("%\"{label_id}\"%")], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(to_vault)?
            .collect::<rusqlite::Result<_>>()
            .map_err(to_vault)?;
        drop(stmt);

        let mut changed = Vec::new();
        for (entry_id, json) in candidates {
            let mut ids: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
            let before = ids.len();
            ids.retain(|id| id != label_id);
            if ids.len() == before {
                continue;
            }
            conn.execute(
                "UPDATE entries SET label_ids = ?1, updated_at = ?2 WHERE id = ?3",
                params![
                    serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into()),
                    now as i64,
                    entry_id
                ],
            )
            .map_err(to_vault)?;
            changed.push(entry_id);
        }
        Ok(changed)
    }

    pub fn set_pinned(&self, id: &str, pinned: bool, now: u64) -> Result<Option<VaultEntry>> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        conn.execute(
            "UPDATE entries SET pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![i64::from(pinned), now as i64, id],
        )
        .map_err(to_vault)?;
        drop(conn);
        self.get_entry(id)
    }

    pub fn move_scope(
        &self,
        id: &str,
        new_scope: &VaultScope,
        now: u64,
    ) -> Result<Option<VaultEntry>> {
        let (t, pid) = split_scope(new_scope);
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        conn.execute(
            "UPDATE entries SET scope_type = ?1, scope_project_id = ?2, updated_at = ?3 WHERE id = ?4",
            params![t, pid, now as i64, id],
        )
        .map_err(to_vault)?;
        drop(conn);
        self.get_entry(id)
    }

    pub fn move_bucket(
        &self,
        id: &str,
        new_kind: EntryKind,
        now: u64,
    ) -> Result<Option<VaultEntry>> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        conn.execute(
            "UPDATE entries SET kind = ?1, updated_at = ?2 WHERE id = ?3",
            params![kind_to_str(new_kind), now as i64, id],
        )
        .map_err(to_vault)?;
        drop(conn);
        self.get_entry(id)
    }

    pub fn unsorted_count(&self) -> Result<u32> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        let now = unix_now();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM entries
                 WHERE kind = 'unsorted'
                   AND (expires_at IS NULL OR expires_at > ?1)",
                params![now as i64],
                |r| r.get(0),
            )
            .map_err(to_vault)?;
        Ok(n as u32)
    }

    pub fn insert_chunk(&self, chunk: &VaultChunk) -> Result<()> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        conn.execute(
            "INSERT OR REPLACE INTO chunks (id, entry_id, chunk_index, content, token_count)
             VALUES (?,?,?,?,?)",
            params![
                chunk.id,
                chunk.entry_id,
                i64::from(chunk.chunk_index),
                chunk.content,
                chunk.token_count.map(i64::from),
            ],
        )
        .map_err(to_vault)?;
        conn.execute(
            "INSERT INTO chunks_fts (content, entry_id, chunk_id) VALUES (?, ?, ?)",
            params![chunk.content, chunk.entry_id, chunk.id],
        )
        .map_err(to_vault)?;
        Ok(())
    }

    pub fn replace_chunks_for_entry(&self, entry_id: &str, chunks: &[VaultChunk]) -> Result<()> {
        let mut conn = self.conn.lock().expect("vault store mutex poisoned");
        let tx = conn.transaction().map_err(to_vault)?;
        tx.execute(
            "DELETE FROM chunks_fts WHERE entry_id = ?1",
            params![entry_id],
        )
        .map_err(to_vault)?;
        tx.execute("DELETE FROM chunks WHERE entry_id = ?1", params![entry_id])
            .map_err(to_vault)?;
        for chunk in chunks {
            tx.execute(
                "INSERT OR REPLACE INTO chunks (id, entry_id, chunk_index, content, token_count)
                 VALUES (?,?,?,?,?)",
                params![
                    chunk.id,
                    chunk.entry_id,
                    i64::from(chunk.chunk_index),
                    chunk.content,
                    chunk.token_count.map(i64::from),
                ],
            )
            .map_err(to_vault)?;
            tx.execute(
                "INSERT INTO chunks_fts (content, entry_id, chunk_id) VALUES (?, ?, ?)",
                params![chunk.content, chunk.entry_id, chunk.id],
            )
            .map_err(to_vault)?;
        }
        tx.commit().map_err(to_vault)?;
        Ok(())
    }

    pub fn update_index_status(&self, entry_id: &str, status: IndexStatus, now: u64) -> Result<()> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        conn.execute(
            "UPDATE entries SET index_status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status_to_str(status), now as i64, entry_id],
        )
        .map_err(to_vault)?;
        Ok(())
    }

    pub fn update_cloud_sync_state(
        &self,
        entry_id: &str,
        state: CloudSyncState,
        now: u64,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        conn.execute(
            "UPDATE entries SET cloud_sync_state = ?1, updated_at = ?2 WHERE id = ?3",
            params![sync_to_str(state), now as i64, entry_id],
        )
        .map_err(to_vault)?;
        Ok(())
    }

    pub fn count_reextractable_legacy_entries(&self) -> Result<u64> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        let sql = format!("SELECT COUNT(*) FROM entries WHERE {REEXTRACTABLE_LEGACY_ENTRY_WHERE}");
        let n: i64 = conn.query_row(&sql, [], |r| r.get(0)).map_err(to_vault)?;
        Ok(n.max(0) as u64)
    }

    pub fn reextractable_legacy_entries(&self, limit: usize) -> Result<Vec<VaultEntry>> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        let sql = format!(
            "SELECT * FROM entries WHERE {REEXTRACTABLE_LEGACY_ENTRY_WHERE}
             ORDER BY updated_at DESC
             LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql).map_err(to_vault)?;
        let rows: rusqlite::Result<Vec<VaultEntry>> = stmt
            .query_map(params![limit as i64], row_to_entry)
            .map_err(to_vault)?
            .collect();
        rows.map_err(to_vault)
    }

    pub fn fts_search(
        &self,
        query: &str,
        scope: &VaultScope,
        top_k: usize,
        include_expired: bool,
    ) -> Result<Vec<(VaultChunk, VaultEntry, f32)>> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        let now = unix_now();

        let sql = r"
            SELECT c.id, c.entry_id, c.chunk_index, c.content, c.token_count,
                   bm25(chunks_fts) AS rank
            FROM chunks_fts
            JOIN chunks c ON c.id = chunks_fts.chunk_id
            JOIN entries e ON e.id = c.entry_id
            WHERE chunks_fts MATCH ?1
              AND (e.scope_type = 'global'
                   OR (e.scope_type = 'project' AND e.scope_project_id = ?2))
              AND (?3 = 1 OR e.expires_at IS NULL OR e.expires_at > ?4)
            ORDER BY rank
            LIMIT ?5
        ";

        let safe_query = fts5_escape(query);
        let (_scope_type, scope_project_id) = split_scope(scope);
        let mut stmt = conn.prepare(sql).map_err(to_vault)?;
        let raw: rusqlite::Result<Vec<(VaultChunk, String, f64)>> = stmt
            .query_map(
                params![
                    safe_query,
                    scope_project_id,
                    if include_expired { 1_i64 } else { 0_i64 },
                    now as i64,
                    top_k as i64
                ],
                |row| {
                    let chunk = VaultChunk {
                        id: row.get::<_, String>(0)?,
                        entry_id: row.get::<_, String>(1)?,
                        chunk_index: row.get::<_, i64>(2)? as u32,
                        content: row.get::<_, String>(3)?,
                        token_count: row.get::<_, Option<i64>>(4)?.map(|n| n as u32),
                    };
                    let rank: f64 = row.get(5)?;
                    Ok((chunk, row.get::<_, String>(1)?, rank))
                },
            )
            .map_err(to_vault)?
            .collect();
        let raw = raw.map_err(to_vault)?;
        drop(stmt);

        let mut results = Vec::with_capacity(raw.len());
        for (chunk, entry_id, rank) in raw {
            let mut lookup = conn
                .prepare("SELECT * FROM entries WHERE id = ?1")
                .map_err(to_vault)?;
            let entry = lookup
                .query_row(params![entry_id], row_to_entry)
                .map_err(to_vault)?;
            let relevance = (1.0 / (1.0 + rank.abs())) as f32;
            results.push((chunk, entry, relevance));
        }
        Ok(results)
    }

    pub fn bump_retrieval(&self, entry_id: &str, now: u64) -> Result<()> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        conn.execute(
            "UPDATE entries SET hit_count = hit_count + 1, last_retrieved_at = ?1 WHERE id = ?2",
            params![now as i64, entry_id],
        )
        .map_err(to_vault)?;
        Ok(())
    }

    // =========================================================================
    // V1.2 — Semantic embeddings
    // =========================================================================

    /// Write (or overwrite) the embedding vector for a chunk. Rejects vectors
    /// that don't match `EMBEDDING_DIM` so we never store junk.
    pub fn update_chunk_embedding(&self, chunk_id: &str, vec: &[f32]) -> Result<()> {
        if vec.len() != EMBEDDING_DIM {
            warn!(
                chunk_id,
                dim = vec.len(),
                expected = EMBEDDING_DIM,
                "vault.store.update_chunk_embedding.dim_mismatch"
            );
            return Err(VaultError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "embedding dim mismatch: expected {}, got {}",
                    EMBEDDING_DIM,
                    vec.len()
                ),
            )));
        }
        let blob = f32_slice_to_blob(vec);
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        let rows = conn
            .execute(
                "UPDATE chunks SET embedding = ?1 WHERE id = ?2",
                params![blob, chunk_id],
            )
            .map_err(to_vault)?;
        if rows == 0 {
            warn!(
                chunk_id,
                "vault.store.update_chunk_embedding: no matching chunk"
            );
        } else {
            debug!(
                chunk_id,
                bytes = blob.len(),
                "vault.store.update_chunk_embedding.ok"
            );
        }
        Ok(())
    }

    /// Count chunks that still need an embedding (null `embedding` column).
    pub fn count_chunks_missing_embeddings(&self) -> Result<u64> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chunks WHERE embedding IS NULL",
                [],
                |r| r.get(0),
            )
            .map_err(to_vault)?;
        Ok(n.max(0) as u64)
    }

    /// Paged read of chunks that still need embedding. Returns
    /// `(chunk_id, content)` tuples ordered by insert order so that backfill
    /// progress is deterministic and resumable.
    pub fn chunks_missing_embeddings(&self, limit: usize) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        let mut stmt = conn
            .prepare(
                "SELECT id, content FROM chunks WHERE embedding IS NULL ORDER BY rowid LIMIT ?1",
            )
            .map_err(to_vault)?;
        let rows: rusqlite::Result<Vec<(String, String)>> = stmt
            .query_map(params![limit as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(to_vault)?
            .collect();
        rows.map_err(to_vault)
    }

    /// Null out the embedding for a chunk. Used when we detect corruption /
    /// dim mismatch during a search scan so that the next backfill repairs it.
    pub fn null_chunk_embedding(&self, chunk_id: &str) -> Result<()> {
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        conn.execute(
            "UPDATE chunks SET embedding = NULL WHERE id = ?1",
            params![chunk_id],
        )
        .map_err(to_vault)?;
        Ok(())
    }

    /// Semantic similarity search over stored chunk embeddings.
    ///
    /// - Loads all scope-matching rows whose `embedding IS NOT NULL` into
    ///   memory, decodes the f32 BLOB, computes cosine vs. `query_vec`.
    /// - Sorts descending and keeps the top-K plus their entry rows.
    /// - Corrupt / dim-mismatched rows are skipped and flagged for
    ///   re-embedding (their `embedding` column is nulled on the fly so the
    ///   next backfill picks them up).
    ///
    /// At V1.2 scale (hundreds of entries → low thousands of chunks) a flat
    /// in-RAM scan is comfortable; sub-ms rank on a modern laptop. Revisit
    /// with sqlite-vec or HNSW once we're measuring pain.
    pub fn semantic_search(
        &self,
        query_vec: &[f32],
        scope: &VaultScope,
        top_k: usize,
        include_expired: bool,
    ) -> Result<Vec<(VaultChunk, VaultEntry, f32)>> {
        let start = Instant::now();
        if query_vec.len() != EMBEDDING_DIM {
            warn!(
                dim = query_vec.len(),
                expected = EMBEDDING_DIM,
                "vault.search.semantic.query_dim_mismatch"
            );
            return Ok(Vec::new());
        }

        let (_scope_type, scope_project_id) = split_scope(scope);
        let conn = self.conn.lock().expect("vault store mutex poisoned");
        let now = unix_now();

        // Phase 1: Pull every in-scope chunk with its embedding blob.
        let mut stmt = conn
            .prepare(
                r"
                SELECT c.id, c.entry_id, c.chunk_index, c.content, c.token_count, c.embedding
                FROM chunks c
                JOIN entries e ON e.id = c.entry_id
                WHERE c.embedding IS NOT NULL
                  AND (e.scope_type = 'global'
                       OR (e.scope_type = 'project' AND e.scope_project_id = ?1))
                  AND (?2 = 1 OR e.expires_at IS NULL OR e.expires_at > ?3)
                ",
            )
            .map_err(to_vault)?;

        let raw: rusqlite::Result<Vec<(VaultChunk, Vec<u8>)>> = stmt
            .query_map(
                params![
                    scope_project_id,
                    if include_expired { 1_i64 } else { 0_i64 },
                    now as i64
                ],
                |row| {
                    Ok((
                        VaultChunk {
                            id: row.get::<_, String>(0)?,
                            entry_id: row.get::<_, String>(1)?,
                            chunk_index: row.get::<_, i64>(2)? as u32,
                            content: row.get::<_, String>(3)?,
                            token_count: row.get::<_, Option<i64>>(4)?.map(|n| n as u32),
                        },
                        row.get::<_, Vec<u8>>(5)?,
                    ))
                },
            )
            .map_err(to_vault)?
            .collect();
        let raw = raw.map_err(to_vault)?;
        drop(stmt);

        let raw_n = raw.len();
        let load_ms = start.elapsed().as_millis() as u64;

        // Phase 2: Decode + score. Collect corrupt IDs for a post-scan NULL sweep.
        let mut candidates: Vec<(VaultChunk, f32)> = Vec::with_capacity(raw.len());
        let mut corrupt_ids: Vec<String> = Vec::new();
        for (chunk, blob) in raw {
            match blob_to_f32_vec(&blob, EMBEDDING_DIM) {
                Ok(vec) => {
                    let similarity = cosine_similarity(query_vec, &vec);
                    if similarity.is_finite() {
                        candidates.push((chunk, similarity));
                    } else {
                        debug!(chunk_id = %chunk.id, score = similarity, "vault.search.non_finite_score");
                    }
                }
                Err(e) => {
                    error!(chunk_id = %chunk.id, err = %e, "vault.embed.dim_mismatch");
                    corrupt_ids.push(chunk.id.clone());
                }
            }
        }
        let score_ms = start.elapsed().as_millis() as u64 - load_ms;
        debug!(
            candidates_n = candidates.len(),
            raw_n,
            load_ms,
            score_ms,
            corrupt = corrupt_ids.len(),
            "vault.search.scan"
        );

        // Phase 3: Partial sort for top-k.
        candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        candidates.truncate(top_k);

        let rank_ms = start.elapsed().as_millis() as u64 - load_ms - score_ms;
        let top_score = candidates.first().map_or(0.0, |(_, s)| *s);
        let median_score = if candidates.is_empty() {
            0.0
        } else {
            candidates[candidates.len() / 2].1
        };
        let bottom_score = candidates.last().map_or(0.0, |(_, s)| *s);
        info!(
            mode = "semantic",
            rank_ms,
            returned_n = candidates.len(),
            top_score = f64::from(top_score),
            median_score = f64::from(median_score),
            bottom_score = f64::from(bottom_score),
            "vault.search.rank"
        );

        // Phase 4: Join entries for the survivors.
        let mut out = Vec::with_capacity(candidates.len());
        for (chunk, score) in candidates {
            let entry_id = chunk.entry_id.clone();
            let mut lookup = conn
                .prepare("SELECT * FROM entries WHERE id = ?1")
                .map_err(to_vault)?;
            let entry = lookup
                .query_row(params![&entry_id], row_to_entry)
                .map_err(to_vault)?;
            drop(lookup);
            out.push((chunk, entry, score));
        }

        // Phase 5: Post-scan repair — null corrupt embeddings so the next
        // backfill picks them up. Best-effort; failures are logged.
        for id in &corrupt_ids {
            if let Err(e) = conn.execute(
                "UPDATE chunks SET embedding = NULL WHERE id = ?1",
                params![id],
            ) {
                error!(chunk_id = %id, err = %e, "vault.search.null_corrupt_failed");
            }
        }

        let total_ms = start.elapsed().as_millis() as u64;
        info!(total_ms, "vault.search.done");
        Ok(out)
    }
}

// =============================================================================
// BLOB helpers (little-endian f32 array)
// =============================================================================

/// Serialize an f32 slice to a packed little-endian BLOB.
#[inline]
pub(crate) fn f32_slice_to_blob(vec: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(vec.len() * 4);
    for &f in vec {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

/// Decode a packed little-endian BLOB into an f32 vector, validating the
/// expected dimension. Returns an error string suitable for logging rather
/// than a rich typed error — callers just want to skip the row and log.
#[inline]
pub(crate) fn blob_to_f32_vec(
    bytes: &[u8],
    expected_dim: usize,
) -> std::result::Result<Vec<f32>, String> {
    if !bytes.len().is_multiple_of(4) {
        return Err(format!(
            "embedding blob length {} not a multiple of 4",
            bytes.len()
        ));
    }
    let got = bytes.len() / 4;
    if got != expected_dim {
        return Err(format!(
            "embedding dim mismatch: expected {}, got {}",
            expected_dim, got
        ));
    }
    let mut out = Vec::with_capacity(got);
    for c in bytes.chunks_exact(4) {
        let arr: [u8; 4] = [c[0], c[1], c[2], c[3]];
        out.push(f32::from_le_bytes(arr));
    }
    Ok(out)
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<VaultEntry> {
    let tags_json: String = row.get("tags")?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let label_ids_json: String = row.get("label_ids")?;
    let label_ids: Vec<String> = serde_json::from_str(&label_ids_json).unwrap_or_default();

    let scope_type: String = row.get("scope_type")?;
    let scope_project_id: Option<String> = row.get("scope_project_id")?;
    let scope = match scope_type.as_str() {
        "project" => VaultScope::Project {
            project_id: scope_project_id.unwrap_or_default(),
        },
        _ => VaultScope::Global,
    };

    let size_bytes: Option<i64> = row.get("size_bytes")?;
    let last_retrieved_at: Option<i64> = row.get("last_retrieved_at")?;
    let expires_at: Option<i64> = row.get("expires_at")?;
    let hit_count: i64 = row.get("hit_count")?;

    Ok(VaultEntry {
        id: row.get("id")?,
        kind: str_to_kind(&row.get::<_, String>("kind")?),
        subkind: row.get("subkind")?,
        title: row.get("title")?,
        content: row.get("content")?,
        source_path: row.get("source_path")?,
        vault_blob_path: row.get("vault_blob_path")?,
        scope,
        memory_type: str_to_memory(&row.get::<_, String>("memory_type")?),
        pinned: row.get::<_, i64>("pinned")? != 0,
        tags,
        label_ids,
        expires_at: expires_at.map(|n| n as u64),
        mime: row.get("mime")?,
        size_bytes: size_bytes.map(|n| n as u64),
        index_status: str_to_status(&row.get::<_, String>("index_status")?),
        cloud_sync_state: str_to_sync(&row.get::<_, String>("cloud_sync_state")?),
        classifier_confidence: row.get::<_, f64>("classifier_confidence")? as f32,
        retrieval_stats: RetrievalStats {
            hit_count: hit_count as u32,
            last_retrieved_at: last_retrieved_at.map(|n| n as u64),
        },
        created_at: row.get::<_, i64>("created_at")? as u64,
        updated_at: row.get::<_, i64>("updated_at")? as u64,
    })
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn is_expired(entry: &VaultEntry, now: u64) -> bool {
    entry.expires_at.is_some_and(|expires_at| expires_at <= now)
}

fn split_scope(scope: &VaultScope) -> (&'static str, Option<String>) {
    match scope {
        VaultScope::Global => ("global", None),
        VaultScope::Project { project_id } => ("project", Some(project_id.clone())),
    }
}

fn kind_to_str(k: EntryKind) -> &'static str {
    match k {
        EntryKind::Document => "document",
        EntryKind::Code => "code",
        EntryKind::Snippet => "snippet",
        EntryKind::Image => "image",
        EntryKind::Design => "design",
        EntryKind::Data => "data",
        EntryKind::Config => "config",
        EntryKind::Web => "web",
        EntryKind::Note => "note",
        EntryKind::Keyvalue => "keyvalue",
        EntryKind::Audio => "audio",
        EntryKind::Archive => "archive",
        EntryKind::Unsorted => "unsorted",
    }
}

fn str_to_kind(s: &str) -> EntryKind {
    match s {
        "document" => EntryKind::Document,
        "code" => EntryKind::Code,
        "snippet" => EntryKind::Snippet,
        "image" => EntryKind::Image,
        "design" => EntryKind::Design,
        "data" => EntryKind::Data,
        "config" => EntryKind::Config,
        "web" => EntryKind::Web,
        "note" => EntryKind::Note,
        "keyvalue" => EntryKind::Keyvalue,
        "audio" => EntryKind::Audio,
        "archive" => EntryKind::Archive,
        _ => EntryKind::Unsorted,
    }
}

fn memory_to_str(m: MemoryType) -> &'static str {
    match m {
        MemoryType::Project => "project",
        MemoryType::User => "user",
        MemoryType::PinnedSourceOfTruth => "pinned_source_of_truth",
    }
}

fn str_to_memory(s: &str) -> MemoryType {
    match s {
        "user" => MemoryType::User,
        "pinned_source_of_truth" => MemoryType::PinnedSourceOfTruth,
        _ => MemoryType::Project,
    }
}

fn status_to_str(s: IndexStatus) -> &'static str {
    match s {
        IndexStatus::Pending => "pending",
        IndexStatus::Extracting => "extracting",
        IndexStatus::Chunking => "chunking",
        IndexStatus::Embedding => "embedding",
        IndexStatus::Storing => "storing",
        IndexStatus::Indexed => "indexed",
        IndexStatus::ExtractionFailed => "extraction_failed",
        IndexStatus::Failed => "failed",
    }
}

fn str_to_status(s: &str) -> IndexStatus {
    match s {
        "extracting" => IndexStatus::Extracting,
        "chunking" => IndexStatus::Chunking,
        "embedding" => IndexStatus::Embedding,
        "storing" => IndexStatus::Storing,
        "indexed" => IndexStatus::Indexed,
        "extraction_failed" => IndexStatus::ExtractionFailed,
        "failed" => IndexStatus::Failed,
        _ => IndexStatus::Pending,
    }
}

fn sync_to_str(s: CloudSyncState) -> &'static str {
    match s {
        CloudSyncState::Offline => "offline",
        CloudSyncState::Pending => "pending",
        CloudSyncState::Uploading => "uploading",
        CloudSyncState::IndexingRemote => "indexing_remote",
        CloudSyncState::Synced => "synced",
        CloudSyncState::Failed => "failed",
    }
}

fn str_to_sync(s: &str) -> CloudSyncState {
    match s {
        "pending" => CloudSyncState::Pending,
        "uploading" => CloudSyncState::Uploading,
        "indexing_remote" => CloudSyncState::IndexingRemote,
        "synced" => CloudSyncState::Synced,
        "failed" => CloudSyncState::Failed,
        _ => CloudSyncState::Offline,
    }
}

#[allow(clippy::needless_pass_by_value)]
/// Wrap a raw user query so FTS5 treats it as a plain phrase search rather than
/// trying to parse column filters (`col:term`), boolean operators, or wildcards.
/// FTS5 accepts a double-quoted string literal as a verbatim phrase; internal
/// double-quotes are escaped by doubling them.
fn fts5_escape(query: &str) -> String {
    // Truncate to a safe length so very long prompts don't stress the FTS engine.
    let truncated: String = query.chars().take(500).collect();
    format!("\"{}\"", truncated.replace('"', "\"\""))
}

fn to_vault(err: rusqlite::Error) -> VaultError {
    VaultError::Io(std::io::Error::other(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_entry(id: &str, kind: EntryKind, label_ids: Vec<String>, expires_at: Option<u64>) -> VaultEntry {
        VaultEntry {
            id: id.to_string(),
            kind,
            subkind: None,
            title: format!("Entry {id}"),
            content: Some(format!("content for {id}")),
            source_path: None,
            vault_blob_path: None,
            scope: VaultScope::Global,
            memory_type: MemoryType::User,
            pinned: false,
            tags: vec![],
            label_ids,
            expires_at,
            mime: Some("text/plain".to_string()),
            size_bytes: Some(16),
            index_status: IndexStatus::Indexed,
            cloud_sync_state: CloudSyncState::Offline,
            classifier_confidence: 1.0,
            retrieval_stats: RetrievalStats::default(),
            created_at: 100,
            updated_at: 100,
        }
    }

    fn sample_chunk(entry_id: &str, content: &str) -> VaultChunk {
        VaultChunk {
            id: format!("{entry_id}:0"),
            entry_id: entry_id.to_string(),
            chunk_index: 0,
            content: content.to_string(),
            token_count: Some(content.split_whitespace().count() as u32),
        }
    }

    #[test]
    fn blob_roundtrips_exact_bits() {
        // Mix of ordinary, tiny, negative, and "interesting" floats.
        let input: Vec<f32> = vec![
            0.0,
            1.0,
            -1.0,
            std::f32::consts::PI,
            -std::f32::consts::E,
            1e-20,
            1e20,
            f32::MIN_POSITIVE,
        ];
        let blob = f32_slice_to_blob(&input);
        assert_eq!(blob.len(), input.len() * 4);
        let out = blob_to_f32_vec(&blob, input.len()).expect("decode");
        // Bit-exact: we're not doing any arithmetic, just IEEE-754 memcpy.
        assert_eq!(input, out);
    }

    #[test]
    fn blob_detects_dim_mismatch() {
        let v: Vec<f32> = vec![1.0, 2.0, 3.0];
        let blob = f32_slice_to_blob(&v);
        assert!(blob_to_f32_vec(&blob, 4).is_err());
        assert!(blob_to_f32_vec(&blob, 3).is_ok());
    }

    #[test]
    fn blob_detects_truncation() {
        // Length not a multiple of 4.
        let broken = vec![0u8, 1u8, 2u8];
        assert!(blob_to_f32_vec(&broken, 0).is_err());
    }

    #[test]
    fn blob_is_little_endian() {
        // 1.0f32 = 0x3F800000; in LE bytes: 00 00 80 3F.
        let blob = f32_slice_to_blob(&[1.0]);
        assert_eq!(blob, vec![0x00, 0x00, 0x80, 0x3F]);
    }

    #[test]
    fn list_entries_defaults_to_active_and_can_show_expired_archive() {
        let dir = tempdir().expect("tempdir");
        let store = Store::open(dir.path().join("index.sqlite")).expect("store");
        let now = unix_now();

        store
            .upsert_entry(&sample_entry("legacy", EntryKind::Note, vec![], None))
            .expect("legacy");
        store
            .upsert_entry(&sample_entry("future", EntryKind::Note, vec![], Some(now + 3600)))
            .expect("future");
        store
            .upsert_entry(&sample_entry("past", EntryKind::Note, vec![], Some(now - 1)))
            .expect("past");

        let active = store
            .list_entries(&VaultScope::Global, &VaultListFilters::default())
            .expect("active list");
        let active_ids: Vec<_> = active.iter().map(|entry| entry.id.as_str()).collect();
        assert!(active_ids.contains(&"legacy"));
        assert!(active_ids.contains(&"future"));
        assert!(!active_ids.contains(&"past"));

        let expired = store
            .list_entries(
                &VaultScope::Global,
                &VaultListFilters {
                    expired: Some(true),
                    ..VaultListFilters::default()
                },
            )
            .expect("expired list");
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].id, "past");
    }

    #[test]
    fn label_ids_persist_update_and_prune() {
        let dir = tempdir().expect("tempdir");
        let store = Store::open(dir.path().join("index.sqlite")).expect("store");
        let now = unix_now();

        store
            .upsert_entry(&sample_entry(
                "labeled",
                EntryKind::Note,
                vec!["idea".to_string(), "stale".to_string()],
                Some(now + 3600),
            ))
            .expect("insert");
        let stored = store.get_entry("labeled").expect("get").expect("entry");
        assert_eq!(stored.label_ids, vec!["idea".to_string(), "stale".to_string()]);
        assert_eq!(stored.expires_at, Some(now + 3600));

        let updated = store
            .update_labels_and_expiry(
                "labeled",
                &["renewed".to_string()],
                Some(now + 7200),
                now,
            )
            .expect("update")
            .expect("updated");
        assert_eq!(updated.label_ids, vec!["renewed".to_string()]);
        assert_eq!(updated.expires_at, Some(now + 7200));

        store
            .upsert_entry(&sample_entry(
                "second",
                EntryKind::Note,
                vec!["renewed".to_string(), "other".to_string()],
                Some(now + 7200),
            ))
            .expect("second");
        let pruned = store.prune_label_id("renewed", now).expect("prune");
        assert_eq!(pruned.len(), 2);
        assert!(store
            .get_entry("labeled")
            .expect("get labeled")
            .expect("labeled")
            .label_ids
            .is_empty());
        assert_eq!(
            store
                .get_entry("second")
                .expect("get second")
                .expect("second")
                .label_ids,
            vec!["other".to_string()]
        );
    }

    #[test]
    fn open_migrates_legacy_entries_table_metadata_columns() {
        let dir = tempdir().expect("tempdir");
        let db_path = dir.path().join("index.sqlite");
        {
            let conn = Connection::open(&db_path).expect("legacy db");
            conn.execute_batch(
                r"
                CREATE TABLE entries (
                    id                      TEXT PRIMARY KEY,
                    kind                    TEXT NOT NULL,
                    subkind                 TEXT,
                    title                   TEXT NOT NULL,
                    content                 TEXT,
                    source_path             TEXT,
                    vault_blob_path         TEXT,
                    scope_type              TEXT NOT NULL,
                    scope_project_id        TEXT,
                    memory_type             TEXT NOT NULL,
                    pinned                  INTEGER NOT NULL DEFAULT 0,
                    tags                    TEXT NOT NULL DEFAULT '[]',
                    mime                    TEXT,
                    size_bytes              INTEGER,
                    index_status            TEXT NOT NULL,
                    cloud_sync_state        TEXT NOT NULL,
                    classifier_confidence   REAL NOT NULL,
                    hit_count               INTEGER NOT NULL DEFAULT 0,
                    last_retrieved_at       INTEGER,
                    created_at              INTEGER NOT NULL,
                    updated_at              INTEGER NOT NULL
                );
                INSERT INTO entries (
                    id, kind, subkind, title, content, source_path, vault_blob_path,
                    scope_type, scope_project_id, memory_type, pinned, tags,
                    mime, size_bytes, index_status, cloud_sync_state,
                    classifier_confidence, hit_count, last_retrieved_at,
                    created_at, updated_at
                ) VALUES (
                    'legacy', 'note', NULL, 'Legacy', 'old row', NULL, NULL,
                    'global', NULL, 'user', 0, '[]',
                    'text/plain', 7, 'indexed', 'offline',
                    1.0, 0, NULL,
                    100, 100
                );
                ",
            )
            .expect("legacy schema");
        }

        let store = Store::open(&db_path).expect("migrated store");
        let entry = store.get_entry("legacy").expect("get").expect("entry");
        assert!(entry.label_ids.is_empty());
        assert_eq!(entry.expires_at, None);

        let updated = store
            .update_labels_and_expiry(
                "legacy",
                &["idea".to_string()],
                Some(unix_now() + 3600),
                unix_now(),
            )
            .expect("update")
            .expect("updated");
        assert_eq!(updated.label_ids, vec!["idea".to_string()]);
        assert!(updated.expires_at.is_some());
    }

    #[test]
    fn fts_semantic_and_unsorted_exclude_expired_by_default() {
        let dir = tempdir().expect("tempdir");
        let store = Store::open(dir.path().join("index.sqlite")).expect("store");
        let now = unix_now();

        store
            .upsert_entry(&sample_entry("active", EntryKind::Unsorted, vec![], Some(now + 3600)))
            .expect("active");
        store
            .upsert_entry(&sample_entry("expired", EntryKind::Unsorted, vec![], Some(now - 1)))
            .expect("expired");
        store
            .insert_chunk(&sample_chunk("active", "espresso strategy memo"))
            .expect("active chunk");
        store
            .insert_chunk(&sample_chunk("expired", "espresso stale memo"))
            .expect("expired chunk");

        assert_eq!(store.unsorted_count().expect("unsorted"), 1);

        let fts_active = store
            .fts_search("espresso", &VaultScope::Global, 10, false)
            .expect("fts active");
        assert_eq!(fts_active.len(), 1);
        assert_eq!(fts_active[0].1.id, "active");

        let fts_all = store
            .fts_search("espresso", &VaultScope::Global, 10, true)
            .expect("fts all");
        assert_eq!(fts_all.len(), 2);

        let vector = vec![0.25_f32; EMBEDDING_DIM];
        store
            .update_chunk_embedding("active:0", &vector)
            .expect("active embedding");
        store
            .update_chunk_embedding("expired:0", &vector)
            .expect("expired embedding");
        let semantic_active = store
            .semantic_search(&vector, &VaultScope::Global, 10, false)
            .expect("semantic active");
        assert_eq!(semantic_active.len(), 1);
        assert_eq!(semantic_active[0].1.id, "active");

        let semantic_all = store
            .semantic_search(&vector, &VaultScope::Global, 10, true)
            .expect("semantic all");
        assert_eq!(semantic_all.len(), 2);
    }
}
