//! Solo Protocol - IPC message types for communication between Rust backend and TypeScript frontend
//!
//! This crate defines all message types used for Tauri IPC communication.
//! Types are annotated with `ts-rs` to generate TypeScript definitions.
//!
//! Note: Agent protocol types are now handled by the agent-bridge sidecar.
//! Agent events flow through Tauri emit channels (agent:message, agent:permission_request, etc.)
//! rather than through BackendEvent variants.

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
// Worktree Protocol
// =============================================================================

/// Information about a git worktree
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct WorktreeInfo {
    /// Unique worktree identifier
    pub id: String,
    /// Filesystem path to the worktree
    pub path: String,
    /// Branch checked out in this worktree
    pub branch: Option<String>,
    /// HEAD commit SHA
    pub head_sha: String,
    /// Whether this is the main (primary) worktree
    pub is_main: bool,
    /// Whether the worktree is locked
    pub is_locked: bool,
    /// Reason for locking
    pub lock_reason: Option<String>,
    /// Whether the worktree has uncommitted changes
    pub is_dirty: bool,
    /// Agent session ID currently using this worktree
    pub agent_session_id: Option<String>,
    /// Creation timestamp (Unix epoch seconds)
    pub created_at: u64,
}

/// Request to create a new worktree
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct CreateWorktreeRequest {
    /// Branch name for the worktree
    pub branch: String,
    /// Optional custom path (default: auto-generated)
    pub path: Option<String>,
    /// Whether to create a new branch
    pub create_branch: bool,
    /// Base branch/ref to create from (default: HEAD)
    pub base: Option<String>,
}

/// Request to remove a worktree
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct RemoveWorktreeRequest {
    /// Worktree ID to remove
    pub id: String,
    /// Force removal even if dirty or locked
    pub force: bool,
}

/// Setup commands to run after worktree creation (e.g., package install)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct WorktreeSetupConfig {
    /// Shell commands to run in the new worktree directory
    pub commands: Vec<String>,
}

// =============================================================================
// Claude Setup Verification
// =============================================================================

/// Status of Claude Code CLI setup and credential verification
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSetupStatus {
    /// Whether the Claude CLI binary is installed
    pub cli_installed: bool,
    /// Path to the Claude CLI binary (e.g. /usr/local/bin/claude)
    pub cli_path: Option<String>,
    /// Whether OAuth credentials were found (keychain or file)
    pub credentials_found: bool,
    /// Where the credentials came from: "keychain" or "credentials-file"
    pub credential_source: Option<String>,
    /// Whether the token is expired
    pub token_expired: bool,
    /// Token expiry timestamp (ms since epoch)
    #[ts(type = "number | null")]
    pub token_expires_at: Option<i64>,
    /// Seconds until token expires (negative if already expired)
    #[ts(type = "number | null")]
    pub token_expires_in_seconds: Option<i64>,
    /// OAuth scopes on the token
    pub scopes: Option<Vec<String>>,
    /// Whether the token was verified against the API.
    /// None = not checked, Some(true) = API call succeeded, Some(false) = rejected
    pub api_verified: Option<bool>,
    /// Error message if something went wrong
    pub error: Option<String>,
    /// Whether CLI mode is available (CLI installed + credentials found).
    /// Subscription tokens require CLI mode; direct API calls won't work.
    pub cli_mode_available: bool,
    /// Whether the credential is a subscription token that requires CLI mode.
    /// These tokens cannot be used for direct API calls.
    pub requires_cli_mode: bool,
}

// =============================================================================
// Backend Events (sent from Rust to TypeScript)
// =============================================================================

/// Events emitted from the backend to the frontend.
///
/// Note: Agent events now flow through dedicated Tauri emit channels
/// (agent:message, agent:permission_request, etc.) from the agent bridge,
/// not through BackendEvent.
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

    /// Worktree operation progress
    #[serde(rename = "worktree:progress")]
    WorktreeProgress { worktree_id: String, message: String },

    /// Worktree is ready
    #[serde(rename = "worktree:ready")]
    WorktreeReady { worktree_id: String, info: WorktreeInfo },

    /// Worktree operation error
    #[serde(rename = "worktree:error")]
    WorktreeError { worktree_id: String, error: String },

    /// Worktree was removed
    #[serde(rename = "worktree:removed")]
    WorktreeRemoved { worktree_id: String },

    /// Worktree setup command progress (streamed during post-create hooks)
    #[serde(rename = "worktree:setup_progress")]
    WorktreeSetupProgress {
        worktree_id: String,
        command: String,
        output: String,
        is_error: bool,
        is_complete: bool,
    },
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
}
