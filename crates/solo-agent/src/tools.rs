//! Tool system for AI agent
//!
//! This module provides infrastructure for registering and executing tools
//! that the AI agent can use. It includes support for tool approval flows
//! and parallel tool execution.

use std::collections::HashMap;
use std::path::Path;
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
fn validate_path(path_str: &str, workspace_root: Option<&Path>) -> Result<std::path::PathBuf, ToolError> {
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
        path.canonicalize().map_err(|e| {
            ToolError::PathViolation(format!("Failed to resolve path: {}", e))
        })?
    } else {
        // For new files, canonicalize the parent directory
        let parent = path.parent().ok_or_else(|| {
            ToolError::PathViolation("Path has no parent directory".to_string())
        })?;
        if !parent.exists() {
            return Err(ToolError::PathViolation(format!(
                "Parent directory does not exist: {}",
                parent.display()
            )));
        }
        let canonical_parent = parent.canonicalize().map_err(|e| {
            ToolError::PathViolation(format!("Failed to resolve parent path: {}", e))
        })?;
        canonical_parent.join(path.file_name().ok_or_else(|| {
            ToolError::PathViolation("Path has no filename".to_string())
        })?)
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
// Tool Context
// =============================================================================

/// Context passed to tool execution, providing workspace scoping.
/// When an agent operates in a worktree, `workspace_root` points to the worktree path.
pub struct ToolContext {
    pub workspace_root: Option<std::path::PathBuf>,
}

impl ToolContext {
    pub fn new(workspace_root: Option<std::path::PathBuf>) -> Self {
        Self { workspace_root }
    }
}

// =============================================================================
// Tool Executor Trait
// =============================================================================

/// Trait for implementing tool execution
#[async_trait::async_trait]
pub trait ToolExecutor: Send + Sync {
    /// Execute the tool with the given arguments and context
    async fn execute(&self, args: serde_json::Value, ctx: &ToolContext) -> ToolResult_;

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

/// Registry of available tools
pub struct ToolRegistry {
    /// Registered tools
    tools: HashMap<String, Arc<dyn ToolExecutor>>,
    /// Pending tool calls awaiting approval (with TTL tracking)
    pending_approvals: RwLock<HashMap<String, PendingEntry>>,
    /// Optional workspace root for path containment
    workspace_root: RwLock<Option<std::path::PathBuf>>,
}

impl ToolRegistry {
    /// Create a new tool registry
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            pending_approvals: RwLock::new(HashMap::new()),
            workspace_root: RwLock::new(None),
        }
    }

    /// Set the workspace root for path validation
    pub async fn set_workspace_root(&self, root: impl Into<std::path::PathBuf>) {
        *self.workspace_root.write().await = Some(root.into());
    }

    /// Get the workspace root
    pub async fn get_workspace_root(&self) -> Option<std::path::PathBuf> {
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
    /// the registry borrow before awaiting execution. Builds a ToolContext from
    /// the registry's workspace_root.
    pub async fn execute(&self, tool_call: &AgentToolCall) -> ToolResult {
        // Clone the Arc<dyn ToolExecutor> so we don't hold any borrow during await
        let executor = self.tools.get(&tool_call.name).cloned();
        let workspace_root = self.workspace_root.read().await.clone();
        let ctx = ToolContext::new(workspace_root);

        match executor {
            Some(executor) => {
                let args: serde_json::Value = serde_json::from_str(&tool_call.arguments)
                    .unwrap_or_else(|_| serde_json::json!({}));

                match executor.execute(args, &ctx).await {
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

/// Read file tool with path validation
pub struct ReadFileTool;

impl ReadFileTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl ToolExecutor for ReadFileTool {
    async fn execute(&self, args: serde_json::Value, ctx: &ToolContext) -> ToolResult_ {
        let path_str = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'path' argument".to_string()))?;

        let path = validate_path(path_str, ctx.workspace_root.as_deref())?;
        let content = tokio::fs::read_to_string(&path).await?;
        Ok(content)
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "read_file".to_string(),
            description: "Read the contents of a file".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file"
                    },
                    "encoding": {
                        "type": "string",
                        "enum": ["utf-8", "base64"],
                        "default": "utf-8",
                        "description": "File encoding"
                    }
                },
                "required": ["path"]
            }),
            needs_approval: false,
        }
    }
}

/// Write file tool with path validation
pub struct WriteFileTool;

impl WriteFileTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl ToolExecutor for WriteFileTool {
    async fn execute(&self, args: serde_json::Value, ctx: &ToolContext) -> ToolResult_ {
        let path_str = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'path' argument".to_string()))?;

        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'content' argument".to_string()))?;

        let path = validate_path(path_str, ctx.workspace_root.as_deref())?;
        tokio::fs::write(&path, content).await?;
        Ok(format!("Successfully wrote {} bytes to {}", content.len(), path.display()))
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
pub struct ListDirectoryTool;

impl ListDirectoryTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl ToolExecutor for ListDirectoryTool {
    async fn execute(&self, args: serde_json::Value, ctx: &ToolContext) -> ToolResult_ {
        let path_str = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'path' argument".to_string()))?;

        let path = validate_path(path_str, ctx.workspace_root.as_deref())?;

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
    async fn execute(&self, args: serde_json::Value, ctx: &ToolContext) -> ToolResult_ {
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

        // Use explicit cwd if provided, otherwise default to workspace root
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        } else if let Some(ref root) = ctx.workspace_root {
            cmd.current_dir(root);
        }

        // Execute with timeout
        let result = tokio::time::timeout(
            Duration::from_millis(timeout_ms),
            cmd.output(),
        )
        .await;

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

/// Grep search tool
pub struct GrepTool;

#[async_trait::async_trait]
impl ToolExecutor for GrepTool {
    async fn execute(&self, args: serde_json::Value, ctx: &ToolContext) -> ToolResult_ {
        let pattern = args
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ExecutionFailed("Missing 'pattern' argument".to_string()))?;

        let arg_path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");

        // Default "." to workspace root when available
        let search_path = if arg_path == "." {
            ctx.workspace_root.as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| ".".to_string())
        } else {
            arg_path.to_string()
        };

        let max_results = args.get("maxResults").and_then(|v| v.as_u64()).unwrap_or(50);

        let output = tokio::process::Command::new("grep")
            .args(["-rn", "--include=*", "-m", &max_results.to_string(), pattern, &search_path])
            .output()
            .await?;

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
            description: "Search for a pattern in files".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search"
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory to search in"
                    },
                    "fileGlob": {
                        "type": "string",
                        "default": "**/*",
                        "description": "File glob pattern"
                    },
                    "maxResults": {
                        "type": "integer",
                        "default": 50,
                        "description": "Maximum results to return"
                    }
                },
                "required": ["pattern"]
            }),
            needs_approval: false,
        }
    }
}

/// Create a default tool registry with built-in tools
pub fn create_default_registry() -> ToolRegistry {
    let mut registry = ToolRegistry::new();
    registry.register(ReadFileTool::new());
    registry.register(WriteFileTool::new());
    registry.register(ListDirectoryTool::new());
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
        assert!(registry.get("bash").is_some());
    }

    #[tokio::test]
    async fn test_requires_approval() {
        let registry = create_default_registry();
        assert!(!registry.requires_approval("read_file"));
        assert!(registry.requires_approval("write_file"));
        assert!(registry.requires_approval("bash"));
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
}
