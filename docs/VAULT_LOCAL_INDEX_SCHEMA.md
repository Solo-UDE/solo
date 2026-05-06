# Solo Vault Local Index Schema

This is the current local schema for document/vault indexing in Solo. Use this
as the source of truth when creating or adjusting the RDS tables so cloud rows
match what the desktop writes locally.

Authoritative code sources:

- `crates/solo-vault/src/store.rs` - SQLite DDL, indexes, embedding storage.
- `crates/solo-vault/src/pipeline.rs` - ingest, chunking, and embedding flow.
- `crates/solo-protocol/src/lib.rs` - protocol structs and enum values.
- `agent-bridge/src/vault.ts` - read-side SQL used by agent retrieval.

## Current Local Store

- Database path: `~/.solo/vault/index.sqlite`
- Blob path: `~/.solo/vault/blobs/`
- Engine: SQLite with FTS5.
- Tables: `entries`, `chunks`, `chunks_fts`.
- SQLite pragmas on open: `journal_mode = WAL`, `foreign_keys = ON`.
- IDs: UUID strings stored as `TEXT`.
- Timestamps: Unix epoch seconds stored as integers.
- Embeddings: 384-dimensional `f32` vectors stored locally as a packed
  little-endian `BLOB` in `chunks.embedding`.
- Current embedding model family: local MiniLM (`all-MiniLM-L6-v2`), not the
  older OpenAI 1536-dimension schema in early cloud design docs.

## Exact Local SQLite DDL

This is copied from the `SCHEMA` constant in `crates/solo-vault/src/store.rs`.

```sql
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
```

## Column Contract

### `entries`

| Column | Local type | Required | Default | Contract |
| --- | --- | --- | --- | --- |
| `id` | `TEXT` | Yes | None | UUID string generated during ingest. |
| `kind` | `TEXT` | Yes | None | One of the `EntryKind` values below. |
| `subkind` | `TEXT` | No | `NULL` | Classifier sub-type such as `pdf`, `word`, `rust`, `csv`, `zip`. |
| `title` | `TEXT` | Yes | None | Usually the source file name. |
| `content` | `TEXT` | No | `NULL` | Inline note/keyvalue content. File text lives in `chunks.content`. |
| `source_path` | `TEXT` | No | `NULL` | Original local filesystem path. |
| `vault_blob_path` | `TEXT` | No | `NULL` | Copied blob path under `~/.solo/vault/blobs/`. |
| `scope_type` | `TEXT` | Yes | None | `global` or `project`. |
| `scope_project_id` | `TEXT` | No | `NULL` | Project id when `scope_type = 'project'`; `NULL` for global. |
| `memory_type` | `TEXT` | Yes | None | One of the `MemoryType` values below. |
| `pinned` | `INTEGER` | Yes | `0` | Boolean encoded as `0` or `1`. |
| `tags` | `TEXT` | Yes | `'[]'` | JSON array serialized as text, for example `["api","v2"]`. |
| `mime` | `TEXT` | No | `NULL` | MIME string from classifier/sniffer. |
| `size_bytes` | `INTEGER` | No | `NULL` | Original file size in bytes. |
| `index_status` | `TEXT` | Yes | None | One of the `IndexStatus` values below. |
| `cloud_sync_state` | `TEXT` | Yes | None | One of the `CloudSyncState` values below. |
| `classifier_confidence` | `REAL` | Yes | None | Float in `[0.0, 1.0]`; low confidence maps to `unsorted`. |
| `hit_count` | `INTEGER` | Yes | `0` | Incremented when an entry is retrieved. |
| `last_retrieved_at` | `INTEGER` | No | `NULL` | Unix epoch seconds. |
| `created_at` | `INTEGER` | Yes | None | Unix epoch seconds. |
| `updated_at` | `INTEGER` | Yes | None | Unix epoch seconds. |

### `chunks`

| Column | Local type | Required | Default | Contract |
| --- | --- | --- | --- | --- |
| `id` | `TEXT` | Yes | None | UUID string generated per chunk. |
| `entry_id` | `TEXT` | Yes | None | References `entries.id`; delete cascades locally. |
| `chunk_index` | `INTEGER` | Yes | None | Zero-based deterministic order within an entry. |
| `content` | `TEXT` | Yes | None | Extracted text chunk. |
| `token_count` | `INTEGER` | No | `NULL` | Approximate token count from `round(word_count * 1.3)`. |
| `embedding` | `BLOB` | No | `NULL` | Packed little-endian `f32[384]`; `NULL` until embedded/backfilled. |

Uniqueness: `(entry_id, chunk_index)` is unique.

### `chunks_fts`

`chunks_fts` is a derived FTS5 table, not the canonical source of chunk data.
Local writes insert one FTS row per `chunks` row:

| Column | Local type | Indexed | Contract |
| --- | --- | --- | --- |
| `content` | FTS text | Yes | Same text as `chunks.content`. |
| `entry_id` | FTS text | No | Same id as `chunks.entry_id`. |
| `chunk_id` | FTS text | No | Same id as `chunks.id`. |

Deletion is manual in code: the store deletes from `chunks_fts` before deleting
or replacing chunks for an entry.

## Enum Values Stored In Text Columns

`EntryKind` values:

```text
document
code
snippet
image
design
data
config
web
note
keyvalue
audio
archive
unsorted
```

`MemoryType` values:

```text
project
user
pinned_source_of_truth
```

`scope_type` values:

```text
global
project
```

`IndexStatus` values:

```text
pending
extracting
chunking
embedding
storing
indexed
extraction_failed
failed
```

`CloudSyncState` values:

```text
offline
pending
uploading
indexing_remote
synced
failed
```

## Local Ingest And Indexing Behavior

1. Validate the source path is a regular file and is at most 50 MB.
2. Classify by config filename, extension, then MIME fallback.
3. Copy the source file to `~/.solo/vault/blobs/{entry_id}.{ext}`.
4. Extract text with `LocalTextExtractor`.
5. Chunk text by words:
   - `CHUNK_WORDS = 500`
   - `CHUNK_OVERLAP_WORDS = 50`
   - step size is 450 words.
6. Insert the `entries` row.
7. Insert one `chunks` row and one `chunks_fts` row per chunk.
8. Best-effort embed chunks if the local embedding provider is loaded.
9. Store embeddings only when the vector length is exactly 384.

If extraction fails for a file type that should produce searchable text, the
entry is kept with `index_status = 'extraction_failed'`. For plain text formats,
an empty file can still be `indexed` with zero chunks.

## RDS Mirror Recommendation

For RDS, keep the local logical schema intact. The safest layout is a Postgres
schema named `vault` with table names matching local names:

- `vault.entries`
- `vault.chunks`
- `vault.chunks_fts`

If cloud tenancy requires user ownership, add cloud-only ownership outside the
local parity columns, for example `user_id` on both `entries` and `chunks`, or a
separate ownership table. Do not rename or reinterpret the local columns used
by sync/retrieval.

### Search-ready PostgreSQL DDL

This DDL keeps the same column names and serialized values as local. The only
intentional storage translation is `chunks.embedding`: SQLite stores bytes,
while RDS should use `vector(384)` when pgvector search is required.

```sql
CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS vault.entries (
    id                      text PRIMARY KEY,
    kind                    text NOT NULL,
    subkind                 text,
    title                   text NOT NULL,
    content                 text,
    source_path             text,
    vault_blob_path         text,
    scope_type              text NOT NULL,
    scope_project_id        text,
    memory_type             text NOT NULL,
    pinned                  integer NOT NULL DEFAULT 0,
    tags                    text NOT NULL DEFAULT '[]',
    mime                    text,
    size_bytes              bigint,
    index_status            text NOT NULL,
    cloud_sync_state        text NOT NULL,
    classifier_confidence   double precision NOT NULL,
    hit_count               bigint NOT NULL DEFAULT 0,
    last_retrieved_at       bigint,
    created_at              bigint NOT NULL,
    updated_at              bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_scope
    ON vault.entries(scope_type, scope_project_id);
CREATE INDEX IF NOT EXISTS idx_entries_kind
    ON vault.entries(kind);
CREATE INDEX IF NOT EXISTS idx_entries_pin
    ON vault.entries(pinned);

CREATE TABLE IF NOT EXISTS vault.chunks (
    id           text PRIMARY KEY,
    entry_id     text NOT NULL REFERENCES vault.entries(id) ON DELETE CASCADE,
    chunk_index  bigint NOT NULL,
    content      text NOT NULL,
    token_count  bigint,
    embedding    vector(384),
    UNIQUE (entry_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_entry
    ON vault.chunks(entry_id);

-- pgvector cosine index. Create after loading enough rows for useful lists.
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_cosine
    ON vault.chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
    WHERE embedding IS NOT NULL;

-- Materialized FTS mirror for the local chunks_fts table shape.
CREATE TABLE IF NOT EXISTS vault.chunks_fts (
    content  text NOT NULL,
    entry_id text NOT NULL,
    chunk_id text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_fts_entry
    ON vault.chunks_fts(entry_id);
CREATE INDEX IF NOT EXISTS idx_chunks_fts_chunk
    ON vault.chunks_fts(chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunks_fts_content
    ON vault.chunks_fts
    USING gin (to_tsvector('english', content));
```

### Byte-for-byte Embedding Mirror Option

If the RDS goal is byte-for-byte storage parity with SQLite instead of pgvector
search, store `chunks.embedding` as `bytea` and require the value to contain
exactly 1536 bytes when non-null:

```sql
embedding bytea,
CHECK (embedding IS NULL OR octet_length(embedding) = 1536)
```

That matches local storage, but it prevents native pgvector cosine indexes. The
current cloud search design should use `vector(384)` and preserve exact vector
values rather than exact SQLite byte encoding.

## RDS Query Shape To Match Local Retrieval

FTS retrieval joins `chunks_fts -> chunks -> entries`, includes global entries,
and includes project entries only for the requested project:

```sql
SELECT
    c.id AS chunk_id,
    c.entry_id,
    c.chunk_index,
    c.content,
    e.title,
    e.kind,
    e.pinned,
    e.scope_type,
    e.scope_project_id
FROM vault.chunks_fts f
JOIN vault.chunks c ON c.id = f.chunk_id
JOIN vault.entries e ON e.id = c.entry_id
WHERE to_tsvector('english', f.content) @@ plainto_tsquery('english', $1)
  AND (
      e.scope_type = 'global'
      OR (e.scope_type = 'project' AND e.scope_project_id = $2)
  )
LIMIT $3;
```

Semantic retrieval uses `vault.chunks.embedding <=> query_vector` with the same
scope filter:

```sql
SELECT
    c.id AS chunk_id,
    c.entry_id,
    c.chunk_index,
    c.content,
    e.title,
    e.kind,
    e.pinned,
    1 - (c.embedding <=> $1::vector) AS score
FROM vault.chunks c
JOIN vault.entries e ON e.id = c.entry_id
WHERE c.embedding IS NOT NULL
  AND (
      e.scope_type = 'global'
      OR (e.scope_type = 'project' AND e.scope_project_id = $2)
  )
ORDER BY c.embedding <=> $1::vector
LIMIT $3;
```

## Parity Checks

Use these checks when comparing local and RDS schemas.

Local SQLite:

```sql
SELECT name, type, sql
FROM sqlite_master
WHERE name IN (
    'entries',
    'chunks',
    'chunks_fts',
    'idx_entries_scope',
    'idx_entries_kind',
    'idx_entries_pin',
    'idx_chunks_entry'
)
ORDER BY type, name;

PRAGMA table_info(entries);
PRAGMA table_info(chunks);
```

RDS:

```sql
SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'vault'
  AND table_name IN ('entries', 'chunks', 'chunks_fts')
ORDER BY table_name, ordinal_position;
```

Expected high-risk mismatch checks:

- `chunks.embedding` must be 384-dimensional in RDS, not 1536-dimensional.
- `entries.tags` is currently a JSON array serialized into a text column locally.
- `entries.pinned` is `0` or `1` locally.
- `scope_type = 'global'` rows should have no `scope_project_id`.
- `scope_type = 'project'` rows must carry the matching `scope_project_id`.
- `chunks.chunk_index` must remain zero-based and unique per entry.
- `chunks_fts` is rebuildable from `chunks`; do not treat it as canonical data.
