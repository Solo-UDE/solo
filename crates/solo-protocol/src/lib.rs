//! Solo Protocol - IPC message types for communication between Rust backend and TypeScript frontend
//!
//! This crate defines all message types used for Tauri IPC communication.
//! Types are annotated with `ts-rs` to generate TypeScript definitions.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// =============================================================================
// Terminal Protocol
// =============================================================================

/// Request to create a new terminal instance
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct TerminalCreateRequest {
    /// Optional working directory
    pub cwd: Option<String>,
    /// Optional shell override
    pub shell: Option<String>,
    /// Optional environment variables
    pub env: Option<std::collections::HashMap<String, String>>,
}

/// Response when a terminal is created
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct TerminalCreateResponse {
    /// Unique terminal ID
    pub id: String,
}

/// Request to write data to a terminal
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct TerminalWriteRequest {
    /// Terminal ID
    pub id: String,
    /// Data to write
    pub data: String,
}

/// Request to resize a terminal
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct TerminalResizeRequest {
    /// Terminal ID
    pub id: String,
    /// Number of columns
    pub cols: u16,
    /// Number of rows
    pub rows: u16,
}

// =============================================================================
// Agent Protocol
// =============================================================================

/// Request to send a message to the AI agent
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct AgentSendMessageRequest {
    /// Conversation ID (optional, creates new if not provided)
    pub conversation_id: Option<String>,
    /// User message content
    pub content: String,
    /// Optional system prompt override
    pub system_prompt: Option<String>,
}

/// A tool call from the agent
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct AgentToolCall {
    /// Tool call ID
    pub id: String,
    /// Tool name
    pub name: String,
    /// Tool arguments as JSON
    pub arguments: String,
}

/// A message in the conversation
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct AgentMessage {
    /// Message role (user, assistant, system)
    pub role: String,
    /// Message content
    pub content: String,
    /// Optional tool calls (for assistant messages)
    pub tool_calls: Option<Vec<AgentToolCall>>,
}

// =============================================================================
// File System Protocol
// =============================================================================

/// Request to read a file
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct FileReadRequest {
    /// Path to the file
    pub path: String,
}

/// Response with file contents
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct FileReadResponse {
    /// File contents
    pub content: String,
    /// File encoding
    pub encoding: String,
}

/// Request to write a file
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct FileWriteRequest {
    /// Path to the file
    pub path: String,
    /// Content to write
    pub content: String,
}

/// A file tree entry
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct FileTreeEntry {
    /// Entry name
    pub name: String,
    /// Full path
    pub path: String,
    /// Whether this is a directory
    pub is_dir: bool,
    /// Children (for directories). None = not loaded, Some([]) = loaded but empty
    pub children: Option<Vec<FileTreeEntry>>,
    /// File size in bytes (for files)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    /// Last modified timestamp (Unix epoch seconds)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<u64>,
}

/// Request to read a directory with lazy loading support
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct DirectoryReadRequest {
    /// Path to the directory
    pub path: String,
    /// Depth of children to include (0 = no children, 1 = immediate children only)
    pub depth: u32,
}

/// Response with directory contents
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct DirectoryReadResponse {
    /// Root entry with children
    pub entry: FileTreeEntry,
    /// Total file count (for progress indication)
    pub total_count: u32,
}

/// Request to create a file or directory
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct FileCreateRequest {
    /// Path where to create the file/directory
    pub path: String,
    /// Whether to create a directory
    pub is_dir: bool,
    /// Initial content (for files only)
    pub content: Option<String>,
}

/// Request to rename/move a file or directory
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct FileRenameRequest {
    /// Current path
    pub old_path: String,
    /// New path
    pub new_path: String,
}

/// Request to delete a file or directory
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct FileDeleteRequest {
    /// Path to delete
    pub path: String,
    /// Whether to recursively delete directories
    pub recursive: bool,
}

/// Request to start watching a directory
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct WatchRequest {
    /// Path to watch
    pub path: String,
    /// Whether to watch recursively
    pub recursive: bool,
}

/// File metadata information
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct FileMetadata {
    /// File size in bytes
    pub size: u64,
    /// Whether this is a directory
    pub is_dir: bool,
    /// Whether this is a regular file
    pub is_file: bool,
    /// Last modified timestamp (Unix epoch seconds)
    pub modified: Option<u64>,
}

/// Error codes for file operations
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub enum FileErrorCode {
    NotFound,
    PermissionDenied,
    AlreadyExists,
    NotADirectory,
    NotAFile,
    DirectoryNotEmpty,
    IoError,
    InvalidPath,
    PathOutsideWorkspace,
}

/// Error response for file operations
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct FileOperationError {
    /// Error code for programmatic handling
    pub code: FileErrorCode,
    /// Human-readable message
    pub message: String,
    /// Path that caused the error
    pub path: String,
}

// =============================================================================
// Backend Events (sent from Rust to TypeScript)
// =============================================================================

/// Events emitted from the backend to the frontend
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "type", content = "payload")]
pub enum BackendEvent {
    /// Terminal output data
    #[serde(rename = "terminal:data")]
    TerminalData { id: String, data: String },

    /// Terminal exited
    #[serde(rename = "terminal:exit")]
    TerminalExit { id: String, code: Option<i32> },

    /// Agent streaming text chunk
    #[serde(rename = "agent:chunk")]
    AgentChunk {
        conversation_id: String,
        content: String,
    },

    /// Agent tool call started
    #[serde(rename = "agent:tool_start")]
    AgentToolStart {
        conversation_id: String,
        tool_call: AgentToolCall,
    },

    /// Agent tool call completed
    #[serde(rename = "agent:tool_end")]
    AgentToolEnd {
        conversation_id: String,
        tool_call_id: String,
        result: String,
    },

    /// Agent message completed
    #[serde(rename = "agent:complete")]
    AgentComplete {
        conversation_id: String,
        message: AgentMessage,
    },

    /// Agent error
    #[serde(rename = "agent:error")]
    AgentError {
        conversation_id: String,
        error: String,
    },

    /// File changed externally
    #[serde(rename = "file:changed")]
    FileChanged { path: String },

    /// File created externally
    #[serde(rename = "file:created")]
    FileCreated { path: String },

    /// File deleted externally
    #[serde(rename = "file:deleted")]
    FileDeleted { path: String },

    /// File renamed externally
    #[serde(rename = "file:renamed")]
    FileRenamed { old_path: String, new_path: String },

    /// Parse completed for a file
    #[serde(rename = "parse:complete")]
    ParseComplete { path: String, symbol_count: u32 },
}

// =============================================================================
// Parse Protocol
// =============================================================================

/// Request to parse a file
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ParseRequest {
    /// Path to the file
    pub path: String,
    /// Optional content to parse (if not provided, reads from disk)
    pub content: Option<String>,
}

/// Response with parse results
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ParseResponse {
    /// Extracted symbols
    pub symbols: Vec<Symbol>,
    /// Parse errors found
    pub errors: Vec<ParseErrorInfo>,
    /// Time taken to parse (milliseconds)
    pub parse_time_ms: u64,
    /// Whether the tree has syntax errors
    pub has_errors: bool,
}

/// A symbol extracted from source code
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct Symbol {
    /// Symbol name
    pub name: String,
    /// Kind of symbol
    pub kind: SymbolKind,
    /// Range in the source file
    pub range: SymbolRange,
    /// Range of just the symbol name
    pub selection_range: SymbolRange,
    /// Nested symbols
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Symbol>,
    /// Additional details
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Kind of symbol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    Function,
    Method,
    Class,
    Struct,
    Enum,
    Interface,
    TypeAlias,
    Constant,
    Variable,
    Module,
    Property,
    EnumMember,
    Trait,
    Impl,
    Macro,
    Unknown,
}

/// A range in source code (0-indexed)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct SymbolRange {
    /// Start line (0-indexed)
    pub start_line: u32,
    /// Start column (0-indexed)
    pub start_col: u32,
    /// End line (0-indexed)
    pub end_line: u32,
    /// End column (0-indexed)
    pub end_col: u32,
}

/// Parse error information
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ParseErrorInfo {
    /// Error message
    pub message: String,
    /// Location of the error
    pub range: SymbolRange,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backend_event_serialization() {
        let event = BackendEvent::TerminalData {
            id: "term-1".to_string(),
            data: "Hello, World!".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("terminal:data"));
        assert!(json.contains("term-1"));
    }

    #[test]
    fn test_agent_message_serialization() {
        let msg = AgentMessage {
            role: "assistant".to_string(),
            content: "Hello!".to_string(),
            tool_calls: None,
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("assistant"));
    }
}
