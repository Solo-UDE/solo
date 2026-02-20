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
use crate::fs_commands::FsState;
use git2::{DiffOptions, Repository};

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
// Commit Message Generation
// ============================================================================

/// Generate an AI commit message from staged changes
#[tauri::command]
pub async fn agent_generate_commit_message(
    fs_state: State<'_, FsState>,
    session_manager: State<'_, Arc<SessionManager>>,
) -> Result<String> {
    let workspace = fs_state
        .workspace_root
        .read()
        .await
        .clone()
        .ok_or("No workspace open")?;

    // Gather staged diff via git2 (spawn_blocking because Repository is !Send)
    let diff_text = tokio::task::spawn_blocking(move || -> result::Result<String, String> {
        let repo = Repository::open(&workspace).map_err(|e| e.to_string())?;
        let head_tree = repo.head().ok().and_then(|r| r.peel_to_tree().ok());
        let mut opts = DiffOptions::new();
        let diff = repo
            .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
            .map_err(|e| e.to_string())?;

        let mut text = String::new();
        diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
            // Cap at 50 KB to avoid huge payloads
            if text.len() < 50_000 {
                if let Ok(content) = std::str::from_utf8(line.content()) {
                    let prefix = match line.origin() {
                        '+' => "+",
                        '-' => "-",
                        ' ' => " ",
                        _ => "",
                    };
                    text.push_str(prefix);
                    text.push_str(content);
                }
            }
            true
        })
        .map_err(|e| e.to_string())?;

        if text.is_empty() {
            return Err("No staged changes to generate a commit message from".to_owned());
        }
        Ok(text)
    })
    .await
    .map_err(|e| e.to_string())??;

    session_manager
        .generate_commit_message(&diff_text)
        .map_err(to_error)
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
            tracing::debug!("[agent:emit] message session={} type={:?}", session_id, message.message_type);
            drop(app_handle.emit(
                "agent:message",
                serde_json::json!({
                    "sessionId": session_id,
                    "message": message,
                }),
            ));
        }
        BridgeEvent::PermissionRequest { request } => {
            tracing::debug!("[agent:emit] permission session={} tool={}", request.session_id, request.tool_name);
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
            tracing::debug!("[agent:emit] session_init session={} sdk_session={:?}", init_event.session_id, init_event.sdk_session_id);
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
            tracing::debug!("[agent:emit] plan_mode_changed session={} enabled={}", session_id, enabled);
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
            tracing::debug!("[agent:emit] accept_mode_changed session={} enabled={}", session_id, enabled);
            drop(app_handle.emit(
                "agent:accept_mode_changed",
                serde_json::json!({
                    "sessionId": session_id,
                    "enabled": enabled,
                }),
            ));
        }
        BridgeEvent::TurnStart {
            session_id,
            turn_number,
        } => {
            tracing::debug!("[agent:emit] turn_start session={} turn={}", session_id, turn_number);
            drop(app_handle.emit(
                "agent:turn_start",
                serde_json::json!({
                    "sessionId": session_id,
                    "turnNumber": turn_number,
                }),
            ));
        }
        BridgeEvent::ErrorEvent { error } => {
            tracing::debug!("[agent:emit] error message={}", error.message);
            drop(app_handle.emit(
                "agent:error",
                serde_json::json!({
                    "message": error.message,
                    "stack": error.stack,
                }),
            ));
        }
        BridgeEvent::DebugEvent {
            session_id,
            event,
        } => {
            tracing::trace!("[agent:emit] debug session={} category={} name={}", session_id, event.category, event.name);
            drop(app_handle.emit(
                "agent:debug",
                serde_json::json!({
                    "sessionId": session_id,
                    "event": event,
                }),
            ));
        }
        BridgeEvent::Ready => {
            tracing::debug!("[agent:emit] ready");
            drop(app_handle.emit("agent:ready", ()));
        }
    }));
}
