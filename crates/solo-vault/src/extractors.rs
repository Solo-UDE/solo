//! Pluggable text extraction for vault entries.
//!
//! The vault indexes text chunks locally today, but the caller only depends on
//! the `TextExtractor` trait. A cloud-backed extractor can be installed later
//! without changing ingest, re-extract, or embedding code.

use std::fs::{self, File};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;

use async_trait::async_trait;
use calamine::{open_workbook_auto, Data, Reader as CalamineReader};
use flate2::read::GzDecoder;
use parquet::file::reader::{FileReader, SerializedFileReader};
use quick_xml::events::Event;
use quick_xml::reader::Reader as XmlReader;
use solo_protocol::EntryKind;
use tracing::{debug, warn};
use zip::ZipArchive;

const EXTRACTION_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ARCHIVE_MEMBERS: usize = 200;
const MAX_ARCHIVE_MEMBER_BYTES: u64 = 10 * 1024 * 1024;
const MAX_ARCHIVE_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_SPREADSHEET_ROWS_PER_SHEET: usize = 1_000;
const MAX_PARQUET_ROWS: usize = 100;

#[derive(Debug, Clone)]
pub struct ExtractionInput {
    pub path: PathBuf,
    pub kind: EntryKind,
    pub subkind: Option<String>,
    pub mime: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtractionDisposition {
    Extracted,
    Empty,
    Unsupported,
    Failed,
}

#[derive(Debug, Clone)]
pub struct ExtractionOutput {
    pub text: String,
    pub disposition: ExtractionDisposition,
    pub extractor: &'static str,
    pub message: Option<String>,
    /// True when zero chunks should surface as `IndexStatus::ExtractionFailed`.
    pub fail_on_empty: bool,
}

impl ExtractionOutput {
    fn extracted(text: String, extractor: &'static str, fail_on_empty: bool) -> Self {
        let text = normalize_text(&text);
        if text.trim().is_empty() {
            Self::empty(extractor, fail_on_empty, None)
        } else {
            Self {
                text,
                disposition: ExtractionDisposition::Extracted,
                extractor,
                message: None,
                fail_on_empty,
            }
        }
    }

    fn empty(extractor: &'static str, fail_on_empty: bool, message: Option<String>) -> Self {
        Self {
            text: String::new(),
            disposition: ExtractionDisposition::Empty,
            extractor,
            message,
            fail_on_empty,
        }
    }

    fn unsupported(extractor: &'static str, message: impl Into<String>) -> Self {
        Self {
            text: String::new(),
            disposition: ExtractionDisposition::Unsupported,
            extractor,
            message: Some(message.into()),
            fail_on_empty: true,
        }
    }

    fn failed(extractor: &'static str, message: impl Into<String>) -> Self {
        Self {
            text: String::new(),
            disposition: ExtractionDisposition::Failed,
            extractor,
            message: Some(message.into()),
            fail_on_empty: true,
        }
    }

    pub fn marks_extraction_failed(&self, chunks_len: usize) -> bool {
        chunks_len == 0
            && (self.fail_on_empty
                || matches!(
                    self.disposition,
                    ExtractionDisposition::Failed | ExtractionDisposition::Unsupported
                ))
    }
}

#[async_trait]
pub trait TextExtractor: Send + Sync {
    async fn extract(&self, input: ExtractionInput) -> ExtractionOutput;

    fn name(&self) -> &'static str;
}

#[derive(Debug, Default)]
pub struct LocalTextExtractor;

#[async_trait]
impl TextExtractor for LocalTextExtractor {
    async fn extract(&self, input: ExtractionInput) -> ExtractionOutput {
        let path = input.path.clone();
        let kind = input.kind;
        let subkind = input.subkind.clone();
        let mime = input.mime.clone();

        let task = tokio::task::spawn_blocking(move || {
            extract_local_blocking(&path, kind, subkind.as_deref(), mime.as_deref())
        });

        match tokio::time::timeout(EXTRACTION_TIMEOUT, task).await {
            Ok(Ok(out)) => out,
            Ok(Err(join_err)) => ExtractionOutput::failed(
                "local",
                format!("extractor task failed or panicked: {join_err}"),
            ),
            Err(_) => ExtractionOutput::failed(
                "local",
                format!(
                    "extraction timed out after {}s",
                    EXTRACTION_TIMEOUT.as_secs()
                ),
            ),
        }
    }

    fn name(&self) -> &'static str {
        "local"
    }
}

fn extract_local_blocking(
    path: &Path,
    kind: EntryKind,
    subkind: Option<&str>,
    _mime: Option<&str>,
) -> ExtractionOutput {
    let subkind = subkind.unwrap_or_default();
    match kind {
        EntryKind::Document => extract_document(path, subkind),
        EntryKind::Data => extract_data(path, subkind),
        EntryKind::Web => extract_web(path, subkind),
        EntryKind::Archive => extract_archive(path, subkind),
        EntryKind::Image if subkind == "svg" => extract_svg_file(path),
        EntryKind::Code
        | EntryKind::Snippet
        | EntryKind::Config
        | EntryKind::Note
        | EntryKind::Keyvalue => extract_utf8_file(path, false, "text"),
        EntryKind::Unsorted => extract_unsorted(path),
        EntryKind::Image => ExtractionOutput::unsupported(
            "local-image",
            "local OCR is not configured for raster images",
        ),
        EntryKind::Design => ExtractionOutput::unsupported(
            "local-design",
            "local design-file text extraction is not configured",
        ),
        EntryKind::Audio => ExtractionOutput::unsupported(
            "local-audio",
            "local audio transcription is not wired into vault extraction",
        ),
    }
}

fn extract_document(path: &Path, subkind: &str) -> ExtractionOutput {
    match subkind {
        "pdf" => extract_pdf(path),
        "word" => extract_word(path),
        "rtf" => extract_rtf_file(path),
        "epub" => extract_epub(path),
        "markdown" | "text" => extract_utf8_file(path, false, "text"),
        _ => extract_utf8_file(path, false, "document-text"),
    }
}

fn extract_data(path: &Path, subkind: &str) -> ExtractionOutput {
    match subkind {
        "excel" => extract_excel(path),
        "parquet" => extract_parquet(path),
        "csv" | "json" | "yaml" | "toml" => extract_utf8_file(path, false, "text"),
        _ => extract_utf8_file(path, false, "data-text"),
    }
}

fn extract_web(path: &Path, subkind: &str) -> ExtractionOutput {
    match subkind {
        "html" => match fs::read(path) {
            Ok(bytes) => extract_html_bytes(&bytes, true, "html"),
            Err(e) => ExtractionOutput::failed("html", e.to_string()),
        },
        "bookmark" => extract_bookmark(path),
        _ => extract_utf8_file(path, false, "web-text"),
    }
}

fn extract_unsorted(path: &Path) -> ExtractionOutput {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) => return ExtractionOutput::failed("unsorted", e.to_string()),
    };
    if looks_binary(&bytes) {
        ExtractionOutput::unsupported("unsorted", "unknown binary file")
    } else {
        ExtractionOutput::extracted(
            String::from_utf8_lossy(&bytes).into_owned(),
            "unsorted",
            false,
        )
    }
}

fn extract_pdf(path: &Path) -> ExtractionOutput {
    match std::panic::catch_unwind(|| pdf_extract::extract_text(path)) {
        Ok(Ok(text)) => ExtractionOutput::extracted(text, "pdf-extract", true),
        Ok(Err(e)) => ExtractionOutput::failed("pdf-extract", e.to_string()),
        Err(_) => ExtractionOutput::failed("pdf-extract", "pdf extractor panicked"),
    }
}

fn extract_word(path: &Path) -> ExtractionOutput {
    match extract_docx(path) {
        Ok(text) => ExtractionOutput::extracted(text, "docx-zip", true),
        Err(docx_err) => {
            let legacy = extract_legacy_doc(path);
            if legacy.trim().is_empty() {
                ExtractionOutput::failed(
                    "word",
                    format!("docx parser failed and legacy scan found no text: {docx_err}"),
                )
            } else {
                ExtractionOutput::extracted(legacy, "legacy-doc-scan", true)
            }
        }
    }
}

fn extract_docx(path: &Path) -> std::result::Result<String, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut out = String::new();
    let wanted_prefixes = [
        "word/document.xml",
        "word/header",
        "word/footer",
        "word/footnotes.xml",
        "word/endnotes.xml",
        "word/comments.xml",
    ];
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        if !wanted_prefixes
            .iter()
            .any(|prefix| name.starts_with(prefix))
        {
            continue;
        }
        let mut xml = String::new();
        file.read_to_string(&mut xml).map_err(|e| e.to_string())?;
        out.push_str(&extract_xml_text(&xml, &["p", "br", "tab"]));
        out.push('\n');
    }
    Ok(out)
}

fn extract_rtf_file(path: &Path) -> ExtractionOutput {
    match fs::read(path) {
        Ok(bytes) => {
            let raw = String::from_utf8_lossy(&bytes);
            ExtractionOutput::extracted(strip_rtf(&raw), "rtf", true)
        }
        Err(e) => ExtractionOutput::failed("rtf", e.to_string()),
    }
}

fn extract_epub(path: &Path) -> ExtractionOutput {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(e) => return ExtractionOutput::failed("epub", e.to_string()),
    };
    let mut zip = match ZipArchive::new(file) {
        Ok(zip) => zip,
        Err(e) => return ExtractionOutput::failed("epub", e.to_string()),
    };
    let mut out = String::new();
    for i in 0..zip.len().min(MAX_ARCHIVE_MEMBERS) {
        let Ok(mut file) = zip.by_index(i) else {
            continue;
        };
        let name = file.name().to_ascii_lowercase();
        if !(name.ends_with(".xhtml") || name.ends_with(".html") || name.ends_with(".htm")) {
            continue;
        }
        if file.size() > MAX_ARCHIVE_MEMBER_BYTES {
            continue;
        }
        let mut bytes = Vec::new();
        if file.read_to_end(&mut bytes).is_ok() {
            let text = extract_html_bytes(&bytes, false, "epub-html").text;
            if !text.trim().is_empty() {
                out.push_str("EPUB section: ");
                out.push_str(&name);
                out.push('\n');
                out.push_str(&text);
                out.push_str("\n\n");
            }
        }
    }
    ExtractionOutput::extracted(out, "epub", true)
}

fn extract_bookmark(path: &Path) -> ExtractionOutput {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) => return ExtractionOutput::failed("bookmark", e.to_string()),
    };
    if path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("url"))
    {
        let url = text
            .lines()
            .find_map(|line| line.strip_prefix("URL="))
            .unwrap_or(text.trim());
        return ExtractionOutput::extracted(format!("Bookmark URL: {url}"), "bookmark", true);
    }
    let xml_text = extract_xml_text(&text, &["string"]);
    if xml_text.trim().is_empty() {
        ExtractionOutput::extracted(text, "bookmark", true)
    } else {
        ExtractionOutput::extracted(format!("Bookmark URL: {xml_text}"), "bookmark", true)
    }
}

fn extract_excel(path: &Path) -> ExtractionOutput {
    let mut workbook = match open_workbook_auto(path) {
        Ok(workbook) => workbook,
        Err(e) => return ExtractionOutput::failed("excel", e.to_string()),
    };

    let mut out = String::new();
    for sheet_name in workbook.sheet_names().to_owned() {
        let Ok(range) = workbook.worksheet_range(&sheet_name) else {
            continue;
        };
        out.push_str("Sheet: ");
        out.push_str(&sheet_name);
        out.push('\n');
        for (row_i, row) in range
            .rows()
            .take(MAX_SPREADSHEET_ROWS_PER_SHEET)
            .enumerate()
        {
            let values: Vec<String> = row
                .iter()
                .map(cell_to_string)
                .map(|value| value.replace('\t', " "))
                .collect();
            if values.iter().all(|value| value.trim().is_empty()) {
                continue;
            }
            out.push_str(&(row_i + 1).to_string());
            out.push_str(": ");
            out.push_str(&values.join("\t"));
            out.push('\n');
        }
        out.push('\n');
    }
    ExtractionOutput::extracted(out, "excel", true)
}

fn extract_parquet(path: &Path) -> ExtractionOutput {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(e) => return ExtractionOutput::failed("parquet", e.to_string()),
    };
    let reader = match SerializedFileReader::new(file) {
        Ok(reader) => reader,
        Err(e) => return ExtractionOutput::failed("parquet", e.to_string()),
    };
    let metadata = reader.metadata();
    let file_metadata = metadata.file_metadata();

    let mut out = String::new();
    out.push_str("Parquet rows: ");
    out.push_str(&file_metadata.num_rows().to_string());
    out.push('\n');
    out.push_str("Parquet row groups: ");
    out.push_str(&metadata.num_row_groups().to_string());
    out.push('\n');
    out.push_str("Parquet schema:\n");
    out.push_str(&format!("{:#?}", file_metadata.schema()));
    out.push_str("\n\nSample rows:\n");

    match reader.get_row_iter(None) {
        Ok(iter) => {
            for (row_i, row) in iter.take(MAX_PARQUET_ROWS).enumerate() {
                match row {
                    Ok(row) => {
                        out.push_str(&(row_i + 1).to_string());
                        out.push_str(": ");
                        let values = row
                            .get_column_iter()
                            .map(|(name, field)| format!("{name}={field}"))
                            .collect::<Vec<_>>()
                            .join(", ");
                        out.push_str(&values);
                        out.push('\n');
                    }
                    Err(e) => {
                        warn!(err = %e, "vault.extract.parquet.row_failed");
                    }
                }
            }
        }
        Err(e) => {
            debug!(err = %e, "vault.extract.parquet.rows_unavailable");
        }
    }

    ExtractionOutput::extracted(out, "parquet", true)
}

fn extract_archive(path: &Path, subkind: &str) -> ExtractionOutput {
    match subkind {
        "zip" => extract_zip_archive(path),
        "tar" => extract_tar_archive(path),
        "gzip" => extract_gzip(path),
        "bzip2" => extract_bzip2(path),
        "7z" | "rar" => ExtractionOutput::unsupported(
            "archive",
            format!("local extraction for .{subkind} archives is not configured"),
        ),
        _ => ExtractionOutput::unsupported("archive", "unknown archive format"),
    }
}

fn extract_zip_archive(path: &Path) -> ExtractionOutput {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(e) => return ExtractionOutput::failed("zip", e.to_string()),
    };
    let mut zip = match ZipArchive::new(file) {
        Ok(zip) => zip,
        Err(e) => return ExtractionOutput::failed("zip", e.to_string()),
    };
    let mut out = String::new();
    for i in 0..zip.len().min(MAX_ARCHIVE_MEMBERS) {
        let Ok(mut file) = zip.by_index(i) else {
            continue;
        };
        if file.is_dir() || file.size() > MAX_ARCHIVE_MEMBER_BYTES {
            continue;
        }
        let name = file.name().to_string();
        let mut bytes = Vec::new();
        if file.read_to_end(&mut bytes).is_ok() {
            append_archive_member_text(&mut out, &name, &bytes);
        }
        if out.len() >= MAX_ARCHIVE_TEXT_BYTES {
            break;
        }
    }
    ExtractionOutput::extracted(out, "zip", true)
}

fn extract_tar_archive(path: &Path) -> ExtractionOutput {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(e) => return ExtractionOutput::failed("tar", e.to_string()),
    };
    extract_tar_reader(file, "tar")
}

fn extract_gzip(path: &Path) -> ExtractionOutput {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(e) => return ExtractionOutput::failed("gzip", e.to_string()),
    };
    if path
        .file_name()
        .and_then(|f| f.to_str())
        .is_some_and(|name| name.ends_with(".tar.gz") || name.ends_with(".tgz"))
    {
        return extract_tar_reader(GzDecoder::new(file), "tar.gz");
    }
    let mut decoder = GzDecoder::new(file);
    let mut bytes = Vec::new();
    match decoder.read_to_end(&mut bytes) {
        Ok(_) => {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("decompressed");
            let mut out = String::new();
            append_archive_member_text(&mut out, name, &bytes);
            ExtractionOutput::extracted(out, "gzip", true)
        }
        Err(e) => ExtractionOutput::failed("gzip", e.to_string()),
    }
}

fn extract_bzip2(path: &Path) -> ExtractionOutput {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(e) => return ExtractionOutput::failed("bzip2", e.to_string()),
    };
    if path
        .file_name()
        .and_then(|f| f.to_str())
        .is_some_and(|name| name.ends_with(".tar.bz2") || name.ends_with(".tbz2"))
    {
        return extract_tar_reader(bzip2::read::BzDecoder::new(file), "tar.bz2");
    }
    let mut decoder = bzip2::read::BzDecoder::new(file);
    let mut bytes = Vec::new();
    match decoder.read_to_end(&mut bytes) {
        Ok(_) => {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("decompressed");
            let mut out = String::new();
            append_archive_member_text(&mut out, name, &bytes);
            ExtractionOutput::extracted(out, "bzip2", true)
        }
        Err(e) => ExtractionOutput::failed("bzip2", e.to_string()),
    }
}

fn extract_tar_reader<R: Read>(reader: R, extractor: &'static str) -> ExtractionOutput {
    let mut archive = tar::Archive::new(reader);
    let entries = match archive.entries() {
        Ok(entries) => entries,
        Err(e) => return ExtractionOutput::failed(extractor, e.to_string()),
    };
    let mut out = String::new();
    for entry in entries.take(MAX_ARCHIVE_MEMBERS) {
        let Ok(mut entry) = entry else {
            continue;
        };
        let Ok(path) = entry.path() else {
            continue;
        };
        if entry.header().entry_type().is_dir() {
            continue;
        }
        if entry.size() > MAX_ARCHIVE_MEMBER_BYTES {
            continue;
        }
        let name = path.to_string_lossy().into_owned();
        let mut bytes = Vec::new();
        if entry.read_to_end(&mut bytes).is_ok() {
            append_archive_member_text(&mut out, &name, &bytes);
        }
        if out.len() >= MAX_ARCHIVE_TEXT_BYTES {
            break;
        }
    }
    ExtractionOutput::extracted(out, extractor, true)
}

fn append_archive_member_text(out: &mut String, name: &str, bytes: &[u8]) {
    if looks_binary(bytes) || !is_archive_text_name(name) {
        return;
    }
    let text = if is_html_name(name) {
        extract_html_bytes(bytes, false, "archive-html").text
    } else if is_xml_name(name) || is_svg_name(name) {
        extract_xml_text(
            &String::from_utf8_lossy(bytes),
            &["p", "br", "tab", "text", "title", "desc"],
        )
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    let text = normalize_text(&text);
    if text.trim().is_empty() {
        return;
    }
    out.push_str("Archive member: ");
    out.push_str(name);
    out.push('\n');
    out.push_str(&text);
    out.push_str("\n\n");
}

fn extract_svg_file(path: &Path) -> ExtractionOutput {
    match fs::read_to_string(path) {
        Ok(xml) => ExtractionOutput::extracted(
            extract_xml_text(&xml, &["text", "title", "desc", "tspan"]),
            "svg",
            true,
        ),
        Err(e) => ExtractionOutput::failed("svg", e.to_string()),
    }
}

fn extract_utf8_file(
    path: &Path,
    fail_on_empty: bool,
    extractor: &'static str,
) -> ExtractionOutput {
    match fs::read(path) {
        Ok(bytes) => ExtractionOutput::extracted(
            String::from_utf8_lossy(&bytes).into_owned(),
            extractor,
            fail_on_empty,
        ),
        Err(e) => ExtractionOutput::failed(extractor, e.to_string()),
    }
}

fn extract_html_bytes(
    bytes: &[u8],
    fail_on_empty: bool,
    extractor: &'static str,
) -> ExtractionOutput {
    match html2text::from_read(Cursor::new(bytes), 100) {
        Ok(text) => ExtractionOutput::extracted(text, extractor, fail_on_empty),
        Err(e) => ExtractionOutput::failed(extractor, e.to_string()),
    }
}

fn extract_xml_text(xml: &str, block_tags: &[&str]) -> String {
    let mut reader = XmlReader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut out = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Text(text)) => {
                if let Ok(value) = text.xml_content() {
                    append_text_piece(&mut out, &value);
                }
            }
            Ok(Event::CData(text)) => {
                if let Ok(value) = text.xml_content() {
                    append_text_piece(&mut out, &value);
                }
            }
            Ok(Event::Empty(tag)) | Ok(Event::Start(tag)) => {
                let qname = tag.name();
                let name = local_xml_name(qname.as_ref());
                if block_tags.iter().any(|tag_name| name == *tag_name) {
                    out.push('\n');
                }
            }
            Ok(Event::End(tag)) => {
                let qname = tag.name();
                let name = local_xml_name(qname.as_ref());
                if block_tags.iter().any(|tag_name| name == *tag_name) {
                    out.push('\n');
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    out
}

fn append_text_piece(out: &mut String, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    if !out.ends_with(char::is_whitespace) && !out.is_empty() {
        out.push(' ');
    }
    out.push_str(value);
}

fn local_xml_name(name: &[u8]) -> &str {
    let local = name
        .iter()
        .rposition(|b| *b == b':')
        .map_or(name, |idx| &name[idx + 1..]);
    std::str::from_utf8(local).unwrap_or_default()
}

fn strip_rtf(raw: &str) -> String {
    let mut out = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '{' | '}' => {}
            '\\' => {
                let Some(next) = chars.next() else {
                    break;
                };
                match next {
                    '\\' | '{' | '}' => out.push(next),
                    '\'' => {
                        let h1 = chars.next();
                        let h2 = chars.next();
                        if let (Some(h1), Some(h2)) = (h1, h2) {
                            let hex = format!("{h1}{h2}");
                            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                                out.push(byte as char);
                            }
                        }
                    }
                    c if c.is_ascii_alphabetic() => {
                        let mut word = String::from(c);
                        while chars.peek().is_some_and(|p| p.is_ascii_alphabetic()) {
                            word.push(chars.next().unwrap_or_default());
                        }
                        while chars
                            .peek()
                            .is_some_and(|p| p.is_ascii_digit() || *p == '-')
                        {
                            let _ = chars.next();
                        }
                        if chars.peek().is_some_and(|p| *p == ' ') {
                            let _ = chars.next();
                        }
                        if matches!(word.as_str(), "par" | "line" | "page") {
                            out.push('\n');
                        } else if word == "tab" {
                            out.push('\t');
                        }
                    }
                    _ => {}
                }
            }
            '\r' => out.push('\n'),
            c => out.push(c),
        }
    }
    out
}

fn extract_legacy_doc(path: &Path) -> String {
    let Ok(bytes) = fs::read(path) else {
        return String::new();
    };
    let ascii = printable_runs(bytes.iter().copied().map(char::from));
    let utf16 = printable_runs(bytes.chunks_exact(2).filter_map(|pair| {
        let value = u16::from_le_bytes([pair[0], pair[1]]);
        char::from_u32(u32::from(value))
    }));
    if utf16.len() > ascii.len() {
        utf16
    } else {
        ascii
    }
}

fn printable_runs(chars: impl Iterator<Item = char>) -> String {
    let mut out = String::new();
    let mut run = String::new();
    for ch in chars {
        if ch.is_ascii_graphic() || ch.is_ascii_whitespace() {
            run.push(ch);
        } else {
            flush_printable_run(&mut out, &mut run);
        }
    }
    flush_printable_run(&mut out, &mut run);
    out
}

fn flush_printable_run(out: &mut String, run: &mut String) {
    let trimmed = run.trim();
    if trimmed.len() >= 4 && trimmed.chars().any(|c| c.is_ascii_alphabetic()) {
        out.push_str(trimmed);
        out.push('\n');
    }
    run.clear();
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        other => other.to_string(),
    }
}

fn is_archive_text_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    is_html_name(&lower)
        || is_xml_name(&lower)
        || is_svg_name(&lower)
        || lower.ends_with(".txt")
        || lower.ends_with(".md")
        || lower.ends_with(".markdown")
        || lower.ends_with(".csv")
        || lower.ends_with(".tsv")
        || lower.ends_with(".json")
        || lower.ends_with(".yaml")
        || lower.ends_with(".yml")
        || lower.ends_with(".toml")
        || lower.ends_with(".rs")
        || lower.ends_with(".ts")
        || lower.ends_with(".tsx")
        || lower.ends_with(".js")
        || lower.ends_with(".jsx")
        || lower.ends_with(".py")
        || lower.ends_with(".go")
        || lower.ends_with(".sql")
        || lower.ends_with(".sh")
}

fn is_html_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".html") || lower.ends_with(".htm") || lower.ends_with(".xhtml")
}

fn is_xml_name(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".xml")
}

fn is_svg_name(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".svg")
}

fn looks_binary(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(4096)];
    if sample.is_empty() {
        return false;
    }
    let nul_count = sample.iter().filter(|b| **b == 0).count();
    if nul_count > 0 {
        return true;
    }
    let control_count = sample
        .iter()
        .filter(|b| {
            let b = **b;
            b < 0x09 || (b > 0x0D && b < 0x20)
        })
        .count();
    control_count * 100 / sample.len() > 10
}

fn normalize_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank_lines = 0;
    for line in text.lines() {
        let line = line
            .chars()
            .map(|ch| {
                if ch == '\0' || (ch.is_control() && ch != '\t') {
                    ' '
                } else {
                    ch
                }
            })
            .collect::<String>();
        let collapsed = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if collapsed.is_empty() {
            blank_lines += 1;
            if blank_lines <= 1 {
                out.push('\n');
            }
        } else {
            blank_lines = 0;
            out.push_str(&collapsed);
            out.push('\n');
        }
    }
    out.trim().to_string()
}
