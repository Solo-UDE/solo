//! Taxonomy classifier — MIME + extension + filename heuristics that assign
//! an `EntryKind` and confidence score. Deterministic only in V1; an
//! embedding-based fallback can be added later.

use solo_protocol::EntryKind;
use std::path::Path;

/// Classification result for a single path.
#[derive(Debug, Clone)]
pub struct Classification {
    pub kind: EntryKind,
    pub subkind: Option<String>,
    pub mime: Option<String>,
    /// Confidence in [0.0, 1.0]. Below 0.6 → sent to Unsorted tray.
    pub confidence: f32,
}

/// Classify a filesystem path by extension + MIME sniff.
pub fn classify(path: &Path) -> Classification {
    let mime = mime_guess::from_path(path).first().map(|m| m.to_string());
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    let file_name = path
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    // 1. Well-known config filenames (independent of extension)
    if is_config_filename(&file_name) {
        return Classification {
            kind: EntryKind::Config,
            subkind: Some("config".into()),
            mime,
            confidence: 0.95,
        };
    }

    // 2. Extension → kind
    if let Some(ext) = ext.as_deref() {
        if let Some((kind, subkind, conf)) = kind_from_ext(ext) {
            return Classification {
                kind,
                subkind: Some(subkind.into()),
                mime,
                confidence: conf,
            };
        }
    }

    // 3. MIME top-level fallback
    if let Some(m) = mime.as_deref() {
        if let Some((kind, conf)) = kind_from_mime(m) {
            return Classification {
                kind,
                subkind: None,
                mime: Some(m.into()),
                confidence: conf,
            };
        }
    }

    // 4. Unknown — send to Unsorted tray
    Classification {
        kind: EntryKind::Unsorted,
        subkind: None,
        mime,
        confidence: 0.2,
    }
}

/// Classify a free-form text/note entry created inside the panel (no file).
pub fn classify_note() -> Classification {
    Classification {
        kind: EntryKind::Note,
        subkind: Some("markdown".into()),
        mime: Some("text/markdown".into()),
        confidence: 1.0,
    }
}

fn is_config_filename(name: &str) -> bool {
    matches!(
        name,
        "dockerfile"
            | "dockerfile.dev"
            | "dockerfile.prod"
            | "docker-compose.yml"
            | "docker-compose.yaml"
            | "makefile"
            | ".env.example"
            | ".env.sample"
            | ".prettierrc"
            | ".eslintrc"
            | ".eslintrc.json"
            | ".gitignore"
            | ".editorconfig"
            | "nginx.conf"
            | "cargo.toml"
            | "package.json"
            | "tsconfig.json"
    )
}

fn kind_from_ext(ext: &str) -> Option<(EntryKind, &'static str, f32)> {
    let v = match ext {
        // Documents
        "pdf" => (EntryKind::Document, "pdf", 0.98),
        "docx" | "doc" => (EntryKind::Document, "word", 0.95),
        "rtf" => (EntryKind::Document, "rtf", 0.9),
        "md" | "markdown" => (EntryKind::Document, "markdown", 0.95),
        "txt" => (EntryKind::Document, "text", 0.85),
        "epub" => (EntryKind::Document, "epub", 0.9),

        // Code
        "rs" => (EntryKind::Code, "rust", 0.98),
        "ts" | "tsx" => (EntryKind::Code, "typescript", 0.98),
        "js" | "jsx" | "mjs" | "cjs" => (EntryKind::Code, "javascript", 0.97),
        "py" => (EntryKind::Code, "python", 0.98),
        "go" => (EntryKind::Code, "go", 0.98),
        "rb" => (EntryKind::Code, "ruby", 0.95),
        "java" => (EntryKind::Code, "java", 0.95),
        "kt" | "kts" => (EntryKind::Code, "kotlin", 0.95),
        "swift" => (EntryKind::Code, "swift", 0.95),
        "c" | "h" => (EntryKind::Code, "c", 0.9),
        "cpp" | "cc" | "hpp" => (EntryKind::Code, "cpp", 0.9),
        "sql" => (EntryKind::Code, "sql", 0.95),
        "sh" | "bash" | "zsh" => (EntryKind::Code, "shell", 0.9),
        "lua" => (EntryKind::Code, "lua", 0.9),

        // Images
        "png" => (EntryKind::Image, "png", 0.98),
        "jpg" | "jpeg" => (EntryKind::Image, "jpeg", 0.98),
        "webp" => (EntryKind::Image, "webp", 0.98),
        "heic" => (EntryKind::Image, "heic", 0.98),
        "gif" => (EntryKind::Image, "gif", 0.98),
        "bmp" => (EntryKind::Image, "bmp", 0.98),
        "tiff" => (EntryKind::Image, "tiff", 0.98),
        "svg" => (EntryKind::Image, "svg", 0.9),

        // Design
        "fig" => (EntryKind::Design, "figma", 0.95),
        "sketch" => (EntryKind::Design, "sketch", 0.95),
        "psd" => (EntryKind::Design, "psd", 0.95),
        "ai" => (EntryKind::Design, "illustrator", 0.95),
        "xd" => (EntryKind::Design, "xd", 0.95),

        // Data
        "csv" | "tsv" => (EntryKind::Data, "csv", 0.95),
        "json" => (EntryKind::Data, "json", 0.9),
        "yaml" | "yml" => (EntryKind::Data, "yaml", 0.9),
        "toml" => (EntryKind::Data, "toml", 0.9),
        "parquet" => (EntryKind::Data, "parquet", 0.95),
        "xlsx" | "xls" => (EntryKind::Data, "excel", 0.95),

        // Web
        "html" | "htm" => (EntryKind::Web, "html", 0.9),
        "url" | "webloc" => (EntryKind::Web, "bookmark", 0.95),

        // Configs
        "env" | "ini" | "conf" | "cfg" => (EntryKind::Config, "config", 0.85),
        "dockerfile" => (EntryKind::Config, "dockerfile", 0.95),
        "tf" | "tfvars" => (EntryKind::Config, "terraform", 0.95),

        // Audio / Archive (v1.1)
        "mp3" => (EntryKind::Audio, "mp3", 0.95),
        "wav" => (EntryKind::Audio, "wav", 0.95),
        "m4a" => (EntryKind::Audio, "m4a", 0.95),
        "flac" => (EntryKind::Audio, "flac", 0.95),
        "ogg" => (EntryKind::Audio, "ogg", 0.95),
        "zip" => (EntryKind::Archive, "zip", 0.95),
        "tar" => (EntryKind::Archive, "tar", 0.95),
        "gz" => (EntryKind::Archive, "gzip", 0.95),
        "bz2" => (EntryKind::Archive, "bzip2", 0.95),
        "7z" => (EntryKind::Archive, "7z", 0.95),
        "rar" => (EntryKind::Archive, "rar", 0.95),

        _ => return None,
    };
    Some(v)
}

fn kind_from_mime(m: &str) -> Option<(EntryKind, f32)> {
    if m.starts_with("image/") {
        Some((EntryKind::Image, 0.85))
    } else if m.starts_with("audio/") {
        Some((EntryKind::Audio, 0.85))
    } else if m.starts_with("text/") {
        Some((EntryKind::Document, 0.7))
    } else if m == "application/json" {
        Some((EntryKind::Data, 0.85))
    } else if m == "application/pdf" {
        Some((EntryKind::Document, 0.95))
    } else {
        None
    }
}
