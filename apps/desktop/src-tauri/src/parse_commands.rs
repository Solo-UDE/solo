//! Parse command handlers for Solo IDE
//!
//! This module provides tree-sitter based code parsing via IPC.

use crate::fs_commands::FsState;
use solo_parse::{Parser, ParserError};
use solo_protocol::{
    FileErrorCode, FileOperationError, ParseErrorInfo, ParseRequest, ParseResponse, Symbol,
    SymbolKind, SymbolRange,
};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::State;
use tracing::debug;

/// Global parser instance (thread-safe, created once)
static PARSER: OnceLock<Parser> = OnceLock::new();

/// Get or create the global parser
fn get_parser() -> &'static Parser {
    PARSER.get_or_init(Parser::new)
}

/// Convert solo-parse Symbol to protocol Symbol
fn convert_symbol(s: solo_parse::Symbol) -> Symbol {
    Symbol {
        name: s.name,
        kind: convert_symbol_kind(s.kind),
        range: convert_range(s.range),
        selection_range: convert_range(s.selection_range),
        children: s.children.into_iter().map(convert_symbol).collect(),
        detail: s.detail,
    }
}

/// Convert solo-parse SymbolKind to protocol SymbolKind
fn convert_symbol_kind(kind: solo_parse::SymbolKind) -> SymbolKind {
    match kind {
        solo_parse::SymbolKind::Function => SymbolKind::Function,
        solo_parse::SymbolKind::Method => SymbolKind::Method,
        solo_parse::SymbolKind::Class => SymbolKind::Class,
        solo_parse::SymbolKind::Struct => SymbolKind::Struct,
        solo_parse::SymbolKind::Enum => SymbolKind::Enum,
        solo_parse::SymbolKind::Interface => SymbolKind::Interface,
        solo_parse::SymbolKind::TypeAlias => SymbolKind::TypeAlias,
        solo_parse::SymbolKind::Constant => SymbolKind::Constant,
        solo_parse::SymbolKind::Variable => SymbolKind::Variable,
        solo_parse::SymbolKind::Module => SymbolKind::Module,
        solo_parse::SymbolKind::Property => SymbolKind::Property,
        solo_parse::SymbolKind::EnumMember => SymbolKind::EnumMember,
        solo_parse::SymbolKind::Trait => SymbolKind::Trait,
        solo_parse::SymbolKind::Impl => SymbolKind::Impl,
        solo_parse::SymbolKind::Macro => SymbolKind::Macro,
        solo_parse::SymbolKind::Unknown => SymbolKind::Unknown,
    }
}

/// Convert solo-parse Range to protocol SymbolRange
fn convert_range(r: solo_parse::Range) -> SymbolRange {
    SymbolRange {
        start_line: r.start_line,
        start_col: r.start_col,
        end_line: r.end_line,
        end_col: r.end_col,
    }
}

/// Convert parser error to file operation error
fn parser_error_to_file_error(err: ParserError, path: &str) -> FileOperationError {
    let (code, message) = match err {
        ParserError::UnsupportedLanguage(msg) => (FileErrorCode::InvalidPath, msg),
        ParserError::ParseFailed(msg) => (FileErrorCode::IoError, msg),
        ParserError::TreeSitter(msg) => (FileErrorCode::IoError, msg),
    };

    FileOperationError {
        code,
        message,
        path: path.to_string(),
    }
}

/// Parse a file and return symbols
#[tauri::command]
pub async fn parse_file(
    request: ParseRequest,
    state: State<'_, FsState>,
) -> Result<ParseResponse, FileOperationError> {
    let path = &request.path;

    // Get content either from request or from disk
    let content = if let Some(content) = request.content {
        content
    } else {
        // Read from disk - validate workspace first
        let workspace = state.workspace_root.read().await;
        let workspace_path = workspace.as_ref().ok_or_else(|| FileOperationError {
            code: FileErrorCode::InvalidPath,
            message: "No workspace root set".to_string(),
            path: path.clone(),
        })?;

        let file_path = PathBuf::from(path);

        // Validate path is within workspace
        let canonical = file_path.canonicalize().map_err(|e| FileOperationError {
            code: FileErrorCode::NotFound,
            message: e.to_string(),
            path: path.clone(),
        })?;

        let workspace_canonical = workspace_path.canonicalize().map_err(|e| FileOperationError {
            code: FileErrorCode::IoError,
            message: e.to_string(),
            path: path.clone(),
        })?;

        if !canonical.starts_with(&workspace_canonical) {
            return Err(FileOperationError {
                code: FileErrorCode::PathOutsideWorkspace,
                message: "Path is outside workspace".to_string(),
                path: path.clone(),
            });
        }

        std::fs::read_to_string(&file_path).map_err(|e| FileOperationError {
            code: if e.kind() == std::io::ErrorKind::NotFound {
                FileErrorCode::NotFound
            } else {
                FileErrorCode::IoError
            },
            message: e.to_string(),
            path: path.clone(),
        })?
    };

    debug!(path = %path, content_len = content.len(), "Parsing file");

    // Parse the content
    let parser = get_parser();
    let result = parser
        .parse(path, &content)
        .map_err(|e| parser_error_to_file_error(e, path))?;

    debug!(
        path = %path,
        symbols = result.symbols.len(),
        errors = result.errors.len(),
        time_ms = result.parse_time_ms,
        "Parse complete"
    );

    Ok(ParseResponse {
        symbols: result.symbols.into_iter().map(convert_symbol).collect(),
        errors: result
            .errors
            .into_iter()
            .map(|e| ParseErrorInfo {
                message: e.message,
                range: convert_range(e.range),
            })
            .collect(),
        parse_time_ms: result.parse_time_ms,
        has_errors: result.has_errors,
    })
}

/// Parse content without reading from disk
#[tauri::command]
pub async fn parse_content(
    path: String,
    content: String,
) -> Result<ParseResponse, FileOperationError> {
    debug!(path = %path, content_len = content.len(), "Parsing content");

    let parser = get_parser();
    let result = parser
        .parse(&path, &content)
        .map_err(|e| parser_error_to_file_error(e, &path))?;

    debug!(
        path = %path,
        symbols = result.symbols.len(),
        errors = result.errors.len(),
        time_ms = result.parse_time_ms,
        "Parse complete"
    );

    Ok(ParseResponse {
        symbols: result.symbols.into_iter().map(convert_symbol).collect(),
        errors: result
            .errors
            .into_iter()
            .map(|e| ParseErrorInfo {
                message: e.message,
                range: convert_range(e.range),
            })
            .collect(),
        parse_time_ms: result.parse_time_ms,
        has_errors: result.has_errors,
    })
}

/// Check if a file extension is supported for parsing
#[tauri::command]
pub fn is_parseable(path: String) -> bool {
    solo_parse::LanguageRegistry::new().is_supported(&path)
}
