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
    /// Whether the worktree directory still exists on disk.
    /// `false` indicates a stale config entry that needs pruning.
    pub exists_on_disk: bool,
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
// Vault Protocol
// =============================================================================

/// Kind of vault entry. Drives extraction, chunking, and UI bucketing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    Document,
    Code,
    Snippet,
    Image,
    Design,
    Data,
    Config,
    Web,
    Note,
    Keyvalue,
    Audio,
    Archive,
    Unsorted,
}

/// Memory-type classification of an entry. Drives retrieval boosting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum MemoryType {
    /// Project-scoped knowledge
    Project,
    /// User-scoped knowledge (cross-project)
    User,
    /// User-flagged source of truth, always eligible for RAG
    PinnedSourceOfTruth,
}

/// Scope determines which workspace the entry is visible to.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum VaultScope {
    /// Visible in every project (cross-project user memory)
    Global,
    /// Visible only in the specific project
    Project { project_id: String },
}

/// Local indexing status for an entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum IndexStatus {
    Pending,
    Extracting,
    Chunking,
    Embedding,
    Storing,
    Indexed,
    ExtractionFailed,
    Failed,
}

/// Cloud sync state for an entry (set by the sync worker).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum CloudSyncState {
    /// Feature disabled or user not signed in
    Offline,
    /// Queued for sync
    Pending,
    /// Uploading blob to S3
    Uploading,
    /// Remote indexing pipeline running
    IndexingRemote,
    /// Successfully synced and indexed remotely
    Synced,
    /// Sync or remote indexing failed
    Failed,
}

/// Per-entry retrieval telemetry (informs decay / pin suggestions).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct RetrievalStats {
    /// Number of times this entry has been retrieved (any chunk)
    pub hit_count: u32,
    /// Last retrieval timestamp (Unix epoch seconds)
    pub last_retrieved_at: Option<u64>,
}

/// A vault entry — the canonical unit of memory.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct VaultEntry {
    pub id: String,
    pub kind: EntryKind,
    /// Finer-grained label inside kind (e.g. "pdf", "rust", "svg"). Optional.
    pub subkind: Option<String>,
    pub title: String,
    /// Plain-text content for note/keyvalue entries without a file
    pub content: Option<String>,
    /// Original filesystem path of the dropped file (if any)
    pub source_path: Option<String>,
    /// Content-addressable path inside the vault blob store
    pub vault_blob_path: Option<String>,
    pub scope: VaultScope,
    pub memory_type: MemoryType,
    /// When true, always eligible for RAG regardless of similarity
    pub pinned: bool,
    pub tags: Vec<String>,
    pub mime: Option<String>,
    pub size_bytes: Option<u64>,
    pub index_status: IndexStatus,
    pub cloud_sync_state: CloudSyncState,
    /// Classifier confidence in [0.0, 1.0]. Below 0.6 → Unsorted tray.
    pub classifier_confidence: f32,
    pub retrieval_stats: RetrievalStats,
    /// Unix epoch seconds
    pub created_at: u64,
    /// Unix epoch seconds
    pub updated_at: u64,
}

/// An indexed chunk extracted from an entry.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct VaultChunk {
    pub id: String,
    pub entry_id: String,
    pub chunk_index: u32,
    pub content: String,
    pub token_count: Option<u32>,
}

/// Filters passed to vault_list.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct VaultListFilters {
    /// Restrict to a specific kind
    pub kind: Option<EntryKind>,
    /// Only pinned entries
    pub pinned: Option<bool>,
    /// Only entries in the Unsorted review tray
    pub unsorted: Option<bool>,
    /// Free-text filter (title/tags)
    pub query: Option<String>,
}

/// Search mode for vault_search.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum VaultSearchMode {
    /// Lexical full-text search (FTS5)
    Fts,
    /// Vector similarity (embedding)
    Semantic,
    /// Lexical + semantic retrieval, merged by reciprocal-rank fusion
    Hybrid,
}

/// Retrieval source for vault_search.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum VaultRetrievalSource {
    /// On-device SQLite/embedding cache only
    Local,
    /// Cloud-indexed chunks only
    Cloud,
    /// Local first plus cloud when signed in
    Hybrid,
}

/// A single result from vault_search.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct VaultSearchResult {
    pub chunk: VaultChunk,
    pub entry: VaultEntry,
    pub source: VaultRetrievalSource,
    pub mode: VaultSearchMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embedding_model: Option<String>,
    /// Similarity score (semantic) or BM25 rank (fts), higher = more relevant
    pub score: f32,
}

/// Suggested mode when accepting a placement toast.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum PlacementMode {
    /// Only keep in vault
    VaultOnly,
    /// Copy file to workspace, remove vault blob
    PlaceInProject,
    /// Keep vault copy and copy into workspace; entry retains workspace_path
    Both,
}

/// Workspace-placement suggestion returned by the placement scorer.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PlacementSuggestion {
    pub entry_id: String,
    /// Suggested relative path inside the active workspace
    pub target_path: String,
    /// [0.0, 1.0]; suppressed in UI below 0.5
    pub score: f32,
    /// Human-readable explanation ("matches sibling PNGs in src/assets")
    pub reason: String,
}

/// Result of accepting a placement suggestion.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PlacementResult {
    pub entry_id: String,
    /// Absolute path written to the workspace (if any)
    pub workspace_path: Option<String>,
    pub mode: PlacementMode,
}

// =============================================================================
// Voice Protocol
// =============================================================================

#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub enum VoiceMode {
    Dictation,
    Dispatch,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "kind", content = "data")]
pub enum VoicePipelineState {
    Idle,
    Arming,
    Recording,
    Transcribing,
    Formatting,
    Emitting,
    Error(String),
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct VoiceTranscriptResult {
    pub id: String,
    pub mode: VoiceMode,
    pub raw_transcript: String,
    pub formatted: String,
    pub target_app_bundle_id: Option<String>,
    pub target_app_name: Option<String>,
    pub duration_ms: u32,
    pub linked_session_id: Option<String>,
    pub created_at: i64,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct VoiceModelProgress {
    pub model_id: String,
    pub bytes: u64,
    pub total: u64,
}

// =============================================================================
// Task Allocator
// =============================================================================

/// Lifecycle status of a task. Phase 1 uses a subset; later phases activate
/// the remainder without enum changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    /// LLM-proposed draft awaiting user accept/dismiss (Phase 5).
    Suggested,
    /// Accepted and ready to run (manual) or waiting for next fire (scheduled).
    Queued,
    /// Currently executing (Phase 2+).
    Running,
    /// Agent finished; awaiting user review (Phase 3+).
    NeedsReview,
    /// Completed successfully or ticked off manually.
    Done,
    /// Execution or scheduling failed.
    Failed,
    /// User-archived.
    Archived,
}

/// Who executes the task. Phase 1 ships `Manual` only; `Agent` activates in Phase 2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum Executor {
    Manual,
    Agent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    Low,
    Medium,
    High,
    Urgent,
}

/// Where a task came from. Distinguishes user-authored vs planner-emitted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum TaskOrigin {
    Manual,
    /// goal-plan id — the submission that produced the batch (Phase 5).
    GoalPlan(String),
    Proactive,
}

/// Planner-attached tags enabling the "Context anchor" grouping (§7 of spec).
/// Phase 1 accepts the enum but does not produce any values — the UI renders
/// whatever is present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum ContextAnchor {
    VaultEntry(String),
    Skill(String),
    Branch(String),
    File(String),
    Session(String),
    Topic(String),
}

/// A single execution of a task. Populated by the Executor (Phase 2+). Phase 1
/// persists an empty `Vec<TaskRun>` on every task.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct TaskRun {
    pub id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub outcome: RunOutcome,
    pub session_id: Option<String>,
    pub worktree_id: Option<String>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum RunOutcome {
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

/// A checklist item on a `Task`. Order is the containing `Vec`'s index — there
/// is no `position` field. Reordering is a full array rewrite via
/// `task_subtask_reorder`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct Subtask {
    pub id: String,
    pub title: String,
    pub completed: bool,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub completed_at: Option<i64>,
}

/// Payload shape for creating a subtask via `TaskDraft.subtasks` or the
/// dedicated `task_subtask_add` command. Server assigns id/timestamps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct SubtaskDraft {
    pub title: String,
}

/// A user-defined label. Tasks can carry any number of labels via
/// `Task.label_ids`. Labels live in their own `labels` table keyed by id;
/// removal cascades (ids are pruned from every task's `label_ids`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct Label {
    pub id: String,
    pub name: String,
    /// Hex color (`#rrggbb`).
    pub color: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct LabelDraft {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct LabelPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
}

/// A Project groups related tasks under a shared goal. Tasks carry a
/// nullable `project_id` pointer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Planned,
    InProgress,
    Paused,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum ProjectHealth {
    OnTrack,
    AtRisk,
    OffTrack,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: ProjectStatus,
    pub health: ProjectHealth,
    /// Hex color used for the badge.
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub start_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ProjectDraft {
    pub name: String,
    pub description: String,
    pub color: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ProjectPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub status: Option<ProjectStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub health: Option<ProjectHealth>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
    /// Use `Some(None)` sentinel semantics: pass explicit `null` from the
    /// frontend to clear; omit to leave unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub start_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_at: Option<i64>,
}

/// A Cycle is a time-boxed span that bundles tasks (sprint, week, release).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct Cycle {
    pub id: String,
    pub name: String,
    pub start_at: i64,
    pub end_at: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct CycleDraft {
    pub name: String,
    pub start_at: i64,
    pub end_at: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct CyclePatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub start_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub end_at: Option<i64>,
}

/// How the agent task execution session is constrained.
/// Distinct from the settings-level `PermissionMode` (which controls the
/// interactive agent permission pipeline). This type governs per-task
/// autonomous execution safety.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum AgentPermissionMode {
    /// User confirms every tool use. Default for manual runs.
    Ask,
    /// Agent plans but does not execute.
    Plan,
    /// Auto-accept file edits; confirm shell writes.
    AcceptEdits,
    /// No prompts. REQUIRES ExecutionLocation::Worktree.
    Bypass,
}

/// Where the agent runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum ExecutionLocation {
    /// The user's live workspace. Default for manual runs.
    MainWorkspace,
    /// An isolated git worktree (auto-created, auto-cleaned after review).
    Worktree,
}

/// Per-task executor configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct AgentConfig {
    /// Provider override; None → use the app's currently-active provider
    /// (anthropic, openai, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub provider: Option<String>,

    /// Model override; None → system default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,

    /// Explicit skill allow-list; None → planner/default picks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub skills: Option<Vec<String>>,

    pub permission_mode: AgentPermissionMode,
    pub execution_location: ExecutionLocation,

    /// Extra command patterns to block (merged with global deny-list).
    #[serde(default)]
    pub deny_list: Vec<String>,

    /// Optional network allow-list. None = open; Some([]) = offline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub network_allow_list: Option<Vec<String>>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            provider: None,
            model: None,
            skills: None,
            permission_mode: AgentPermissionMode::Ask,
            execution_location: ExecutionLocation::MainWorkspace,
            deny_list: Vec::new(),
            network_allow_list: None,
        }
    }
}

/// Preset cadence for scheduled tasks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum PresetKind {
    Hourly,
    Daily,
    Weekly,
    Monthly,
}

/// Event trigger kinds. v1 ships one variant; enum lets Phase 5+ add more without migration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    AgentSessionEnded,
}

/// How a task fires automatically. `None` on Task = one-shot / manual.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum Schedule {
    /// Fire once at the given UTC millis.
    OneShot { at: i64 },
    /// Fire on a raw cron expression (UTC).
    Cron { expr: String, next_fire: i64 },
    /// Preset kind — hour/minute interpreted in UTC; weekday is 0..=6 (Mon=0).
    Preset {
        kind: PresetKind,
        hour: u8,
        minute: u8,
        weekday: Option<u8>,
        next_fire: i64,
    },
    /// Event-driven. v1 populates this shape but the scheduler wires it up in Phase 5.
    EventTriggered { event: EventKind },
}

/// The core task entity. `agent_config` + `schedule` are `Option` so Phase 1
/// (manual-only) persists `None` without schema churn.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub executor: Executor,
    pub priority: TaskPriority,
    pub created_at: i64,
    pub updated_at: i64,

    /// `None` for manual tasks (Phase 1). Activated in Phase 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent_config: Option<AgentConfig>,
    /// `None` for one-shot tasks. Activated in Phase 4.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub schedule: Option<Schedule>,

    #[serde(default)]
    pub context_anchors: Vec<ContextAnchor>,
    #[serde(default)]
    pub runs: Vec<TaskRun>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default)]
    pub catch_up_on_launch: bool,
    pub origin: TaskOrigin,
    /// Ordered checklist items. Defaults to empty for tasks created before the
    /// subtask feature; `ALTER TABLE ... DEFAULT '[]'` covers existing rows.
    #[serde(default)]
    pub subtasks: Vec<Subtask>,
    /// Label ids attached to this task. Labels themselves live in their own
    /// table keyed by id; the ids here are looked up to render badges.
    #[serde(default)]
    pub label_ids: Vec<String>,
    /// Optional project membership. `None` means "no project."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub project_id: Option<String>,
    /// Optional cycle membership. `None` means "no cycle."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cycle_id: Option<String>,
}

/// Filter applied on `task_list`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct TaskListFilters {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub status: Option<Vec<TaskStatus>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub executor: Option<Executor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub priority: Option<Vec<TaskPriority>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub query: Option<String>,
}

/// Payload for `task_create` — minimal fields; server fills id/timestamps.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct TaskDraft {
    pub title: String,
    pub description: String,
    pub executor: Executor,
    pub priority: TaskPriority,
    /// Optional initial subtasks. Each becomes a `Subtask` with a server-assigned id.
    #[serde(default)]
    pub subtasks: Vec<SubtaskDraft>,
    #[serde(default)]
    pub label_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cycle_id: Option<String>,
}

/// Partial update for `task_update` — any `Some` field is written; `None` leaves alone.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct TaskPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub status: Option<TaskStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub priority: Option<TaskPriority>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub catch_up_on_launch: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent_config: Option<AgentConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub schedule: Option<Schedule>,
    /// Bulk-replace subtasks. Rarely used from the UI (we prefer fine-grained
    /// `task_subtask_*` commands); kept for completeness.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub subtasks: Option<Vec<Subtask>>,
    /// Bulk-replace label ids. Fine-grained operations live on
    /// `task_label_add` / `task_label_remove`; this is for atomic sets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label_ids: Option<Vec<String>>,
    /// Explicit-null semantics: omit to leave unchanged; pass `null` to clear.
    /// `TaskPatchNullable<String>` encodes this via an outer Option of inner
    /// Option; we keep it simple with a separate boolean flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub clear_project: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cycle_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub clear_cycle: Option<bool>,
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

    // =========================================================================
    // Update events
    // =========================================================================
    /// An app update is available
    #[serde(rename = "update:available")]
    UpdateAvailable {
        version: String,
        body: Option<String>,
        date: Option<String>,
    },

    /// Update download progress
    #[serde(rename = "update:progress")]
    UpdateProgress {
        chunk_length: usize,
        content_length: Option<u64>,
    },

    /// Update ready to install
    #[serde(rename = "update:ready")]
    UpdateReady {},

    /// Update error
    #[serde(rename = "update:error")]
    UpdateError { error: String },

    // =========================================================================
    // Vault events
    // =========================================================================
    /// A new entry was added to the vault (local)
    #[serde(rename = "vault:entry_added")]
    VaultEntryAdded { entry_id: String },

    /// An existing entry was updated (tags, scope, pin, status)
    #[serde(rename = "vault:entry_updated")]
    VaultEntryUpdated { entry_id: String },

    /// An entry was deleted
    #[serde(rename = "vault:entry_deleted")]
    VaultEntryDeleted { entry_id: String },

    /// Progress on the local indexing pipeline for an entry
    #[serde(rename = "vault:index_progress")]
    VaultIndexProgress {
        entry_id: String,
        /// One of: validate, extract, chunk, embed, store, notify
        stage: String,
        /// [0, 100]
        pct: u8,
    },

    /// Cloud sync state changed for an entry
    #[serde(rename = "vault:cloud_sync_updated")]
    VaultCloudSyncUpdated {
        entry_id: String,
        state: CloudSyncState,
    },

    /// Non-fatal cloud retrieval status while local results remain usable.
    #[serde(rename = "vault:retrieval_warning")]
    VaultRetrievalWarning { message: String },

    /// Count of entries in the Unsorted review tray changed
    #[serde(rename = "vault:unsorted_count_changed")]
    VaultUnsortedCountChanged { count: u32 },

    /// Progress for the semantic embeddings backfill job.
    ///
    /// Emitted once per batch while `vault_backfill_embeddings` runs, plus a
    /// final event with `done = true` that carries the terminal totals. The
    /// frontend subscribes to this to animate a "Rebuilding index…" toast.
    #[serde(rename = "vault:backfill_progress")]
    VaultBackfillProgress {
        /// Total chunks pending embedding at start of this backfill run.
        total: u64,
        /// Chunks successfully embedded so far (cumulative across batches).
        completed: u64,
        /// Chunks that failed (dim mismatch, corrupt BLOB, provider error).
        failed: u64,
        /// Wall-clock milliseconds elapsed since backfill started.
        elapsed_ms: u64,
        /// `true` on the last event for this run; `false` for ticks.
        done: bool,
    },

    /// Progress for re-extracting legacy entries after new local extractors
    /// are installed.
    #[serde(rename = "vault:reextract_progress")]
    VaultReextractProgress {
        /// Total legacy entries pending at start of this run.
        total: u64,
        /// Entries attempted so far.
        completed: u64,
        /// Entries that produced at least one chunk.
        recovered: u64,
        /// Entries that still produced no searchable text.
        failed: u64,
        /// Wall-clock milliseconds elapsed since re-extract started.
        elapsed_ms: u64,
        /// `true` on the last event for this run; `false` for ticks.
        done: bool,
    },

    // =========================================================================
    // Settings events
    // =========================================================================
    /// Settings file changed on disk or via API.
    ///
    /// The payload carries the fully-merged settings after the change.
    #[serde(rename = "settings:changed")]
    SettingsChanged { settings: SoloSettings },

    // =========================================================================
    // Agent-session events (Debug mode)
    // =========================================================================
    /// Captured the initial goal for a session (fires once per session,
    /// when the first user message lands while Debug mode is active).
    #[serde(rename = "session:goal_captured")]
    SessionGoalCaptured { goal: SessionGoal },

    /// The permission mode for a session changed.
    #[serde(rename = "session:mode_changed")]
    SessionModeChanged {
        session_id: String,
        mode: PermissionMode,
    },

    // =========================================================================
    // Voice events
    // =========================================================================
    /// Voice pipeline state changed
    #[serde(rename = "voice:state")]
    VoiceState {
        mode: VoiceMode,
        state: VoicePipelineState,
    },

    /// Voice audio level update
    #[serde(rename = "voice:level")]
    VoiceLevel { rms: f32 },

    /// Voice transcript result ready
    #[serde(rename = "voice:transcript")]
    VoiceTranscript { result: VoiceTranscriptResult },

    /// Voice error occurred
    #[serde(rename = "voice:error")]
    VoiceError { message: String },

    /// Voice model download progress
    #[serde(rename = "voice:model_progress")]
    VoiceModelProgress { progress: VoiceModelProgress },

    /// Task allocator store mutated — frontend should refetch affected tasks.
    /// `task_ids` lists the tasks that changed; empty slice means "refetch all".
    #[serde(rename = "tasks:changed")]
    TasksChanged { task_ids: Vec<String> },

    /// A task run started (task_id → run_id).
    #[serde(rename = "tasks:run_started")]
    TaskRunStarted { task_id: String, run_id: String },

    /// Incremental progress — summary text of latest event (truncated).
    #[serde(rename = "tasks:run_progress")]
    TaskRunProgress {
        task_id: String,
        run_id: String,
        summary: String,
    },

    /// Terminal — the run ended with an outcome.
    #[serde(rename = "tasks:run_ended")]
    TaskRunEnded {
        task_id: String,
        run_id: String,
        outcome: RunOutcome,
        summary: Option<String>,
    },

    /// A task in a worktree finished with pending changes; show review modal.
    #[serde(rename = "tasks:review_ready")]
    TaskReviewReady {
        task_id: String,
        run_id: String,
        worktree_id: String,
        diff_summary: String, // "N files changed, +X/-Y"
    },

    /// Label store mutated. Empty slice = refetch all.
    #[serde(rename = "labels:changed")]
    LabelsChanged { label_ids: Vec<String> },

    /// Project store mutated. Empty slice = refetch all.
    #[serde(rename = "projects:changed")]
    ProjectsChanged { project_ids: Vec<String> },

    /// Cycle store mutated. Empty slice = refetch all.
    #[serde(rename = "cycles:changed")]
    CyclesChanged { cycle_ids: Vec<String> },
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
// Claude CLI Setup
// =============================================================================

/// Status of the Claude Code CLI setup
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
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

// =============================================================================
// Permission / Mode / Settings Protocol
// =============================================================================

/// Active permission mode for an agent session.
///
/// Inspired by Claude Code's permission modes. Each mode is an *overlay*
/// on the baseline allow/ask/deny rules from settings:
///
/// - `Default` — strictly honor the allow/ask/deny lists; prompt on `ask`.
/// - `Plan`    — read-only by default; writes are redirected to the plan file.
/// - `Accept`  — bypass prompts (like `--dangerously-skip-permissions`), but
///   the destructive tier still prompts (bypass-immune).
/// - `Debug`   — same gating as `Default`; adds goal-capture + periodic review.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum PermissionMode {
    #[default]
    Default,
    Plan,
    Accept,
    Debug,
}

/// Classification of a tool for permission gating.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum ToolTier {
    /// Read-only operations (auto-allowed in every mode).
    Read,
    /// Mutating operations (file writes, shell commands, package installs).
    Mutate,
    /// Destructive operations (always prompt, even under Accept mode).
    Destructive,
}

/// The scope a permission rule came from.
///
/// Mirrors Claude Code's settings hierarchy. Higher values override lower
/// ones on merge, but `Deny` rules from any scope are bypass-immune.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum SettingsScope {
    /// `~/.solo/settings.json`
    User,
    /// `<workspace>/.solo/settings.json`
    Project,
    /// `<workspace>/.solo/settings.local.json` (git-ignored)
    Local,
}

/// Permission rules configured by the user.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PermissionsConfig {
    /// Starting mode when a new session is created.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_mode: Option<PermissionMode>,
    /// Rules that auto-allow. Entries are `ToolName` or `ToolName(content-pattern)`.
    #[serde(default)]
    pub allow: Vec<String>,
    /// Rules that auto-deny (bypass-immune).
    #[serde(default)]
    pub deny: Vec<String>,
    /// Rules that force a prompt (bypass-immune under Accept mode).
    #[serde(default)]
    pub ask: Vec<String>,
    /// Directories outside the workspace that should be treated as read-allowed.
    #[serde(default)]
    pub additional_directories: Vec<String>,
    /// Disable Accept mode entirely (for managed / policy settings).
    #[serde(default)]
    pub disable_accept_mode: bool,
}

/// Debug mode configuration.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct DebugModeConfig {
    /// Number of assistant turns between review questions.
    pub review_interval: u32,
    /// How the goal is captured at session start.
    pub initial_goal_capture: GoalCaptureMode,
}

impl Default for DebugModeConfig {
    fn default() -> Self {
        Self {
            review_interval: 3,
            initial_goal_capture: GoalCaptureMode::FirstMessage,
        }
    }
}

/// How Debug mode captures the user's goal at session start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GoalCaptureMode {
    /// Treat the first user message verbatim as the goal.
    FirstMessage,
    /// Prompt the user for an explicit goal statement before the session starts.
    Explicit,
}

/// Per-mode configuration bundle.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ModesConfig {
    #[serde(default)]
    pub debug: DebugModeConfig,
}

/// Which external skill sources Solo should scan alongside `.solo/skills/`.
///
/// Solo is polyglot by default: users arriving from Claude Code or Codex keep
/// their existing skills without copying or reconfiguration. Each flag can be
/// turned off independently via user settings.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SkillsConfig {
    /// Scan `~/.claude/skills/` (Claude Code user-personal skills).
    #[serde(default = "default_true")]
    pub import_claude_user: bool,
    /// Scan `~/.claude/plugins/` using `installed_plugins.json` as the manifest.
    #[serde(default = "default_true")]
    pub import_claude_plugins: bool,
    /// Scan `{workspace}/.claude/skills/` and ancestor `.claude/skills/` dirs.
    #[serde(default = "default_true")]
    pub import_claude_project: bool,
    /// Scan `~/.codex/skills/` (forward-compat; harmless if the dir does not exist).
    #[serde(default = "default_true")]
    pub import_codex: bool,
    /// Whether the first-launch onboarding dialog has been shown.
    #[serde(default)]
    pub onboarding_shown: bool,
}

fn default_true() -> bool {
    true
}

impl Default for SkillsConfig {
    fn default() -> Self {
        Self {
            import_claude_user: true,
            import_claude_plugins: true,
            import_claude_project: true,
            import_codex: true,
            onboarding_shown: false,
        }
    }
}

/// Full Solo settings, merged from user → project → local scopes.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SoloSettings {
    #[serde(default)]
    pub permissions: PermissionsConfig,
    #[serde(default)]
    pub modes: ModesConfig,
    #[serde(default)]
    pub skills: SkillsConfig,
    #[serde(default)]
    pub plugins: PluginsConfig,
    /// Free-form notes the planner injects into every goal-plan run.
    /// Stored at user scope so it applies across all workspaces.
    #[serde(default)]
    pub planner_notes: String,
}

/// Outcome of a permission check. Mirrors Claude Code's `PermissionResult`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "behavior", rename_all = "lowercase")]
pub enum PermissionDecision {
    /// Tool may proceed.
    Allow {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// Prompt the user.
    Ask {
        message: String,
        /// Which tier triggered the prompt (for UI display).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tier: Option<ToolTier>,
    },
    /// Tool is blocked.
    Deny { message: String },
}

/// Request to check whether a tool call should be allowed.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PermissionCheckRequest {
    pub tool_name: String,
    #[ts(type = "unknown")]
    pub tool_input: serde_json::Value,
    pub mode: PermissionMode,
}

/// Captured goal for a session in Debug mode.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SessionGoal {
    pub session_id: String,
    pub goal: String,
    pub captured_at: u64,
}

// =============================================================================
// Skills Protocol
// =============================================================================

/// Origin of a discovered skill. First two are Solo's native scopes; the rest
/// are compatibility adapters so users keep the skills they already have.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum SkillSource {
    /// `~/.solo/skills/`
    User,
    /// `{workspace}/.solo/skills/`
    Project,
    /// `~/.claude/skills/`
    ClaudeUser,
    /// `~/.claude/plugins/cache/<mkt>/<plugin>/<ver>/skills/`
    ClaudePlugin,
    /// `{workspace-or-ancestor}/.claude/skills/`
    ClaudeProject,
    /// `~/.codex/skills/`
    Codex,
}

impl SkillSource {
    /// Dedup priority — higher wins when two sources declare the same skill name.
    /// Rationale: project-local wins over user; Solo-native wins over imports.
    #[must_use]
    pub fn priority(self) -> u8 {
        match self {
            Self::Project => 60,
            Self::User => 50,
            Self::ClaudeProject => 40,
            Self::ClaudeUser => 30,
            Self::ClaudePlugin => 20,
            Self::Codex => 10,
        }
    }
}

/// Skill information returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub content: String,
    pub source: SkillSource,
    pub file_path: String,
    pub enabled: bool,
    pub priority: i32,
}

/// Request to create or overwrite a user/project skill on disk.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SkillWriteRequest {
    /// Filesystem-safe skill name (becomes directory under `.solo/skills/`).
    pub name: String,
    /// Only `User` or `Project` are valid write destinations.
    pub scope: SkillSource,
    /// Frontmatter `description` field.
    pub description: String,
    /// Markdown body (without frontmatter — Solo injects it).
    pub body: String,
    /// Project-scope writes need the workspace cwd.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

/// Result of first-launch onboarding probe.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SkillsOnboardingStatus {
    /// Whether the onboarding dialog should be shown.
    pub should_prompt: bool,
    /// Count of importable skills found outside `.solo/`.
    pub importable_count: u32,
    /// Whether `~/.solo/skills/` already has at least one skill.
    pub has_solo_skills: bool,
}

/// How to bring external skills into Solo during onboarding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum OnboardingImportMode {
    /// Leave external files in place, just keep the adapters enabled.
    ReadOnly,
    /// Copy every external skill into `~/.solo/skills/` (snapshot).
    Copy,
    /// Symlink every external skill into `~/.solo/skills/` (live sync).
    Symlink,
}

// =============================================================================
// Stats & Tier Protocol
// =============================================================================

/// Pending counters buffered on-device before the next cloud sync.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct StatsDelta {
    #[serde(default)]
    pub commits: u64,
    #[serde(default)]
    pub tokens: u64,
    #[serde(default)]
    pub worktrees: u64,
    #[serde(default)]
    pub sessions: u64,
    #[serde(default)]
    pub messages: u64,
}

/// Cumulative stats pulled from the cloud. Drives the Journey page UI.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct CumulativeStats {
    #[serde(default)]
    pub commits: u64,
    #[serde(default)]
    pub tokens: u64,
    #[serde(default)]
    pub worktrees: u64,
    #[serde(default)]
    pub sessions: u64,
    #[serde(default)]
    pub messages: u64,
    #[serde(default)]
    pub tier: u8,
    #[serde(default)]
    pub tier_progress: f64,
    #[serde(default)]
    pub score: f64,
    #[serde(default)]
    pub streak_current: u32,
    #[serde(default)]
    pub streak_longest: u32,
    #[serde(default)]
    pub last_active: Option<String>,
}

/// Full on-disk + in-memory snapshot of the local stats state.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct StatsSnapshot {
    #[serde(default)]
    pub pending: StatsDelta,
    #[serde(default)]
    pub cumulative: CumulativeStats,
    #[serde(default)]
    pub last_sync_at: Option<String>,
}

/// One row of the usage heatmap. Raw per-day counters; the client computes
/// the usage score so weight calibration stays out of the server.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct DailyActivityEntry {
    pub date: String,
    #[serde(default)]
    pub commits: u64,
    #[serde(default)]
    pub tokens: u64,
    #[serde(default)]
    pub worktrees: u64,
    #[serde(default)]
    pub sessions: u64,
    #[serde(default)]
    pub messages: u64,
}

/// Single entry in the cloud leaderboard response.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    pub user_id: String,
    #[serde(default)]
    pub github_username: Option<String>,
    pub tier: u8,
    pub score: f64,
    pub commits: u64,
    pub tokens: u64,
    pub worktrees: u64,
}

/// Tier metadata returned by `/v1/tier/me` plus the unlocked name pool.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct TierInfo {
    pub tier: u8,
    pub tier_progress: f64,
    pub score: f64,
    pub tier_name: String,
    pub names: Vec<String>,
}

// =============================================================================
// Voice Configuration (Phase 2)
// =============================================================================

/// Keyboard shortcuts configuration for voice activation.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ShortcutsConfig {
    /// Macro-style shortcut spec: e.g. `"fn"`, `"ctrl+alt+space"`, `"escape"`.
    pub dictation_ptt: String,
    pub dispatch_ptt: String,
    pub cancel: String,
}

impl Default for ShortcutsConfig {
    fn default() -> Self {
        Self {
            dictation_ptt: "fn".into(),
            dispatch_ptt: "ctrl+alt+space".into(),
            cancel: "escape".into(),
        }
    }
}

/// Snapshot of voice-related macOS permissions.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct VoicePermissions {
    pub microphone: bool,
    pub input_monitoring: bool,
    pub accessibility: bool,
}

// =============================================================================
// Plugins Protocol
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS, Hash, PartialEq, Eq)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginId {
    pub marketplace: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum PluginSource {
    Local,
    Marketplace,
    ClaudeAdapter,
    CodexAdapter,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginSummary {
    pub id: PluginId,
    pub version: String,
    pub display_name: String,
    pub short_description: Option<String>,
    pub logo: Option<String>,
    pub brand_color: Option<String>,
    pub enabled: bool,
    pub source: PluginSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginDetail {
    pub id: PluginId,
    pub version: String,
    pub source: PluginSource,
    pub enabled: bool,
    pub root_path: String,
    pub description: Option<String>,
    pub interface: Option<PluginInterface>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginInterface {
    pub display_name: Option<String>,
    pub short_description: Option<String>,
    pub long_description: Option<String>,
    pub developer_name: Option<String>,
    pub category: Option<String>,
    pub capabilities: Vec<String>,
    pub website_url: Option<String>,
    pub privacy_policy_url: Option<String>,
    pub terms_of_service_url: Option<String>,
    pub default_prompts: Vec<String>,
    pub brand_color: Option<String>,
    pub composer_icon: Option<String>,
    pub logo: Option<String>,
    pub screenshots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginInstallResult {
    pub id: PluginId,
    pub version: String,
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginListOutcome {
    pub plugins: Vec<PluginSummary>,
    pub errors: Vec<PluginLoadError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct PluginLoadError {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PluginsConfig {
    #[serde(default = "default_true_plugins")]
    pub adapter_claude_plugins: bool,
    #[serde(default = "default_true_plugins")]
    pub adapter_codex_user: bool,
}

impl Default for PluginsConfig {
    fn default() -> Self {
        Self {
            adapter_claude_plugins: true,
            adapter_codex_user: true,
        }
    }
}

fn default_true_plugins() -> bool {
    true
}

// =============================================================================
// Skills Marketplace Protocol
// =============================================================================

/// One entry in the public skills registry.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct RegistryEntry {
    pub id: String,
    #[serde(default)]
    pub skill_id: String,
    pub name: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub source_type: String,
    pub version: String,
    pub description: String,
    pub categories: Vec<String>,
    pub author: String,
    pub license: String,
    pub tarball_url: String,
    pub sha256: String,
    pub tags: Vec<String>,
    pub updated_at: String,
    #[serde(default)]
    pub install_url: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub installs: u32,
    #[serde(default)]
    pub is_official: bool,
    #[serde(default)]
    pub is_duplicate: bool,
}

/// The full parsed `registry.json` pulled from `solo/skills-registry`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct Registry {
    pub version: u32,
    pub generated_at: String,
    pub skills: Vec<RegistryEntry>,
    #[serde(default)]
    pub total_skills: u32,
    #[serde(default)]
    pub has_more: bool,
    #[serde(default)]
    pub next_page: Option<u32>,
    #[serde(default)]
    pub view: String,
}

/// A marketplace hit scored against the current user query.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct SkillSuggestion {
    pub entry: RegistryEntry,
    pub score: f32,
    pub reason: String,
}

/// A text file bundled inside a skill.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct SkillFile {
    pub path: String,
    pub contents: String,
    pub bytes: u32,
}

/// A normalized skills.sh security audit row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct SkillAudit {
    pub provider: String,
    pub status: String,
    pub summary: String,
    pub risk_level: String,
    pub audited_at: String,
}

/// Details used by the in-app skills.sh preview and installer.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct SkillDetail {
    pub entry: RegistryEntry,
    pub description: String,
    pub install_command: String,
    pub web_url: String,
    pub source_url: String,
    pub hash: Option<String>,
    pub files: Vec<SkillFile>,
    pub audits: Vec<SkillAudit>,
    pub installable: bool,
    pub install_note: String,
}

/// Where an installed skill came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum OriginSource {
    Registry,
    Bundled,
    User,
}

/// Persisted alongside an installed skill as `.solo-origin.json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct InstalledSkillMeta {
    pub source: OriginSource,
    pub id: String,
    pub version: String,
    pub installed_at: String,
    pub modified: bool,
    /// Present when installed from the registry; the upstream tarball sha256 at install time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream_sha256: Option<String>,
}

/// Events emitted by the skills marketplace subsystem.
///
/// Emitted via `app.emit("skills-event", SkillsEvent::...)`. The tagged union
/// mirrors `BackendEvent`'s shape — `type` is the discriminant, colon-separated
/// to match existing event naming conventions.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "type")]
pub enum SkillsEvent {
    #[serde(rename = "skills:suggestion")]
    Suggestion {
        session_id: String,
        suggestions: Vec<SkillSuggestion>,
    },
    #[serde(rename = "skills:installed")]
    Installed { skill_id: String },
    #[serde(rename = "skills:uninstalled")]
    Uninstalled { skill_id: String },
    #[serde(rename = "skills:registry_updated")]
    RegistryUpdated,
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
