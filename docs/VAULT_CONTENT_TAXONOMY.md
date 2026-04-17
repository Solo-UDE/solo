# Solo Vault — Content Taxonomy (for Cloud Indexer)

**Audience:** Backend/infra engineers building the AWS indexing pipeline (Step Functions + Lambdas) described in `solo/docs/superpowers/specs/2026-04-05-vault-cloud-design.md`.

**Purpose:** This document defines every type of content that may enter the vault, how it is classified on the IDE side, and what the indexing pipeline must produce for each type so that local (IDE, SQLite + sqlite-vec) and cloud (RDS + pgvector) indexes stay byte-identical.

Embedding model (both sides): **OpenAI `text-embedding-3-small`, 1536 dim**. Chunk size: ~500 tokens, 50-token overlap. Deterministic chunker — same input must produce identical chunks in local and cloud.

---

## Classification rules

On upload the IDE infers `EntryKind` via this chain:

1. **MIME sniff** (magic bytes) — authoritative when possible.
2. **Extension** — tie-breaker / primary for text files.
3. **Content probe** — first 4 KB scanned for language / schema signals when MIME is generic (`text/plain`, `application/octet-stream`).
4. **Confidence score** — if under 0.6, entry is marked `Unsorted` locally and sent to the pipeline with `kind = "unsorted"`. The pipeline still processes it (best-effort text extract + embed) so hints can still find it later.

The IDE sends `kind`, `subkind`, `mime`, `scope`, `tags[]`, and `classifier_confidence` in the pre-signed-URL create request so Lambda extractors can dispatch on `kind` without re-sniffing.

---

## Entry Kind Table


| EntryKind          | Detection signals                                                                                                                                                                                                | Example files                        | Extraction (Lambda stage 2)                                                                               | Chunking rule                                                                | Vault bucket (UI)    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------- |
| `document`         | MIME `application/pdf`, `application/vnd.openxmlformats-officedocument.*`, `text/markdown`, `text/plain`, `.rtf`, `.pages`                                                                                       | spec.pdf, README.md, notes.docx      | PDF → pdf-parse or Textract; DOCX → python-docx; MD/TXT raw                                               | Paragraph-aware, 500 tok / 50 overlap                                        | Docs                 |
| `code`             | extension is a known language (`.rs .ts .tsx .js .jsx .py .go .rb .java .kt .swift .c .cpp .h .sql .sh .lua`) OR tree-sitter parse succeeds                                                                      | main.rs, util.ts, query.sql          | tree-sitter symbols (functions, classes, types) + raw source                                              | Split on symbol boundaries first, then 500 tok                               | Code                 |
| `snippet`          | tiny file (< 2 KB) classified as code, OR clipboard-origin flag                                                                                                                                                  | one-function paste, SQL block        | same as `code` but no symbol split needed                                                                 | Single chunk preferred                                                       | Snippets             |
| `image`            | MIME `image/png`, `image/jpeg`, `image/webp`, `image/heic`, `image/svg+xml`                                                                                                                                      | screenshot.png, mockup.jpg           | OCR via **Textract** (text) + **Rekognition / CLIP via Bedrock** for image embedding; thumbnail via Sharp | OCR text chunked like document; image itself produces 1 multimodal embedding | Evidence             |
| `design`           | MIME `image/svg+xml` with text layers; `.fig`, `.sketch`, `.psd` (treated as image + binary)                                                                                                                     | mockup.fig, icon.svg                 | extract embedded text + raster preview → Textract                                                         | Text chunks + 1 image embedding                                              | Evidence             |
| `data`             | MIME `text/csv`, `application/json`, `application/x-yaml`, `application/toml`, `application/vnd.apache.parquet`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | users.csv, config.json, data.parquet | Schema (headers / top-level keys) + first 100 rows as narrative + raw JSON/CSV text                       | Schema chunk + row-sample chunks (500 tok)                                   | Data                 |
| `config`           | filenames: `.env.example`, `Dockerfile`, `docker-compose.yml`, `*.tf`, `nginx.conf`, `.prettierrc`, `tsconfig.json`, `Cargo.toml`, `package.json`, k8s YAML                                                      | deployment.yaml, Dockerfile          | Key/value extract + raw                                                                                   | 1–2 chunks typical                                                           | Configs              |
| `web`              | MIME `text/html`, extension `.html` `.htm` `.url` `.webloc`                                                                                                                                                      | saved article, bookmark              | **Readability** text extract (strip nav/ads), canonical URL in metadata                                   | Paragraph-aware, 500 tok                                                     | Docs                 |
| `note`             | No file — user typed in Vault panel                                                                                                                                                                              | Inline note                          | Markdown raw                                                                                              | 500 tok                                                                      | Notes                |
| `keyvalue`         | No file — user enters labeled key/value pair                                                                                                                                                                     | `"prod_db_url": "postgres://..."`    | Treated as config; value chunked, key in metadata                                                         | Single chunk                                                                 | Configs              |
| `audio` *(v1.1)*   | MIME `audio/*`                                                                                                                                                                                                   | meeting.m4a                          | **Transcribe** → text                                                                                     | Segment by speaker or 30 s                                                   | Evidence             |
| `archive` *(v1.1)* | MIME `application/zip`, `application/x-tar`                                                                                                                                                                      | repo.zip                             | Expand → recursively classify each member; original archive kept as `source_path` only                    | Per-member chunking                                                          | mixed                |
| `unsorted`         | classifier confidence < 0.6                                                                                                                                                                                      | ambiguous text blob                  | Best-effort text extract → embed                                                                          | 500 tok                                                                      | Unsorted review tray |


---

## Metadata contract (what IDE posts to `POST /vault/entries`)

```json
{
  "kind": "document",
  "subkind": "pdf",
  "title": "API Design Spec",
  "scope": { "type": "project", "project_id": "..." } | { "type": "global" },
  "tags": ["api", "v2"],
  "source_path": "/Users/.../Downloads/spec.pdf",
  "mime": "application/pdf",
  "size_bytes": 184320,
  "classifier_confidence": 0.93,
  "client_id": "uuid-generated-locally",
  "placement_hint": "apps/desktop/docs/specs/spec.pdf",
  "pinned": false,
  "memory_type": "project" | "user" | "pinned_source_of_truth"
}
```

The cloud returns `entry_id` + pre-signed PUT URL for the file. After upload the S3 event triggers the pipeline.

---

## What the pipeline must guarantee

- **Deterministic chunking:** local and cloud must produce identical chunk boundaries and `chunk_index`. A shared chunker spec (algorithm + tokenizer version) must be published.
- **Idempotency:** re-uploading the same `client_id` must not create duplicate chunks. Use `(client_id, chunk_index)` as a unique key on `vault_chunks`.
- **Progress events:** every stage transition emits a WebSocket frame per the spec (`type: "index_progress"`). The IDE mirrors these against local pipeline events so the UI shows one unified progress bar.
- **Re-index on schema change:** if the embedding model or chunker version changes, all entries must be re-embeddable via `POST /vault/entries/{id}/reindex`.
- **Scope filter on search:** `vault_search` must filter `user_id = ? AND (project_id = ? OR project_id IS NULL)` — global entries are visible from every project; project entries are isolated.
- **Pinned / memory-type filter:** searches should boost `pinned = true` entries and respect `memory_type` when the IDE requests only pinned sources of truth.

---

## Open questions for the cloud team

1. **Image embeddings:** Bedrock Titan Multimodal vs OpenAI CLIP API vs self-hosted ONNX? Pick one now — IDE needs to know the vector dimension.
2. **Max file size:** default 50 MB in IDE validation. Confirm matching Lambda / API Gateway limits (GW is 10 MB sync; must use pre-signed PUT for anything larger — already planned).
3. **Chunker implementation:** please commit the chunker as a shared library (Rust + Node bindings, or both re-implement against the same spec + fixture tests).
4. **Rekognition vs Textract OCR:** Textract handles scanned docs better; Rekognition is lighter for simple text-in-image. A mixed pipeline (try Textract first, fallback Rekognition) is fine but must be deterministic.
5. **DLQ replay API:** when a pipeline stage dead-letters, does the IDE get a `failed` status, or a silent retry? The IDE shows a red cloud icon on `failed` and offers a "retry" button — backend needs to expose a replay endpoint.

&nbsp;