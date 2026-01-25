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
    /// Children (for directories)
    pub children: Option<Vec<FileTreeEntry>>,
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
