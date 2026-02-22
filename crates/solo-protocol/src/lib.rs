#![warn(clippy::all, clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::wildcard_imports,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::uninlined_format_args,
    clippy::doc_markdown,
    clippy::return_self_not_must_use,
    clippy::redundant_closure_for_method_calls,
    clippy::single_match_else,
    clippy::if_not_else,
    clippy::match_same_arms,
    clippy::map_unwrap_or,
    clippy::similar_names,
    clippy::struct_excessive_bools
)]

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
// Git Protocol
// =============================================================================

/// Status of a changed file in git
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum GitFileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
}

/// A file that has been changed in git
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitChangedFile {
    /// Relative file path
    pub path: String,
    /// Change status
    pub status: GitFileStatus,
    /// Number of inserted lines
    pub insertions: u32,
    /// Number of deleted lines
    pub deletions: u32,
    /// Whether the file is staged (in the git index)
    pub is_staged: bool,
}

/// Summary of all changes
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitChangesSummary {
    /// Total insertions across all files
    pub insertions: u32,
    /// Total deletions across all files
    pub deletions: u32,
}

/// Response from git_get_changes
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitChangesResponse {
    /// List of changed files
    pub files: Vec<GitChangedFile>,
    /// Aggregate summary
    pub summary: GitChangesSummary,
}

/// Request to setup GitHub integration
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitSetupRequest {
    /// GitHub repository URL (e.g. https://github.com/user/repo.git)
    pub github_repo_url: String,
    /// Git username
    pub username: String,
    /// Git email
    pub email: String,
}

/// Request to push to GitHub
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitPushRequest {
    /// GitHub access token
    pub access_token: String,
    /// GitHub repository URL
    pub github_repo_url: String,
    /// Branch name
    pub branch: String,
    /// Commit message
    pub commit_message: String,
}

/// Response from push
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitPushResponse {
    /// Number of commits pushed
    pub commits_count: u32,
}

/// Information about a local branch
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

/// Result of a git merge operation
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitMergeResult {
    pub fast_forward: bool,
    pub conflicts: Vec<String>,
    pub committed: bool,
}

/// A stash entry
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct StashEntry {
    pub index: u32,
    pub message: String,
}

/// Result of popping a stash
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitStashPopResult {
    pub had_conflicts: bool,
    pub conflict_files: Vec<String>,
}

/// Request to pull from GitHub
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitPullRequest {
    /// GitHub access token
    pub access_token: String,
    /// GitHub repository URL
    pub github_repo_url: String,
    /// Branch name
    pub branch: String,
    /// Whether to force reset (used for branch switching)
    pub force_reset: bool,
}

/// Response from pull
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitPullResponse {
    /// Number of new commits pulled
    pub commits_count: u32,
    /// Warning message (e.g. stash pop conflict)
    pub warning: Option<String>,
}

/// Response from git_get_file_diff
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitFileDiffResponse {
    /// Old file content (from base ref)
    pub old_content: String,
    /// New file content (current working tree)
    pub new_content: String,
}

/// Status of the git repository
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitRepoStatus {
    /// Whether the workspace is a git repository
    pub is_repo: bool,
    /// Current branch name
    pub current_branch: Option<String>,
    /// HEAD commit SHA
    pub head_sha: Option<String>,
    /// Whether the repo has a github-integ remote
    pub has_remote: bool,
    /// Remote URL (if any)
    pub remote_url: Option<String>,
    /// Number of commits ahead of remote (None if no remote or no tracking branch)
    pub commits_ahead: Option<u32>,
}

// =============================================================================
// GitHub Device Flow Protocol
// =============================================================================

/// Response from GitHub's device authorization endpoint
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct GitHubDeviceCodeResponse {
    /// The code the user enters at verification_uri
    pub user_code: String,
    /// URL where user enters the code (typically https://github.com/login/device)
    pub verification_uri: String,
    /// Device code used for polling (not shown to user)
    pub device_code: String,
    /// Seconds until the code expires
    pub expires_in: u32,
    /// Minimum seconds between poll requests
    pub interval: u32,
}

/// Result of polling for device authorization
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "status")]
pub enum GitHubDevicePollResult {
    /// Still waiting for user to authorize
    #[serde(rename = "pending")]
    Pending,
    /// User authorized, token obtained and stored
    #[serde(rename = "complete")]
    Complete,
    /// The code expired before authorization
    #[serde(rename = "expired")]
    Expired,
    /// An error occurred
    #[serde(rename = "error")]
    Error { message: String },
}

// =============================================================================
// Unified Diff Protocol (for branch diff panel)
// =============================================================================

/// A single line in a unified diff
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct DiffLine {
    /// Line kind: "context", "add", or "delete"
    pub kind: String,
    /// Line content (without leading +/- marker)
    pub content: String,
    /// Line number in old file (None for added lines)
    pub old_line_no: Option<u32>,
    /// Line number in new file (None for deleted lines)
    pub new_line_no: Option<u32>,
}

/// A contiguous hunk of changes in a diff
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct DiffHunk {
    pub old_start: u32,
    pub new_start: u32,
    pub old_lines: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

/// Full diff for a single file, with hunk-level detail
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct FileDiff {
    /// Relative file path
    pub path: String,
    /// Change status: "added", "modified", "deleted", "renamed"
    pub status: String,
    /// Total lines added
    pub additions: u32,
    /// Total lines deleted
    pub deletions: u32,
    /// Diff hunks with line-level detail
    pub hunks: Vec<DiffHunk>,
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

/// A single changed file in a worktree diff relative to its base branch.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct WorktreeDiffEntry {
    /// File path relative to repo root
    pub path: String,
    /// Change status: "added", "modified", "deleted", "renamed"
    pub status: String,
    /// Lines added (0 if unavailable)
    pub additions: u32,
    /// Lines removed (0 if unavailable)
    pub deletions: u32,
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

    /// Git operation progress
    #[serde(rename = "git:progress")]
    GitProgress { operation: String, message: String },

    /// Git changes updated (signals UI to re-poll)
    #[serde(rename = "git:changes_updated")]
    GitChangesUpdated {},

    /// Worktree operation progress
    #[serde(rename = "worktree:progress")]
    WorktreeProgress {
        worktree_id: String,
        message: String,
    },

    /// Worktree is ready
    #[serde(rename = "worktree:ready")]
    WorktreeReady {
        worktree_id: String,
        info: WorktreeInfo,
    },

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

// =============================================================================
// ElevenLabs Voice Protocol
// =============================================================================

/// STT partial transcript event (emitted on "elevenlabs:stt_partial" channel)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ElevenLabsSttPartialEvent {
    pub session_id: String,
    pub text: String,
}

/// STT committed (final) transcript event (emitted on "elevenlabs:stt_committed" channel)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ElevenLabsSttCommittedEvent {
    pub session_id: String,
    pub text: String,
}

/// STT status event (emitted on "elevenlabs:stt_status" channel)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ElevenLabsSttStatusEvent {
    pub session_id: String,
    pub status: String,
    pub error: Option<String>,
}

/// TTS audio chunk event (emitted on "elevenlabs:tts_audio" channel)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ElevenLabsTtsAudioEvent {
    pub session_id: String,
    pub chunk: String,
    pub sample_rate: u32,
}

/// TTS status event (emitted on "elevenlabs:tts_status" channel)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ElevenLabsTtsStatusEvent {
    pub session_id: String,
    pub status: String,
    pub error: Option<String>,
}

// =============================================================================
// Claude CLI Setup
// =============================================================================

/// Status of the Claude Code CLI setup
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSetupStatus {
    pub cli_installed: bool,
    pub cli_path: Option<String>,
    pub credentials_found: bool,
    pub credential_source: Option<String>,
    pub token_expired: bool,
    pub token_expires_at: Option<i64>,
    pub token_expires_in_seconds: Option<i64>,
    pub scopes: Option<Vec<String>>,
    pub api_verified: Option<bool>,
    pub error: Option<String>,
    pub cli_mode_available: bool,
    pub requires_cli_mode: bool,
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
