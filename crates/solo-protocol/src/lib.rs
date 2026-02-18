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

/// Status of a tool call
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    /// Tool call is pending approval
    PendingApproval,
    /// Tool call has been approved
    Approved,
    /// Tool call has been rejected
    Rejected,
    /// Tool is currently executing
    Running,
    /// Tool completed successfully
    Completed,
    /// Tool execution failed
    Failed,
}

/// A tool call with its current status and result
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ToolCallWithStatus {
    /// The tool call
    pub tool_call: AgentToolCall,
    /// Current status
    pub status: ToolCallStatus,
    /// Result (if completed)
    pub result: Option<String>,
    /// Error message (if failed)
    pub error: Option<String>,
    /// Whether this tool requires approval
    pub needs_approval: bool,
}

/// Tool definition for registration
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ToolDefinitionProto {
    /// Tool name (unique identifier)
    pub name: String,
    /// Human-readable description
    pub description: String,
    /// JSON Schema for parameters (as JSON string)
    pub parameters: String,
    /// Whether this tool requires user approval
    pub needs_approval: bool,
    /// Tool category for grouping
    pub category: String,
}

/// Result of a tool execution
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ToolResult {
    /// Tool call ID this result is for
    pub tool_call_id: String,
    /// Whether execution succeeded
    pub success: bool,
    /// Result content (for success)
    pub content: Option<String>,
    /// Error message (for failure)
    pub error: Option<String>,
}

/// A content block within a message (supports text, tool use, and tool results)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "type")]
pub enum ContentBlock {
    /// Plain text content
    #[serde(rename = "text")]
    Text { text: String },

    /// A tool use request from the assistant
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        /// JSON-encoded arguments
        arguments: String,
    },

    /// A tool result (sent back to the LLM after execution)
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: bool,
    },
}

/// A message in the conversation
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct AgentMessage {
    /// Message role (user, assistant, system)
    pub role: String,
    /// Structured content blocks
    pub content: Vec<ContentBlock>,
    /// Flattened text for display (computed from text blocks)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

impl AgentMessage {
    /// Create a simple text message
    pub fn text(role: &str, text: &str) -> Self {
        Self {
            role: role.to_string(),
            content: vec![ContentBlock::Text {
                text: text.to_string(),
            }],
            text: Some(text.to_string()),
        }
    }

    /// Create a tool-result message
    pub fn tool_result(tool_use_id: &str, result: &str, is_error: bool) -> Self {
        Self {
            role: "user".to_string(),
            content: vec![ContentBlock::ToolResult {
                tool_use_id: tool_use_id.to_string(),
                content: result.to_string(),
                is_error,
            }],
            text: None,
        }
    }

    /// Create an assistant message with text and tool use blocks
    pub fn assistant_with_tools(text: &str, tool_calls: &[AgentToolCall]) -> Self {
        let mut blocks = Vec::new();
        if !text.is_empty() {
            blocks.push(ContentBlock::Text {
                text: text.to_string(),
            });
        }
        for tc in tool_calls {
            blocks.push(ContentBlock::ToolUse {
                id: tc.id.clone(),
                name: tc.name.clone(),
                arguments: tc.arguments.clone(),
            });
        }
        Self {
            role: "assistant".to_string(),
            content: blocks,
            text: if text.is_empty() {
                None
            } else {
                Some(text.to_string())
            },
        }
    }

    /// Extract plain text from all text content blocks
    pub fn display_text(&self) -> String {
        if let Some(ref t) = self.text {
            return t.clone();
        }
        self.content
            .iter()
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("")
    }

    /// Create a user message with multiple tool results (for multi-tool turns)
    pub fn tool_results(results: Vec<(String, String, bool)>) -> Self {
        let blocks = results
            .into_iter()
            .map(|(id, content, is_error)| ContentBlock::ToolResult {
                tool_use_id: id,
                content,
                is_error,
            })
            .collect();
        Self {
            role: "user".to_string(),
            content: blocks,
            text: None,
        }
    }

    /// Extract tool use blocks as AgentToolCall
    pub fn tool_calls(&self) -> Vec<AgentToolCall> {
        self.content
            .iter()
            .filter_map(|b| match b {
                ContentBlock::ToolUse {
                    id,
                    name,
                    arguments,
                } => Some(AgentToolCall {
                    id: id.clone(),
                    name: name.clone(),
                    arguments: arguments.clone(),
                }),
                _ => None,
            })
            .collect()
    }
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

    /// Agent tool call needs approval
    #[serde(rename = "agent:tool_approval_needed")]
    AgentToolApprovalNeeded {
        conversation_id: String,
        tool_call: ToolCallWithStatus,
    },

    /// Agent tool call approval response
    #[serde(rename = "agent:tool_approval_response")]
    AgentToolApprovalResponse {
        conversation_id: String,
        tool_call_id: String,
        approved: bool,
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

    /// A new turn in the agentic loop is starting
    #[serde(rename = "agent:turn_start")]
    AgentTurnStart {
        conversation_id: String,
        turn_number: u32,
    },

    /// The agentic loop has fully completed (all turns done)
    #[serde(rename = "agent:loop_complete")]
    AgentLoopComplete {
        conversation_id: String,
        total_turns: u32,
    },

    /// The agentic loop was aborted by the user
    #[serde(rename = "agent:aborted")]
    AgentAborted {
        conversation_id: String,
        reason: String,
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
        let msg = AgentMessage::text("assistant", "Hello!");
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("assistant"));
        assert!(json.contains("Hello!"));
    }

    #[test]
    fn test_agent_message_with_tools() {
        let tool_calls = vec![AgentToolCall {
            id: "tc-1".to_string(),
            name: "read_file".to_string(),
            arguments: r#"{"path":"/tmp/test.txt"}"#.to_string(),
        }];
        let msg = AgentMessage::assistant_with_tools("Let me read that file.", &tool_calls);
        assert_eq!(msg.role, "assistant");
        assert_eq!(msg.content.len(), 2); // text + tool_use
        assert_eq!(msg.display_text(), "Let me read that file.");
        assert_eq!(msg.tool_calls().len(), 1);
    }

    #[test]
    fn test_agent_message_tool_result() {
        let msg = AgentMessage::tool_result("tc-1", "file contents here", false);
        assert_eq!(msg.role, "user");
        assert!(msg.tool_calls().is_empty());
    }

    #[test]
    fn test_content_block_serialization() {
        let block = ContentBlock::ToolUse {
            id: "tc-1".to_string(),
            name: "bash".to_string(),
            arguments: r#"{"command":"ls"}"#.to_string(),
        };
        let json = serde_json::to_string(&block).unwrap();
        assert!(json.contains("tool_use"));
        assert!(json.contains("bash"));
    }

    #[test]
    fn test_agent_message_tool_results_multi() {
        let results = vec![
            ("tc-1".to_string(), "result 1".to_string(), false),
            ("tc-2".to_string(), "error msg".to_string(), true),
        ];
        let msg = AgentMessage::tool_results(results);
        assert_eq!(msg.role, "user");
        assert_eq!(msg.content.len(), 2);
        // First is success
        match &msg.content[0] {
            ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                assert_eq!(tool_use_id, "tc-1");
                assert_eq!(content, "result 1");
                assert!(!is_error);
            }
            _ => panic!("Expected ToolResult"),
        }
        // Second is error
        match &msg.content[1] {
            ContentBlock::ToolResult {
                tool_use_id,
                is_error,
                ..
            } => {
                assert_eq!(tool_use_id, "tc-2");
                assert!(is_error);
            }
            _ => panic!("Expected ToolResult"),
        }
    }
}
