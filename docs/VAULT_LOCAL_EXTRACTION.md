# Solo Vault Local Extraction

This document describes the local-first extraction path used by the desktop
vault. The goal is to make dropped files searchable on-device now while keeping
the extraction service pluggable for cloud indexing later.

## Runtime Flow

1. `vault_drop_paths` calls `Vault::drop_paths`.
2. The vault copies the original file into `~/.solo/vault/blobs/`.
3. `pipeline::ingest_and_store` calls the configured `TextExtractor`.
4. Local extraction returns plain text plus an outcome.
5. The deterministic chunker creates vault chunks.
6. Chunks are stored in SQLite/FTS and embedded when the local embedding model
   is available.

The default extractor is `LocalTextExtractor` in
`crates/solo-vault/src/extractors.rs`. The vault stores it behind the
`TextExtractor` trait, so a cloud or chained extractor can be installed later
with `Vault::set_text_extractor`.

## Local Support Matrix

| Kind | Subkind / files | Local behavior |
|---|---|---|
| Document | `.pdf` | `pdf-extract` with a 30s task timeout. Text PDFs index locally. Scanned/encrypted PDFs become `extraction_failed` until OCR is connected. |
| Document | `.docx` | Reads Word XML from the DOCX ZIP and indexes body, headers, footers, footnotes, endnotes, and comments. |
| Document | `.doc` | Best-effort legacy binary scan for printable ASCII/UTF-16 text. If no text is found, status is `extraction_failed`. |
| Document | `.rtf` | Strips common RTF control words and indexes readable text. |
| Document | `.epub` | Reads XHTML/HTML files inside the EPUB container and converts them to text. |
| Document | `.md`, `.markdown`, `.txt` | UTF-8 lossy text indexing. Empty text files are allowed and remain `indexed`. |
| Data | `.xlsx`, `.xls` | Uses `calamine`; indexes sheet names and up to 1,000 rows per sheet. |
| Data | `.parquet` | Uses the Parquet reader; indexes row count, row-group count, schema, and the first 100 rows. |
| Data | `.csv`, `.tsv`, `.json`, `.yaml`, `.yml`, `.toml` | UTF-8 lossy text indexing. |
| Web | `.html`, `.htm` | Converts HTML to text with `html2text`. |
| Web | `.url`, `.webloc` | Extracts bookmark URLs from INI or XML/plist text. |
| Image | `.svg` | Extracts text, title, desc, and tspan nodes. |
| Image | raster formats | Blob is stored locally, but OCR is not bundled; entry status is `extraction_failed`. |
| Archive | `.zip`, `.tar`, `.gz`, `.bz2`, `.tar.gz`, `.tar.bz2` | Extracts searchable text-like members with member names. Member count, member size, and total extracted text are capped. |
| Archive | `.7z`, `.rar` | Blob is stored, status is `extraction_failed` until an extractor is added. |
| Audio / Design | audio and proprietary design binaries | Blob is stored, status is `extraction_failed` until local transcription/OCR or a cloud extractor is connected. |

## Status Semantics

`IndexStatus::ExtractionFailed` means the blob is stored but no searchable text
chunks were produced for a file type that should be searchable or requires OCR,
transcription, or a future cloud extractor. This replaces the old silent
zero-chunk behavior where PDFs could appear `indexed` even though search had
nothing to query.

`IndexStatus::Indexed` means extraction completed without a failure condition.
For plain text formats, an empty file can still be `indexed` with zero chunks.

## Re-Extracting Legacy Entries

Older vault entries may be marked `indexed` while having zero chunks or chunks
created from raw binary bytes. The new recovery path handles those entries
without requiring a re-upload:

- Rust API: `Vault::reextract_legacy_entries`
- Tauri command: `vault_reextract`
- Count command: `vault_pending_reextract_count`
- Progress event: `vault:reextract_progress`

The recovery query only targets legacy `indexed` entries with stored blobs and
either zero chunks or known raw-binary chunk signatures for formats that
previously had binary extraction gaps: PDFs, Word, RTF, EPUB, Excel, Parquet,
SVG, and supported archives. If extraction still fails, the entry is updated to
`extraction_failed` so it no longer loops as recoverable local work.

## Cloud Adapter Contract

Cloud extraction should implement the same `TextExtractor` trait:

```rust
#[async_trait]
pub trait TextExtractor: Send + Sync {
    async fn extract(&self, input: ExtractionInput) -> ExtractionOutput;
    fn name(&self) -> &'static str;
}
```

Recommended cloud behavior:

- Keep local extraction as the first pass for cheap deterministic formats.
- Route `extraction_failed` formats to cloud OCR/transcription/extraction.
- Return plain text only; chunking stays in the shared vault pipeline so local
  and cloud chunk boundaries remain consistent.
- Preserve the same `kind`, `subkind`, `mime`, and stored blob bytes as input.
- Emit remote progress separately through cloud sync state while local indexing
  continues to use `IndexStatus`.

This keeps the future cloud service responsible for extraction quality and scale
without duplicating chunking, SQLite writes, embedding backfill, or UI recovery
logic.
