//! Tool system for AI agent
//!
//! This module provides infrastructure for registering and executing tools
//! that the AI agent can use. It includes support for tool approval flows
//! and parallel tool execution.

use std::collections::HashMap;
use std::fmt::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::provider::ToolDefinition;
use solo_protocol::{AgentToolCall, ToolCallStatus, ToolCallWithStatus, ToolResult};

// =============================================================================
// Errors
// =============================================================================

/// Tool execution error
#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("Tool not found: {0}")]
    NotFound(String),
    #[error("Tool execution failed: {0}")]
    ExecutionFailed(String),
    #[error("Tool call not found: {0}")]
    ToolCallNotFound(String),
    #[error("Tool call was rejected")]
    Rejected,
    #[error("Tool call is pending approval")]
    PendingApproval,
    #[error("Path validation failed: {0}")]
    PathViolation(String),
    #[error("Command blocked: {0}")]
    CommandBlocked(String),
    #[error("Execution timed out after {0}ms")]
    Timeout(u64),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

/// Result type for tool operations
pub type ToolResult_ = Result<String, ToolError>;

// =============================================================================
// Path Validation
// =============================================================================

/// Validate that a path is safe for file operations.
/// Resolves the path and checks it doesn't escape the allowed roots.
fn validate_path(
    path_str: &str,
    workspace_root: Option<&Path>,
) -> Result<std::path::PathBuf, ToolError> {
    let path = Path::new(path_str);

    // Must be absolute
    if !path.is_absolute() {
        return Err(ToolError::PathViolation(
            "Path must be absolute".to_string(),
        ));
    }

    // Canonicalize to resolve symlinks and ../ components
    // Use the raw path if the file doesn't exist yet (for write operations)
    let canonical = if path.exists() {
        path.canonicalize()
            .map_err(|e| ToolError::PathViolation(format!("Failed to resolve path: {}", e)))?
    } else {
        // For new files, canonicalize the parent directory
        let parent = path
            .parent()
            .ok_or_else(|| ToolError::PathViolation("Path has no parent directory".to_string()))?;
        if !parent.exists() {
            return Err(ToolError::PathViolation(format!(
                "Parent directory does not exist: {}",
                parent.display()
            )));
        }
        let canonical_parent = parent.canonicalize().map_err(|e| {
            ToolError::PathViolation(format!("Failed to resolve parent path: {}", e))
        })?;
        canonical_parent.join(
            path.file_name()
                .ok_or_else(|| ToolError::PathViolation("Path has no filename".to_string()))?,
        )
    };

    // Block sensitive system paths
    let blocked_prefixes: &[&str] = &[
        "/etc/shadow",
        "/etc/passwd",
        "/etc/sudoers",
        "/proc",
        "/sys",
        "/dev",
    ];
    let canonical_str = canonical.to_string_lossy();
    for prefix in blocked_prefixes {
        if canonical_str.starts_with(prefix) {
            return Err(ToolError::PathViolation(format!(
                "Access to {} is blocked",
                prefix
            )));
        }
    }

    // If workspace root is set, enforce containment
    if let Some(root) = workspace_root {
        if let Ok(canonical_root) = root.canonicalize() {
            if !canonical.starts_with(&canonical_root) {
                return Err(ToolError::PathViolation(format!(
                    "Path escapes workspace root: {} is outside {}",
                    canonical.display(),
                    canonical_root.display()
                )));
            }
        }
    }

    Ok(canonical)
}

// =============================================================================
// Tool Executor Trait
// =============================================================================

/// Trait for implementing tool execution
#[async_trait::async_trait]
pub trait ToolExecutor: Send + Sync {
    /// Execute the tool with the given arguments
    async fn execute(&self, args: serde_json::Value) -> ToolResult_;

    /// Get the tool definition
    fn definition(&self) -> ToolDefinition;
}

// =============================================================================
// Pending Approval Entry (with TTL)
// =============================================================================

struct PendingEntry {
    status: ToolCallWithStatus,
    created_at: Instant,
}

/// Maximum age for pending approvals before they're cleaned up (5 minutes)
const PENDING_APPROVAL_TTL: Duration = Duration::from_secs(300);
/// Maximum number of pending entries before forced cleanup
const MAX_PENDING_ENTRIES: usize = 100;

// =============================================================================
// Tool Registry
// =============================================================================

/// Shared workspace root that propagates to all tools
pub type SharedWorkspaceRoot = Arc<RwLock<Option<PathBuf>>>;

/// Registry of available tools
pub struct ToolRegistry {
    /// Registered tools
    tools: HashMap<String, Arc<dyn ToolExecutor>>,
    /// Pending tool calls awaiting approval (with TTL tracking)
    pending_approvals: RwLock<HashMap<String, PendingEntry>>,
    /// Shared workspace root for path containment (shared with all tools)
    workspace_root: SharedWorkspaceRoot,
}

impl ToolRegistry {
    /// Create a new tool registry
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            pending_approvals: RwLock::new(HashMap::new()),
            workspace_root: Arc::new(RwLock::new(None)),
        }
    }

    /// Create a new tool registry with a shared workspace root
    pub fn with_workspace_root(workspace_root: SharedWorkspaceRoot) -> Self {
        Self {
            tools: HashMap::new(),
            pending_approvals: RwLock::new(HashMap::new()),
            workspace_root,
        }
    }

    /// Get the shared workspace root handle (for passing to tools)
    pub fn shared_workspace_root(&self) -> SharedWorkspaceRoot {
        self.workspace_root.clone()
    }

    /// Set the workspace root for path validation (propagates to all tools sharing this root)
    pub async fn set_workspace_root(&self, root: impl Into<PathBuf>) {
        *self.workspace_root.write().await = Some(root.into());
    }

    /// Get the workspace root
    pub async fn get_workspace_root(&self) -> Option<PathBuf> {
        self.workspace_root.read().await.clone()
    }

    /// Register a tool
    pub fn register<T: ToolExecutor + 'static>(&mut self, tool: T) {
        let def = tool.definition();
        self.tools.insert(def.name.clone(), Arc::new(tool));
    }

    /// Get a tool executor by name (cloned Arc, safe to hold across await)
    pub fn get(&self, name: &str) -> Option<Arc<dyn ToolExecutor>> {
        self.tools.get(name).cloned()
    }

    /// Get all tool definitions
    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.tools.values().map(|t| t.definition()).collect()
    }

    /// Check if a tool requires approval
    pub fn requires_approval(&self, name: &str) -> bool {
        self.tools
            .get(name)
            .map(|t| t.definition().needs_approval)
            .unwrap_or(false)
    }

    /// Clean up expired pending approvals
    async fn cleanup_expired(&self) {
        let mut pending = self.pending_approvals.write().await;
        let now = Instant::now();
        pending.retain(|_, entry| now.duration_since(entry.created_at) < PENDING_APPROVAL_TTL);
    }

    /// Add a tool call to pending approvals
    pub async fn add_pending_approval(&self, tool_call: AgentToolCall, needs_approval: bool) {
        // Clean up expired entries if we're getting large
        {
            let pending = self.pending_approvals.read().await;
            if pending.len() >= MAX_PENDING_ENTRIES {
                drop(pending);
                self.cleanup_expired().await;
            }
        }

        let entry = PendingEntry {
            status: ToolCallWithStatus {
                tool_call: tool_call.clone(),
                status: ToolCallStatus::PendingApproval,
                result: None,
                error: None,
                needs_approval,
            },
            created_at: Instant::now(),
        };
        self.pending_approvals
            .write()
            .await
            .insert(tool_call.id, entry);
    }

    /// Approve a tool call and remove it from pending
    pub async fn approve(&self, tool_call_id: &str) -> Result<ToolCallWithStatus, ToolError> {
        let mut pending = self.pending_approvals.write().await;
        let entry = pending
            .remove(tool_call_id)
            .ok_or_else(|| ToolError::ToolCallNotFound(tool_call_id.to_string()))?;
        let mut status = entry.status;
        status.status = ToolCallStatus::Approved;
        Ok(status)
    }

    /// Reject a tool call and remove it from pending
    pub async fn reject(&self, tool_call_id: &str) -> Result<ToolCallWithStatus, ToolError> {
        let mut pending = self.pending_approvals.write().await;
        let entry = pending
            .remove(tool_call_id)
            .ok_or_else(|| ToolError::ToolCallNotFound(tool_call_id.to_string()))?;
        let mut status = entry.status;
        status.status = ToolCallStatus::Rejected;
        Ok(status)
    }

    /// Get a pending tool call
    pub async fn get_pending(&self, tool_call_id: &str) -> Option<ToolCallWithStatus> {
        self.pending_approvals
            .read()
            .await
            .get(tool_call_id)
            .map(|e| e.status.clone())
    }

    /// Execute a tool call. Looks up the executor, clones the Arc, then drops
    /// the registry borrow before awaiting execution.
    pub async fn execute(&self, tool_call: &AgentToolCall) -> ToolResult {
        // Clone the Arc<dyn ToolExecutor> so we don't hold any borrow during await
        let executor = self.tools.get(&tool_call.name).cloned();

        match executor {
            Some(executor) => {
                let args: serde_json::Value = serde_json::from_str(&tool_call.arguments)
                    .unwrap_or_else(|_| serde_json::json!({}));

                match executor.execute(args).await {
                    Ok(result) => ToolResult {
                        tool_call_id: tool_call.id.clone(),
                        success: true,
                        content: Some(result),
                        error: None,
                    },
                    Err(e) => ToolResult {
                        tool_call_id: tool_call.id.clone(),
                        success: false,
                        content: None,
                        error: Some(e.to_string()),
                    },
                }
            }
            None => ToolResult {
                tool_call_id: tool_call.id.clone(),
                success: false,
                content: None,
                error: Some(format!("Tool not found: {}", tool_call.name)),
            },
        }
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Built-in Tools
// =============================================================================

/// Read file tool with path validation, optional offset/limit for large files.
pub struct ReadFileTool {
    workspace_root: SharedWorkspaceRoot,
}

impl ReadFileTool {
    pub fn new(workspace_root: SharedWorkspaceRoot) -> Self {
        Self { workspace_root }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for ReadFileTool {
    async fn execute(&self, args: serde_json::Value) -> ToolResult_ {
        let path_str = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'path' argument".to_string()))?;

        let ws_root = self.workspace_root.read().await;
        let path = validate_path(path_str, ws_root.as_deref())?;
        drop(ws_root);
        let content = tokio::fs::read_to_string(&path).await?;

        let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
        let limit = args
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize);

        // Add line numbers starting from offset (1-indexed)
        let lines: Vec<&str> = content.lines().collect();
        let start = if offset > 0 { offset - 1 } else { 0 };
        let end = match limit {
            Some(l) => (start + l).min(lines.len()),
            None => lines.len(),
        };

        if start >= lines.len() {
            return Ok(format!(
                "(file has {} lines, offset {} is past end)",
                lines.len(),
                offset
            ));
        }

        let numbered: Vec<String> = lines[start..end]
            .iter()
            .enumerate()
            .map(|(i, line)| format!("{:>6} | {}", start + i + 1, line))
            .collect();

        Ok(numbered.join("\n"))
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "read_file".to_string(),
            description: "Read the contents of a file with line numbers. Supports offset and limit for large files.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file"
                    },
                    "offset": {
                        "type": "integer",
                        "minimum": 1,
                        "default": 1,
                        "description": "Start line number (1-indexed, default: 1)"
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Number of lines to read (default: all)"
                    }
                },
                "required": ["path"]
            }),
            needs_approval: false,
        }
    }
}

/// Write file tool with path validation
pub struct WriteFileTool {
    workspace_root: SharedWorkspaceRoot,
}

impl WriteFileTool {
    pub fn new(workspace_root: SharedWorkspaceRoot) -> Self {
        Self { workspace_root }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for WriteFileTool {
    async fn execute(&self, args: serde_json::Value) -> ToolResult_ {
        let path_str = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'path' argument".to_string()))?;

        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'content' argument".to_string()))?;

        let ws_root = self.workspace_root.read().await;
        let path = validate_path(path_str, ws_root.as_deref())?;
        drop(ws_root);
        tokio::fs::write(&path, content).await?;
        Ok(format!(
            "Successfully wrote {} bytes to {}",
            content.len(),
            path.display()
        ))
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "write_file".to_string(),
            description: "Write content to a file (creates or overwrites)".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write"
                    }
                },
                "required": ["path", "content"]
            }),
            needs_approval: true,
        }
    }
}

/// List directory tool with path validation
pub struct ListDirectoryTool {
    workspace_root: SharedWorkspaceRoot,
}

impl ListDirectoryTool {
    pub fn new(workspace_root: SharedWorkspaceRoot) -> Self {
        Self { workspace_root }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for ListDirectoryTool {
    async fn execute(&self, args: serde_json::Value) -> ToolResult_ {
        let path_str = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'path' argument".to_string()))?;

        let ws_root = self.workspace_root.read().await;
        let path = validate_path(path_str, ws_root.as_deref())?;
        drop(ws_root);

        let mut entries = Vec::new();
        let mut read_dir = tokio::fs::read_dir(&path).await?;

        while let Some(entry) = read_dir.next_entry().await? {
            let file_type = entry.file_type().await?;
            let name = entry.file_name().to_string_lossy().to_string();
            let prefix = if file_type.is_dir() { "d " } else { "f " };
            entries.push(format!("{}{}", prefix, name));
        }

        entries.sort();
        Ok(entries.join("\n"))
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "list_directory".to_string(),
            description: "List contents of a directory".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path"
                    },
                    "depth": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 5,
                        "default": 1,
                        "description": "Depth of subdirectories to include"
                    }
                },
                "required": ["path"]
            }),
            needs_approval: false,
        }
    }
}

/// Bash command execution tool with command restrictions and timeout
pub struct BashTool {
    /// Default timeout for commands (milliseconds)
    default_timeout_ms: u64,
    /// Blocked command patterns (substrings that cause rejection)
    blocked_patterns: Vec<String>,
}

impl BashTool {
    pub fn new() -> Self {
        Self {
            default_timeout_ms: 30_000, // 30 seconds
            blocked_patterns: vec![
                // Destructive system commands
                "rm -rf /".to_string(),
                "mkfs".to_string(),
                "dd if=".to_string(),
                ":(){".to_string(), // fork bomb
                // Network exfiltration
                "curl.*|.*sh".to_string(),
                "wget.*|.*sh".to_string(),
                // Privilege escalation
                "chmod 777 /".to_string(),
                "chown root".to_string(),
                // Credential theft
                "cat /etc/shadow".to_string(),
                "cat /etc/passwd".to_string(),
            ],
        }
    }

    fn validate_command(&self, command: &str) -> Result<(), ToolError> {
        let cmd_lower = command.to_lowercase();

        for pattern in &self.blocked_patterns {
            if cmd_lower.contains(&pattern.to_lowercase()) {
                return Err(ToolError::CommandBlocked(format!(
                    "Command matches blocked pattern: {}",
                    pattern
                )));
            }
        }

        Ok(())
    }
}

impl Default for BashTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl ToolExecutor for BashTool {
    async fn execute(&self, args: serde_json::Value) -> ToolResult_ {
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'command' argument".to_string()))?;

        // Validate command against blocklist
        self.validate_command(command)?;

        let cwd = args.get("cwd").and_then(|v| v.as_str());
        let timeout_ms = args
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(self.default_timeout_ms);

        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c").arg(command);

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        // Execute with timeout
        let result = tokio::time::timeout(Duration::from_millis(timeout_ms), cmd.output()).await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);

                // Truncate very large outputs
                let max_output = 100_000;
                let truncate = |s: &str| -> String {
                    if s.len() > max_output {
                        format!("{}...\n[truncated at {} bytes]", &s[..max_output], s.len())
                    } else {
                        s.to_string()
                    }
                };

                if output.status.success() {
                    Ok(if stdout.is_empty() && !stderr.is_empty() {
                        truncate(&stderr)
                    } else {
                        truncate(&stdout)
                    })
                } else {
                    Err(ToolError::ExecutionFailed(format!(
                        "Command failed with exit code {:?}\nstdout: {}\nstderr: {}",
                        output.status.code(),
                        truncate(&stdout),
                        truncate(&stderr)
                    )))
                }
            }
            Ok(Err(e)) => Err(ToolError::IoError(e)),
            Err(_) => Err(ToolError::Timeout(timeout_ms)),
        }
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "bash".to_string(),
            description: "Execute a bash command".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Command to execute"
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Working directory"
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in milliseconds (default: 30000)"
                    }
                },
                "required": ["command"]
            }),
            needs_approval: true,
        }
    }
}

/// Cached check for ripgrep availability (checked once per process).
static RG_AVAILABLE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// Enhanced grep search tool — prefers `rg` (ripgrep) with fallback to `grep`.
pub struct GrepTool;

#[async_trait::async_trait]
impl ToolExecutor for GrepTool {
    async fn execute(&self, args: serde_json::Value) -> ToolResult_ {
        let pattern = args
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'pattern' argument".to_string()))?;

        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let max_results = args
            .get("max_results")
            .and_then(|v| v.as_u64())
            .unwrap_or(50);
        let context_lines = args
            .get("context_lines")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let case_insensitive = args
            .get("case_insensitive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let file_type = args.get("file_type").and_then(|v| v.as_str());

        // Try ripgrep first (cached), fall back to grep
        let rg_available = *RG_AVAILABLE.get_or_init(|| {
            std::process::Command::new("rg")
                .arg("--version")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        });

        let output = if rg_available {
            let mut cmd = tokio::process::Command::new("rg");
            cmd.arg("--line-number")
                .arg("--max-count")
                .arg(max_results.to_string())
                .arg("--context")
                .arg(context_lines.to_string());
            if case_insensitive {
                cmd.arg("--ignore-case");
            }
            if let Some(ft) = file_type {
                cmd.arg("--type").arg(ft);
            }
            cmd.arg(pattern).arg(path);
            cmd.output().await?
        } else {
            let mut cmd = tokio::process::Command::new("grep");
            cmd.arg("-rn").arg("-m").arg(max_results.to_string());
            if context_lines > 0 {
                cmd.arg(format!("-C{}", context_lines));
            }
            if case_insensitive {
                cmd.arg("-i");
            }
            cmd.arg(pattern).arg(path);
            cmd.output().await?
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.is_empty() {
            Ok("No matches found".to_string())
        } else {
            Ok(stdout.to_string())
        }
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "grep".to_string(),
            description: "Search for a regex pattern in files. Uses ripgrep (rg) when available."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search for"
                    },
                    "path": {
                        "type": "string",
                        "default": ".",
                        "description": "Directory or file to search in"
                    },
                    "context_lines": {
                        "type": "integer",
                        "default": 0,
                        "description": "Lines of context to show around matches"
                    },
                    "file_type": {
                        "type": "string",
                        "description": "Filter by file type (e.g. 'rust', 'ts', 'py')"
                    },
                    "case_insensitive": {
                        "type": "boolean",
                        "default": false,
                        "description": "Case insensitive search"
                    },
                    "max_results": {
                        "type": "integer",
                        "default": 50,
                        "description": "Maximum number of results"
                    }
                },
                "required": ["pattern"]
            }),
            needs_approval: false,
        }
    }
}

/// Edit tool — string replacement with Aider-style error feedback.
/// Finds `old_str` in the file and replaces it with `new_str`.
pub struct EditTool {
    workspace_root: SharedWorkspaceRoot,
}

impl EditTool {
    pub fn new(workspace_root: SharedWorkspaceRoot) -> Self {
        Self { workspace_root }
    }

    /// Compute a simple edit-distance score (Levenshtein) between two strings.
    /// Returns a normalised similarity 0.0 .. 1.0.
    fn similarity(a: &str, b: &str) -> f64 {
        let a_len = a.chars().count();
        let b_len = b.chars().count();
        if a_len == 0 && b_len == 0 {
            return 1.0;
        }
        if a_len == 0 || b_len == 0 {
            return 0.0;
        }

        // Simple Levenshtein using two-row approach
        let mut prev: Vec<usize> = (0..=b_len).collect();
        let mut curr = vec![0usize; b_len + 1];

        for (i, ca) in a.chars().enumerate() {
            curr[0] = i + 1;
            for (j, cb) in b.chars().enumerate() {
                let cost = usize::from(ca != cb);
                curr[j + 1] = (prev[j + 1] + 1).min(curr[j] + 1).min(prev[j] + cost);
            }
            std::mem::swap(&mut prev, &mut curr);
        }

        let distance = prev[b_len];
        let max_len = a_len.max(b_len);
        1.0 - (distance as f64 / max_len as f64)
    }

    /// Find the most similar substring of `haystack` that has the same number
    /// of lines as `needle`. Returns (line_number, snippet, similarity).
    fn find_closest_match(haystack: &str, needle: &str) -> Option<(usize, String, f64)> {
        let needle_lines: Vec<&str> = needle.lines().collect();
        let haystack_lines: Vec<&str> = haystack.lines().collect();
        let n = needle_lines.len();

        if n == 0 || haystack_lines.len() < n {
            return None;
        }

        let mut best_score = 0.0f64;
        let mut best_line = 0usize;
        let mut best_snippet = String::new();

        for start in 0..=(haystack_lines.len() - n) {
            let window = &haystack_lines[start..start + n];
            let window_str = window.join("\n");
            let score = Self::similarity(&window_str, needle);
            if score > best_score {
                best_score = score;
                best_line = start + 1; // 1-indexed
                best_snippet = window_str;
            }
        }

        if best_score > 0.5 {
            Some((best_line, best_snippet, best_score))
        } else {
            None
        }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for EditTool {
    async fn execute(&self, args: serde_json::Value) -> ToolResult_ {
        let path_str = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'path' argument".to_string()))?;

        let old_str = args
            .get("old_str")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'old_str' argument".to_string()))?;

        let new_str = args
            .get("new_str")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'new_str' argument".to_string()))?;

        let create_file = args
            .get("create_file")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let ws_root = self.workspace_root.read().await;
        let path = validate_path(path_str, ws_root.as_deref())?;
        drop(ws_root);

        // Handle file creation case (old_str is empty)
        if old_str.is_empty() && create_file {
            if path.exists() {
                return Err(ToolError::ExecutionFailed(format!(
                    "File already exists: {}. Use old_str to specify what to replace.",
                    path.display()
                )));
            }
            // Create parent directories if needed
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&path, new_str).await?;
            return Ok(format!(
                "Created new file: {} ({} bytes)",
                path.display(),
                new_str.len()
            ));
        }

        // Read existing file
        let content = tokio::fs::read_to_string(&path).await.map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to read {}: {}", path.display(), e))
        })?;

        // Find occurrences
        let matches: Vec<usize> = content.match_indices(old_str).map(|(i, _)| i).collect();

        match matches.len() {
            0 => {
                // No exact match — provide Aider-style error feedback
                let mut msg = format!(
                    "Error: No exact match found for the SEARCH block in {}.\n\n\
                     The SEARCH block must exactly match existing code including whitespace.\n",
                    path.display()
                );

                if let Some((line, snippet, score)) = Self::find_closest_match(&content, old_str) {
                    let _ = write!(
                        msg,
                        "\nDid you mean to match these similar lines (starting at line {})? (similarity: {:.0}%)\n\n",
                        line,
                        score * 100.0
                    );
                    for (i, l) in snippet.lines().enumerate() {
                        let _ = writeln!(msg, "    {} | {}", line + i, l);
                    }
                    msg.push_str("\nYour SEARCH block had:\n\n");
                    for l in old_str.lines() {
                        let _ = writeln!(msg, "    {}", l);
                    }
                }

                Err(ToolError::ExecutionFailed(msg))
            }
            1 => {
                // Exactly one match — do the replacement
                let new_content = content.replacen(old_str, new_str, 1);
                tokio::fs::write(&path, &new_content).await?;

                // Find the line range of the change
                let prefix = &content[..matches[0]];
                let start_line = prefix.lines().count() + 1;
                let end_line = start_line + new_str.lines().count().max(1) - 1;

                Ok(format!(
                    "Successfully edited {} (lines {}-{})",
                    path.display(),
                    start_line,
                    end_line
                ))
            }
            n => {
                // Multiple matches — ask user to provide more context
                let mut msg = format!(
                    "Error: Found {} occurrences of the SEARCH block in {}. \
                     Please include more surrounding context to make the match unique.\n\n\
                     Locations found:\n",
                    n,
                    path.display()
                );
                for (idx, &byte_offset) in matches.iter().enumerate().take(5) {
                    let prefix = &content[..byte_offset];
                    let line_num = prefix.lines().count() + 1;
                    // Show a few lines of context
                    let context_start = content[..byte_offset]
                        .rfind('\n')
                        .map(|p| p + 1)
                        .unwrap_or(0);
                    let context_end = content[byte_offset..]
                        .find('\n')
                        .map(|p| byte_offset + p)
                        .unwrap_or(content.len());
                    let context_line = &content[context_start..context_end];
                    let _ = writeln!(
                        msg,
                        "  {}. Line {}: {}",
                        idx + 1,
                        line_num,
                        context_line.chars().take(120).collect::<String>()
                    );
                }
                Err(ToolError::ExecutionFailed(msg))
            }
        }
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "edit".to_string(),
            description: "Edit a file by replacing an exact string match. Provide old_str (the exact text to find) and new_str (the replacement). If old_str is not found, returns the closest matching text to help debug. Set create_file=true with empty old_str to create a new file.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file"
                    },
                    "old_str": {
                        "type": "string",
                        "description": "Exact text to find in the file"
                    },
                    "new_str": {
                        "type": "string",
                        "description": "Replacement text"
                    },
                    "create_file": {
                        "type": "boolean",
                        "default": false,
                        "description": "If true and old_str is empty, create a new file with new_str as content"
                    }
                },
                "required": ["path", "old_str", "new_str"]
            }),
            needs_approval: true,
        }
    }
}

/// Glob tool — find files matching a glob pattern.
pub struct GlobTool {
    workspace_root: SharedWorkspaceRoot,
}

impl GlobTool {
    pub fn new(workspace_root: SharedWorkspaceRoot) -> Self {
        Self { workspace_root }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for GlobTool {
    async fn execute(&self, args: serde_json::Value) -> ToolResult_ {
        let pattern = args
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'pattern' argument".to_string()))?;

        let root = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");

        // Validate root path against workspace_root when set
        let ws_root_guard = self.workspace_root.read().await;
        if let Some(ref ws_root) = *ws_root_guard {
            let root_path = Path::new(root);
            let abs_root = if root_path.is_absolute() {
                root_path.to_path_buf()
            } else {
                std::env::current_dir()
                    .map_err(|e| ToolError::ExecutionFailed(format!("Cannot get cwd: {}", e)))?
                    .join(root_path)
            };
            if let Ok(canon_ws) = ws_root.canonicalize() {
                if abs_root.exists() {
                    let canon_root = abs_root.canonicalize().map_err(|e| {
                        ToolError::PathViolation(format!("Cannot resolve glob root: {}", e))
                    })?;
                    if !canon_root.starts_with(&canon_ws) {
                        return Err(ToolError::PathViolation(format!(
                            "Glob root {} is outside workspace {}",
                            canon_root.display(),
                            canon_ws.display()
                        )));
                    }
                }
            }
        }
        drop(ws_root_guard);

        // Build full pattern
        let full_pattern = if Path::new(pattern).is_absolute() {
            pattern.to_string()
        } else {
            format!("{}/{}", root, pattern)
        };

        let entries = glob::glob(&full_pattern)
            .map_err(|e| ToolError::ExecutionFailed(format!("Invalid glob pattern: {}", e)))?;

        let max_results = 200usize;
        let mut paths: Vec<String> = Vec::new();
        let mut total = 0usize;

        for entry in entries {
            total += 1;
            if paths.len() < max_results {
                match entry {
                    Ok(path) => paths.push(path.display().to_string()),
                    Err(e) => paths.push(format!("(error: {})", e)),
                }
            }
        }

        if paths.is_empty() {
            Ok("No matching files found".to_string())
        } else {
            let mut result = paths.join("\n");
            if total > max_results {
                let _ = write!(
                    result,
                    "\n\n... and {} more (showing first {})",
                    total - max_results,
                    max_results
                );
            }
            Ok(result)
        }
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "glob".to_string(),
            description: "Find files matching a glob pattern (e.g. \"**/*.rs\", \"src/**/*.ts\"). Returns up to 200 matching file paths.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern (e.g. '**/*.rs', 'src/**/*.ts')"
                    },
                    "path": {
                        "type": "string",
                        "default": ".",
                        "description": "Root directory to search from"
                    }
                },
                "required": ["pattern"]
            }),
            needs_approval: false,
        }
    }
}

/// Create a default tool registry with built-in tools.
/// All file-based tools share the registry's workspace root so that
/// calling `registry.set_workspace_root(path)` propagates to every tool.
pub fn create_default_registry() -> ToolRegistry {
    let shared_root: SharedWorkspaceRoot = Arc::new(RwLock::new(None));
    let mut registry = ToolRegistry::with_workspace_root(shared_root.clone());
    registry.register(ReadFileTool::new(shared_root.clone()));
    registry.register(WriteFileTool::new(shared_root.clone()));
    registry.register(EditTool::new(shared_root.clone()));
    registry.register(ListDirectoryTool::new(shared_root.clone()));
    registry.register(GlobTool::new(shared_root));
    registry.register(BashTool::new());
    registry.register(GrepTool);
    registry
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_registry_creation() {
        let registry = create_default_registry();
        assert!(registry.get("read_file").is_some());
        assert!(registry.get("write_file").is_some());
        assert!(registry.get("edit").is_some());
        assert!(registry.get("glob").is_some());
        assert!(registry.get("bash").is_some());
        assert!(registry.get("grep").is_some());
    }

    #[tokio::test]
    async fn test_requires_approval() {
        let registry = create_default_registry();
        assert!(!registry.requires_approval("read_file"));
        assert!(registry.requires_approval("write_file"));
        assert!(registry.requires_approval("edit"));
        assert!(!registry.requires_approval("glob"));
        assert!(registry.requires_approval("bash"));
        assert!(!registry.requires_approval("grep"));
    }

    #[test]
    fn test_path_validation_blocks_system_paths() {
        // /dev always exists on Unix systems
        let result = validate_path("/dev/null", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("blocked"));
    }

    #[test]
    fn test_path_validation_requires_absolute() {
        let result = validate_path("relative/path", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("absolute"));
    }

    #[test]
    fn test_bash_command_validation() {
        let bash = BashTool::new();
        assert!(bash.validate_command("ls -la").is_ok());
        assert!(bash.validate_command("rm -rf /").is_err());
        assert!(bash.validate_command("cat /etc/shadow").is_err());
    }

    #[test]
    fn test_edit_similarity() {
        let score = EditTool::similarity("hello world", "hello world");
        assert!((score - 1.0).abs() < f64::EPSILON);

        let score = EditTool::similarity("hello world", "hello worlD");
        assert!(score > 0.8);

        let score = EditTool::similarity("abc", "xyz");
        assert!(score < 0.5);
    }

    #[test]
    fn test_edit_find_closest_match() {
        let haystack = "fn main() {\n    println!(\"hello\");\n    return 0;\n}\n";
        let needle = "    println!(\"hello\");\n    return 0;";
        let result = EditTool::find_closest_match(haystack, needle);
        assert!(result.is_some());
        let (line, _, score) = result.unwrap();
        assert_eq!(line, 2);
        assert!((score - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_edit_find_closest_match_fuzzy() {
        let haystack = "fn main() {\n    println!(\"hello\");\n    return 0;\n}\n";
        // Slightly different indentation
        let needle = "  println!(\"hello\");\n  return 0;";
        let result = EditTool::find_closest_match(haystack, needle);
        assert!(result.is_some());
        let (line, _, score) = result.unwrap();
        assert_eq!(line, 2);
        assert!(score > 0.7);
    }

    #[tokio::test]
    async fn test_pending_approval_cleanup() {
        let registry = create_default_registry();

        let tool_call = AgentToolCall {
            id: "test-1".to_string(),
            name: "bash".to_string(),
            arguments: "{}".to_string(),
        };

        registry.add_pending_approval(tool_call.clone(), true).await;
        assert!(registry.get_pending("test-1").await.is_some());

        // Approve removes the entry
        let result = registry.approve("test-1").await;
        assert!(result.is_ok());
        assert!(registry.get_pending("test-1").await.is_none());
    }

    #[tokio::test]
    async fn test_reject_removes_pending() {
        let registry = create_default_registry();

        let tool_call = AgentToolCall {
            id: "test-2".to_string(),
            name: "bash".to_string(),
            arguments: "{}".to_string(),
        };

        registry.add_pending_approval(tool_call, true).await;
        let result = registry.reject("test-2").await;
        assert!(result.is_ok());
        assert!(registry.get_pending("test-2").await.is_none());
    }

    #[tokio::test]
    async fn test_read_file_with_line_numbers() {
        // Create a temp file
        let dir = std::env::temp_dir();
        let file_path = dir.join("solo_test_read_lines.txt");
        tokio::fs::write(&file_path, "line1\nline2\nline3\nline4\nline5\n")
            .await
            .unwrap();

        let tool = ReadFileTool::new(Arc::new(RwLock::new(None)));
        let args = serde_json::json!({ "path": file_path.to_str().unwrap() });
        let result = tool.execute(args).await.unwrap();
        assert!(result.contains("1 | line1"));
        assert!(result.contains("5 | line5"));

        // With offset and limit
        let args =
            serde_json::json!({ "path": file_path.to_str().unwrap(), "offset": 2, "limit": 2 });
        let result = tool.execute(args).await.unwrap();
        assert!(result.contains("2 | line2"));
        assert!(result.contains("3 | line3"));
        assert!(!result.contains("line1"));
        assert!(!result.contains("line4"));

        tokio::fs::remove_file(&file_path).await.ok();
    }

    #[tokio::test]
    async fn test_edit_tool_replace() {
        let dir = std::env::temp_dir();
        let file_path = dir.join("solo_test_edit.txt");
        tokio::fs::write(&file_path, "fn main() {\n    println!(\"hello\");\n}\n")
            .await
            .unwrap();

        let tool = EditTool::new(Arc::new(RwLock::new(None)));
        let args = serde_json::json!({
            "path": file_path.to_str().unwrap(),
            "old_str": "    println!(\"hello\");",
            "new_str": "    println!(\"goodbye\");"
        });

        let result = tool.execute(args).await.unwrap();
        assert!(result.contains("Successfully edited"));

        let content = tokio::fs::read_to_string(&file_path).await.unwrap();
        assert!(content.contains("goodbye"));
        assert!(!content.contains("hello"));

        tokio::fs::remove_file(&file_path).await.ok();
    }

    #[tokio::test]
    async fn test_edit_tool_no_match() {
        let dir = std::env::temp_dir();
        let file_path = dir.join("solo_test_edit_nomatch.txt");
        tokio::fs::write(&file_path, "fn main() {\n    println!(\"hello\");\n}\n")
            .await
            .unwrap();

        let tool = EditTool::new(Arc::new(RwLock::new(None)));
        // Use a string that does NOT appear as a substring (typo in function name)
        let args = serde_json::json!({
            "path": file_path.to_str().unwrap(),
            "old_str": "    printlnn!(\"hello\");",
            "new_str": "whatever"
        });

        let result = tool.execute(args).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("No exact match"));
        assert!(err.contains("similar lines"));

        tokio::fs::remove_file(&file_path).await.ok();
    }

    #[tokio::test]
    async fn test_glob_tool() {
        let tool = GlobTool::new(Arc::new(RwLock::new(None)));
        let args = serde_json::json!({
            "pattern": "*.rs",
            "path": env!("CARGO_MANIFEST_DIR").to_string() + "/src"
        });
        let result = tool.execute(args).await.unwrap();
        assert!(result.contains("tools.rs"));
        assert!(result.contains("lib.rs"));
    }
}
