//! Agent commands for Claude Agent SDK integration
//!
//! These commands interact with the Node.js sidecar via IPC.
//! The bridge handles all agent logic (agentic loop, tool execution,
//! permissions, streaming) while Rust is a thin process manager.

use std::fmt::Display;
use std::result;
use std::sync::Arc;

use tauri::{AppHandle, Emitter as _, State};

use crate::agent::{
    AttachmentContentBlock, Model, PermissionDecision, PermissionResponse, SessionConfig,
    SessionManager,
};

/// Result type for agent commands
type Result<T> = result::Result<T, String>;

/// Convert bridge error to string
fn to_error<E: Display>(e: E) -> String {
    e.to_string()
}

// ============================================================================
// Session Management Commands
// ============================================================================

/// Create a new agent session
#[tauri::command]
pub async fn agent_create_session(
    session_id: String,
    config: Option<SessionConfig>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state.create_session(&session_id, config).map_err(to_error)
}

/// Delete an agent session
#[tauri::command]
pub async fn agent_delete_session(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state.delete_session(&session_id).map_err(to_error)
}

/// Send a message to an agent session
#[tauri::command]
pub async fn agent_send_message(
    session_id: String,
    message: String,
    attachments: Option<Vec<AttachmentContentBlock>>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state
        .send_message(&session_id, &message, attachments)
        .map_err(to_error)
}

/// Interrupt the current agent execution
#[tauri::command]
pub async fn agent_interrupt(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state.interrupt(&session_id).map_err(to_error)
}

/// Check if a session is ready
#[tauri::command]
pub async fn agent_is_session_ready(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<bool> {
    state.is_session_ready(&session_id).map_err(to_error)
}

/// Get the SDK session ID
#[tauri::command]
pub async fn agent_get_sdk_session_id(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<Option<String>> {
    state.get_sdk_session_id(&session_id).map_err(to_error)
}

// ============================================================================
// Permission Commands
// ============================================================================

/// Respond to a permission request
#[tauri::command]
pub async fn agent_respond_permission(
    request_id: String,
    decision: String,
    always: bool,
    answers: Option<hashbrown::HashMap<String, String>>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let decision = match decision.as_str() {
        "approve" => PermissionDecision::Approve,
        "deny" => PermissionDecision::Deny,
        _ => return Err("Invalid decision: must be 'approve' or 'deny'".to_owned()),
    };

    let response = PermissionResponse {
        request_id,
        decision,
        always,
        answers,
    };

    state.respond_to_permission(response).map_err(to_error)
}

// ============================================================================
// Mode Commands
// ============================================================================

/// Set thinking mode for a session
#[tauri::command]
pub async fn agent_set_thinking_mode(
    session_id: String,
    enabled: bool,
    max_tokens: Option<u32>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state
        .set_thinking_mode(&session_id, enabled, max_tokens)
        .map_err(to_error)
}

/// Get thinking mode for a session
#[tauri::command]
pub async fn agent_get_thinking_mode(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<bool> {
    state.get_thinking_mode(&session_id).map_err(to_error)
}

/// Set model for a session
#[tauri::command]
pub async fn agent_set_model(
    session_id: String,
    model: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let model = match model.as_str() {
        "haiku" => Model::Haiku,
        "sonnet" => Model::Sonnet,
        "opus" => Model::Opus,
        _ => return Err("Invalid model: must be 'haiku', 'sonnet', or 'opus'".to_owned()),
    };

    state.set_model(&session_id, model).map_err(to_error)
}

/// Set plan mode for a session
#[tauri::command]
pub async fn agent_set_plan_mode(
    session_id: String,
    enabled: bool,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state.set_plan_mode(&session_id, enabled).map_err(to_error)
}

/// Get plan mode for a session
#[tauri::command]
pub async fn agent_get_plan_mode(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<bool> {
    state.get_plan_mode(&session_id).map_err(to_error)
}

/// Set accept mode for a session
#[tauri::command]
pub async fn agent_set_accept_mode(
    session_id: String,
    enabled: bool,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state
        .set_accept_mode(&session_id, enabled)
        .map_err(to_error)
}

/// Get accept mode for a session
#[tauri::command]
pub async fn agent_get_accept_mode(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<bool> {
    state.get_accept_mode(&session_id).map_err(to_error)
}

// ============================================================================
// Event Wiring
// ============================================================================

/// Wire up event callbacks to emit Tauri events
pub fn setup_event_callbacks(app: &AppHandle, session_manager: &Arc<SessionManager>) {
    use crate::agent::protocol::BridgeEvent;

    let app_handle = app.clone();

    session_manager.set_event_callback(Arc::new(move |event: BridgeEvent| match event {
        BridgeEvent::AgentMessage {
            session_id,
            message,
        } => {
            drop(app_handle.emit(
                "agent:message",
                serde_json::json!({
                    "sessionId": session_id,
                    "message": message,
                }),
            ));
        }
        BridgeEvent::PermissionRequest { request } => {
            drop(app_handle.emit(
                "agent:permission_request",
                serde_json::json!({
                    "sessionId": request.session_id,
                    "toolName": request.tool_name,
                    "toolInput": request.tool_input,
                    "requestId": request.request_id,
                }),
            ));
        }
        BridgeEvent::SessionInit { event: init_event } => {
            drop(app_handle.emit(
                "agent:session_init",
                serde_json::json!({
                    "sessionId": init_event.session_id,
                    "sdkSessionId": init_event.sdk_session_id,
                    "isResumed": init_event.is_resumed,
                    "isForked": init_event.is_forked,
                }),
            ));
        }
        BridgeEvent::PlanModeChanged {
            session_id,
            enabled,
        } => {
            drop(app_handle.emit(
                "agent:plan_mode_changed",
                serde_json::json!({
                    "sessionId": session_id,
                    "enabled": enabled,
                }),
            ));
        }
        BridgeEvent::AcceptModeChanged {
            session_id,
            enabled,
        } => {
            drop(app_handle.emit(
                "agent:accept_mode_changed",
                serde_json::json!({
                    "sessionId": session_id,
                    "enabled": enabled,
                }),
            ));
        }
        BridgeEvent::ErrorEvent { error } => {
            drop(app_handle.emit(
                "agent:error",
                serde_json::json!({
                    "message": error.message,
                    "stack": error.stack,
                }),
            ));
        }
        BridgeEvent::Ready => {
            drop(app_handle.emit("agent:ready", ()));
        }
    }));
}
