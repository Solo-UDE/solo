//! IPC Protocol types for Rust <-> Node.js communication
//!
//! Matches the TypeScript types in agent-bridge/src/protocol.ts

use hashbrown::HashMap;
use serde::{Deserialize, Serialize};

// ============================================================================
// Attachment Types
// ============================================================================

/// Attachment content block for Claude SDK
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentContentBlock {
    #[serde(rename = "type")]
    pub block_type: AttachmentType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<AttachmentSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_end: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentType {
    Document,
    Image,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentSource {
    #[serde(rename = "type")]
    pub source_type: String, // "base64"
    pub media_type: String,
    pub data: String,
}

// ============================================================================
// Session Configuration
// ============================================================================

/// Credentials handed to the sidecar for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SessionCredentials {
    #[serde(rename = "oauth")]
    OAuth {
        token: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        account_id: Option<String>,
    },
    #[serde(rename = "api_key")]
    ApiKey { token: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub chat: bool,
    pub agent: bool,
    pub tools: bool,
    pub mcp: bool,
    pub resume: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPolicyConfig {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allow: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deny: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ask: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bash_allow_prefixes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bypass_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_worktree_session: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultAuthConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retrieval_source: Option<String>,
}

/// Session configuration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_thinking_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accept_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critique_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Output-token cap forwarded to the SDK as CLAUDE_CODE_MAX_OUTPUT_TOKENS.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    /// Explicit per-session tool allow-list. When present, the bridge installs
    /// it as `options.allowedTools` and no other tools are callable. Used by
    /// the Git Agent harness to restrict the model to git operations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_format: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agents: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_policy: Option<ToolPolicyConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_capabilities: Option<ProviderCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_mode: Option<SessionMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fork_session: Option<bool>,
    /// Provider for this session. When absent, defaults to "anthropic" —
    /// preserves backward-compat with clients that don't know about multi-provider.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,

    /// Credentials passed explicitly from Rust to the sidecar. When absent,
    /// the Anthropic adapter falls back to reading ~/.claude/.credentials.json
    /// or ANTHROPIC_API_KEY. The OpenAI adapter REQUIRES this field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credentials: Option<SessionCredentials>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault_auth: Option<VaultAuthConfig>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionMode {
    Chat,
    Agent,
}

// ============================================================================
// Agent Message Types
// ============================================================================

/// Agent message types sent from Node.js to Rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    #[serde(rename = "type")]
    pub message_type: AgentMessageType,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_number: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdk_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ToolMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_output: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_subtype: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentMessageType {
    TurnStart,
    Text,
    Thinking,
    ToolUse,
    ToolResult,
    Result,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<ToolStatus>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ToolStatus {
    AwaitingPermission,
    Running,
    Success,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_input_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_creation_input_tokens: Option<u32>,
}

// ============================================================================
// Permission Types
// ============================================================================

/// Permission request from Node.js
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub session_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub request_id: String,
}

/// Permission response to Node.js
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
    pub request_id: String,
    pub decision: PermissionDecision,
    pub always: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answers: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PermissionDecision {
    Approve,
    Deny,
}

// ============================================================================
// Session Events
// ============================================================================

/// Session initialization event
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInitEvent {
    pub session_id: String,
    pub sdk_session_id: String,
    pub is_resumed: bool,
    pub is_forked: bool,
}

/// Serializable error
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializableError {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
}

// ============================================================================
// Request Types (Rust -> Node.js)
// ============================================================================

/// All possible requests to send to Node.js sidecar
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BridgeRequest {
    CreateSession {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        config: Option<SessionConfig>,
    },
    DeleteSession {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    SendMessage {
        #[serde(rename = "sessionId")]
        session_id: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        attachments: Option<Vec<AttachmentContentBlock>>,
        #[serde(rename = "vaultAuth")]
        #[serde(skip_serializing_if = "Option::is_none")]
        vault_auth: Option<VaultAuthConfig>,
    },
    Interrupt {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    PermissionResponse {
        response: PermissionResponse,
    },
    SetThinkingMode {
        #[serde(rename = "sessionId")]
        session_id: String,
        enabled: bool,
        #[serde(rename = "maxTokens", skip_serializing_if = "Option::is_none")]
        max_tokens: Option<u32>,
    },
    GetThinkingMode {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    SetModel {
        #[serde(rename = "sessionId")]
        session_id: String,
        model: String,
    },
    SetPlanMode {
        #[serde(rename = "sessionId")]
        session_id: String,
        enabled: bool,
    },
    GetPlanMode {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    SetAcceptMode {
        #[serde(rename = "sessionId")]
        session_id: String,
        enabled: bool,
    },
    GetAcceptMode {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    SetDebugMode {
        #[serde(rename = "sessionId")]
        session_id: String,
        enabled: bool,
    },
    GetDebugMode {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    SetToolPolicy {
        #[serde(rename = "sessionId")]
        session_id: String,
        mode: String,
        #[serde(rename = "isWorktreeSession", default)]
        is_worktree_session: bool,
    },
    IsSessionReady {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    GetSdkSessionId {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    GenerateCommitMessage {
        diff: String,
        /// Resolved API key from the credential manager
        #[serde(rename = "apiKey", skip_serializing_if = "Option::is_none")]
        api_key: Option<String>,
    },
    RefineTranscript {
        transcript: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        context: Option<String>,
        #[serde(rename = "apiKey", skip_serializing_if = "Option::is_none")]
        api_key: Option<String>,
    },
    GenerateSessionTitle {
        #[serde(rename = "userMessage")]
        user_message: String,
        #[serde(rename = "assistantMessage")]
        assistant_message: String,
        #[serde(rename = "apiKey", skip_serializing_if = "Option::is_none")]
        api_key: Option<String>,
    },
    Shutdown,
}

// ============================================================================
// Response Types (Node.js -> Rust)
// ============================================================================

/// Command responses from Node.js
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum CommandResponse {
    Success {
        #[serde(rename = "requestType")]
        request_type: String,
    },
    Error {
        #[serde(rename = "requestType")]
        request_type: String,
        error: String,
    },
    Boolean {
        #[serde(rename = "requestType")]
        request_type: String,
        value: bool,
    },
    String {
        #[serde(rename = "requestType")]
        request_type: String,
        value: Option<String>,
    },
}

/// Events from Node.js (unsolicited)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BridgeEvent {
    AgentMessage {
        #[serde(rename = "sessionId")]
        session_id: String,
        message: AgentMessage,
    },
    PermissionRequest {
        request: PermissionRequest,
    },
    SessionInit {
        event: SessionInitEvent,
    },
    PlanModeChanged {
        #[serde(rename = "sessionId")]
        session_id: String,
        enabled: bool,
    },
    AcceptModeChanged {
        #[serde(rename = "sessionId")]
        session_id: String,
        enabled: bool,
    },
    DebugModeChanged {
        #[serde(rename = "sessionId")]
        session_id: String,
        enabled: bool,
    },
    SessionGoalCaptured {
        #[serde(rename = "sessionId")]
        session_id: String,
        goal: String,
        #[serde(rename = "capturedAt")]
        captured_at: i64,
    },
    TurnStart {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "turnNumber")]
        turn_number: u32,
    },
    ErrorEvent {
        error: SerializableError,
    },
    DebugEvent {
        #[serde(rename = "sessionId")]
        session_id: String,
        event: DebugEventData,
    },
    Ready,
}

/// Structured debug event data from the Node.js bridge
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugEventData {
    pub category: String,
    pub name: String,
    pub data: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
}

/// All possible messages from Node.js
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BridgeResponse {
    /// Command response
    Command(CommandResponse),
    /// Event (boxed to reduce enum size)
    Event(Box<BridgeEvent>),
}

impl BridgeResponse {
    /// Check if this is a ready event
    #[must_use]
    pub fn is_ready(&self) -> bool {
        matches!(self, Self::Event(evt) if matches!(**evt, BridgeEvent::Ready))
    }

    /// Try to get as command response
    #[must_use]
    pub fn as_command(&self) -> Option<&CommandResponse> {
        match self {
            Self::Command(cmd) => Some(cmd),
            Self::Event(_) => None,
        }
    }

    /// Try to get as event
    #[must_use]
    pub fn as_event(&self) -> Option<&BridgeEvent> {
        match self {
            Self::Command(_) => None,
            Self::Event(evt) => Some(evt),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ready_event_deser() {
        let json = r#"{"type":"ready"}"#;
        let result: Result<BridgeResponse, _> = serde_json::from_str(json);
        println!("Ready parse result: {result:?}");
        let resp = result.expect("should parse ready event");
        assert!(resp.is_ready(), "should be ready event");
    }

    #[test]
    fn test_success_response_deser() {
        let json = r#"{"type":"success","requestType":"create_session"}"#;
        let result: Result<BridgeResponse, _> = serde_json::from_str(json);
        println!("Success parse result: {result:?}");
        let resp = result.expect("should parse success response");
        assert!(resp.as_command().is_some(), "should be command response");
    }

    #[test]
    fn test_agent_message_deser() {
        let json = r#"{"type":"agent_message","sessionId":"test-123","message":{"type":"text","content":"Hello"}}"#;
        let result: Result<BridgeResponse, _> = serde_json::from_str(json);
        println!("AgentMessage parse result: {result:?}");
        let resp = result.expect("should parse agent message event");
        assert!(resp.as_event().is_some(), "should be event");
    }

    #[test]
    fn test_expanded_session_config_roundtrip() {
        let json = r#"{
            "cwd":"/tmp/project",
            "provider":"anthropic",
            "providerCapabilities":{"chat":true,"agent":true,"tools":true,"mcp":true,"resume":true},
            "sessionMode":"agent",
            "selectedSkills":["ui"],
            "mcpServers":{"example":{"command":"node","args":["server.js"]}},
            "outputFormat":{"type":"json_schema","schema":{"type":"object"}},
            "agents":{"reviewer":{"description":"Review code"}},
            "toolPolicy":{"deny":["Bash(git reset --hard*)"],"bashAllowPrefixes":["git "]},
            "permissionMode":"plan"
        }"#;

        let config: SessionConfig = serde_json::from_str(json).expect("config should parse");
        assert_eq!(config.provider.as_deref(), Some("anthropic"));
        assert_eq!(config.session_mode, Some(SessionMode::Agent));
        assert_eq!(
            config.selected_skills.as_deref(),
            Some(&["ui".to_string()][..])
        );
        assert_eq!(
            config
                .provider_capabilities
                .as_ref()
                .map(|capabilities| capabilities.agent),
            Some(true)
        );
        assert_eq!(
            config
                .tool_policy
                .as_ref()
                .map(|policy| policy.bash_allow_prefixes.as_slice()),
            Some(&["git ".to_string()][..])
        );

        let value = serde_json::to_value(config).expect("config should serialize");
        assert_eq!(value["provider"], "anthropic");
        assert_eq!(value["selectedSkills"][0], "ui");
        assert_eq!(value["permissionMode"], "plan");
    }

    #[test]
    fn test_tool_result_message_with_runtime_metadata_deser() {
        let json = r#"{
            "type":"agent_message",
            "sessionId":"test-123",
            "message":{
                "type":"tool_result",
                "content":"ok",
                "eventId":"evt-1",
                "turnNumber":2,
                "sdkSessionId":"sdk-1",
                "metadata":{"toolName":"Read","toolId":"tool-1","toolOutput":"contents","status":"success"}
            }
        }"#;

        let resp: BridgeResponse = serde_json::from_str(json).expect("message should parse");
        match resp.as_event().expect("event") {
            BridgeEvent::AgentMessage {
                session_id,
                message,
            } => {
                assert_eq!(session_id, "test-123");
                assert_eq!(message.message_type, AgentMessageType::ToolResult);
                assert_eq!(message.event_id.as_deref(), Some("evt-1"));
                assert_eq!(message.turn_number, Some(2));
                assert_eq!(message.sdk_session_id.as_deref(), Some("sdk-1"));
                assert_eq!(
                    message
                        .metadata
                        .as_ref()
                        .and_then(|m| m.tool_name.as_deref()),
                    Some("Read")
                );
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }
}
