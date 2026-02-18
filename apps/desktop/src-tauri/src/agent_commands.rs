//! Agent command handlers for Solo IDE
//!
//! This module contains all AI agent related IPC commands,
//! including the agentic loop that executes tool calls and
//! feeds results back to the LLM.

use crate::fs_commands::FsState;
use solo_agent::{
    build_system_prompt,
    models::{get_all_models, get_models_for_provider},
    oauth::{
        start_callback_server, AnthropicOAuthConfig, AuthMethodInfo, OAuthFlowResult, OAuthMethod,
        OAuthState, OpenAIOAuthConfig,
    },
    AgentManager, CredentialManager, ProviderType,
};
use solo_protocol::{
    AgentMessage, AgentToolCall, BackendEvent, ToolCallStatus, ToolCallWithStatus, ToolResult,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{oneshot, watch, RwLock};
use tracing::{debug, error, info, warn};

/// Maximum number of agentic loop turns before stopping
const MAX_AGENTIC_TURNS: u32 = 25;
/// Timeout for tool approval (5 minutes)
const TOOL_APPROVAL_TIMEOUT_SECS: u64 = 300;
/// Maximum size of tool result before compression (50KB)
const MAX_TOOL_RESULT_BYTES: usize = 50_000;

// =============================================================================
// State
// =============================================================================

/// Application state for agent operations
pub struct AgentState {
    /// Agent manager for handling sessions and providers
    pub manager: Arc<AgentManager>,
    /// Credential manager
    pub credentials: Arc<CredentialManager>,
    /// Pending OAuth flows (state -> OAuthState)
    pub oauth_pending: RwLock<HashMap<String, OAuthState>>,
    /// Abort senders per session — send `true` to cancel a running loop
    abort_senders: Arc<RwLock<HashMap<String, watch::Sender<bool>>>>,
    /// Approval channels for tool calls inside the agentic loop.
    /// When a tool needs approval the loop inserts the full tool call and a
    /// oneshot::Sender here; the approve/reject commands resolve it.
    loop_approvals: Arc<RwLock<HashMap<String, (AgentToolCall, oneshot::Sender<bool>)>>>,
}

impl AgentState {
    pub fn new() -> Self {
        let credentials = Arc::new(CredentialManager::new());
        let manager = Arc::new(AgentManager::new(credentials.clone()));
        Self {
            manager,
            credentials,
            oauth_pending: RwLock::new(HashMap::new()),
            abort_senders: Arc::new(RwLock::new(HashMap::new())),
            loop_approvals: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl Default for AgentState {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Helper types
// =============================================================================

/// Provider status for frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderStatusResponse {
    pub provider: ProviderType,
    pub has_credentials: bool,
    pub credential_source: Option<String>,
    pub is_active: bool,
}

/// Model info for frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelInfoResponse {
    pub id: String,
    pub display_name: String,
    pub alias: String,
    pub provider: ProviderType,
    pub is_default: bool,
    pub description: String,
    pub context_window: u32,
}

/// Tool definition response for frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolDefinitionResponse {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
    pub needs_approval: bool,
}

// =============================================================================
// Tool result compression
// =============================================================================

/// Find the largest byte index <= `pos` that lies on a UTF-8 char boundary.
fn floor_char_boundary(s: &str, pos: usize) -> usize {
    if pos >= s.len() {
        return s.len();
    }
    let mut i = pos;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Find the smallest byte index >= `pos` that lies on a UTF-8 char boundary.
fn ceil_char_boundary(s: &str, pos: usize) -> usize {
    if pos >= s.len() {
        return s.len();
    }
    let mut i = pos;
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

/// Compress a tool result if it exceeds `max_bytes`.
/// Keeps the first 40 % and last 40 % of the content, replacing the middle
/// with a truncation notice. Splits on UTF-8 char boundaries to avoid panics.
fn compress_tool_result(output: &str, max_bytes: usize) -> String {
    if output.len() <= max_bytes {
        return output.to_string();
    }
    let keep = max_bytes * 2 / 5;
    let head_end = floor_char_boundary(output, keep);
    let tail_start = ceil_char_boundary(output, output.len().saturating_sub(keep));
    format!(
        "{}...\n[truncated {} bytes]\n...{}",
        &output[..head_end],
        output.len() - max_bytes,
        &output[tail_start..]
    )
}

// =============================================================================
// Agentic Loop
// =============================================================================

/// Core agentic loop — consumes streaming events from the LLM, executes tool
/// calls, feeds results back, and repeats until the LLM stops requesting tools
/// or the maximum turn count is reached.
async fn run_agentic_loop(
    manager: Arc<AgentManager>,
    app: AppHandle,
    session_id: String,
    system_prompt: Option<String>,
    initial_receiver: tokio::sync::mpsc::Receiver<BackendEvent>,
    mut abort_rx: watch::Receiver<bool>,
    loop_approvals: Arc<RwLock<HashMap<String, (AgentToolCall, oneshot::Sender<bool>)>>>,
    max_turns: u32,
) {
    let mut receiver = initial_receiver;
    let mut turn = 0u32;

    loop {
        turn += 1;

        // ── guard: max turns ────────────────────────────────────────────
        if turn > max_turns {
            warn!(session_id = %session_id, max_turns, "Agentic loop reached max turns");
            let _ = app.emit(
                "agent-event",
                &BackendEvent::AgentError {
                    conversation_id: session_id.clone(),
                    error: format!("Reached maximum turn limit ({})", max_turns),
                },
            );
            let _ = app.emit(
                "agent-event",
                &BackendEvent::AgentLoopComplete {
                    conversation_id: session_id.clone(),
                    total_turns: turn - 1,
                },
            );
            break;
        }

        // ── guard: abort ────────────────────────────────────────────────
        if *abort_rx.borrow() {
            info!(session_id = %session_id, turn, "Agentic loop aborted before turn");
            let _ = app.emit(
                "agent-event",
                &BackendEvent::AgentAborted {
                    conversation_id: session_id.clone(),
                    reason: "User cancelled".to_string(),
                },
            );
            break;
        }

        // ── emit turn start ─────────────────────────────────────────────
        let _ = app.emit(
            "agent-event",
            &BackendEvent::AgentTurnStart {
                conversation_id: session_id.clone(),
                turn_number: turn,
            },
        );

        info!(session_id = %session_id, turn, "Agentic loop turn start");

        // ── consume streaming events from the LLM ───────────────────────
        let mut accumulated_text = String::new();
        let mut tool_calls: Vec<AgentToolCall> = Vec::new();

        while let Some(event) = receiver.recv().await {
            // Check abort between events
            if *abort_rx.borrow() {
                info!(session_id = %session_id, turn, "Agentic loop aborted during streaming");
                let _ = app.emit(
                    "agent-event",
                    &BackendEvent::AgentAborted {
                        conversation_id: session_id.clone(),
                        reason: "User cancelled".to_string(),
                    },
                );
                return;
            }

            match &event {
                BackendEvent::AgentChunk { content, .. } => {
                    accumulated_text.push_str(content);
                    let _ = app.emit("agent-event", &event);
                }
                BackendEvent::AgentToolStart { tool_call, .. } => {
                    tool_calls.push(tool_call.clone());
                    let _ = app.emit("agent-event", &event);
                }
                BackendEvent::AgentComplete { .. } => {
                    // Forward so the frontend knows this turn's LLM response ended.
                    let _ = app.emit("agent-event", &event);
                }
                BackendEvent::AgentError { .. } => {
                    // Forward the error and terminate the loop.
                    let _ = app.emit("agent-event", &event);
                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentLoopComplete {
                            conversation_id: session_id.clone(),
                            total_turns: turn,
                        },
                    );
                    return;
                }
                _ => {
                    let _ = app.emit("agent-event", &event);
                }
            }
        }

        // ── no tool calls → loop is done ────────────────────────────────
        if tool_calls.is_empty() {
            info!(session_id = %session_id, turn, text_len = accumulated_text.len(), "Agentic loop complete (no tool calls)");
            let _ = app.emit(
                "agent-event",
                &BackendEvent::AgentLoopComplete {
                    conversation_id: session_id.clone(),
                    total_turns: turn,
                },
            );
            break;
        }

        // ── add assistant message (text + tool uses) to history ─────────
        info!(
            session_id = %session_id, turn,
            tool_count = tool_calls.len(),
            "Adding assistant message with tool calls to history"
        );
        if let Err(e) = manager
            .add_message_to_session(
                &session_id,
                AgentMessage::assistant_with_tools(&accumulated_text, &tool_calls),
            )
            .await
        {
            error!(session_id = %session_id, error = %e, "Failed to add assistant message to history");
        }

        // ── execute each tool call ──────────────────────────────────────
        let mut tool_results: Vec<(String, String, bool)> = Vec::new();

        for tool_call in &tool_calls {
            // Check abort before each tool
            if *abort_rx.borrow() {
                info!(session_id = %session_id, turn, "Agentic loop aborted before tool execution");
                let _ = app.emit(
                    "agent-event",
                    &BackendEvent::AgentAborted {
                        conversation_id: session_id.clone(),
                        reason: "User cancelled".to_string(),
                    },
                );
                return;
            }

            let needs_approval = manager.tool_requires_approval(&tool_call.name).await;

            // ── approval gate ───────────────────────────────────────────
            if needs_approval {
                info!(session_id = %session_id, tool = %tool_call.name, id = %tool_call.id, "Tool requires approval");

                let _ = app.emit(
                    "agent-event",
                    &BackendEvent::AgentToolApprovalNeeded {
                        conversation_id: session_id.clone(),
                        tool_call: ToolCallWithStatus {
                            tool_call: tool_call.clone(),
                            status: ToolCallStatus::PendingApproval,
                            result: None,
                            error: None,
                            needs_approval: true,
                        },
                    },
                );

                // Create oneshot for the approve/reject commands to resolve
                let (approval_tx, approval_rx) = oneshot::channel();
                loop_approvals
                    .write()
                    .await
                    .insert(tool_call.id.clone(), (tool_call.clone(), approval_tx));

                // Wait for approval, timeout, or abort
                let approved = tokio::select! {
                    result = approval_rx => result.unwrap_or(false),
                    _ = tokio::time::sleep(Duration::from_secs(TOOL_APPROVAL_TIMEOUT_SECS)) => {
                        warn!(session_id = %session_id, tool_id = %tool_call.id, "Tool approval timed out");
                        loop_approvals.write().await.remove(&tool_call.id);
                        false
                    }
                    _ = abort_rx.changed() => {
                        info!(session_id = %session_id, "Abort received during tool approval wait");
                        loop_approvals.write().await.remove(&tool_call.id);
                        false
                    }
                };

                // If abort happened during approval wait, terminate
                if *abort_rx.borrow() {
                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentAborted {
                            conversation_id: session_id.clone(),
                            reason: "User cancelled".to_string(),
                        },
                    );
                    return;
                }

                if !approved {
                    info!(session_id = %session_id, tool = %tool_call.name, "Tool call rejected");
                    let reject_msg = "Tool call was rejected by user".to_string();
                    tool_results.push((tool_call.id.clone(), reject_msg.clone(), true));

                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentToolEnd {
                            conversation_id: session_id.clone(),
                            tool_call_id: tool_call.id.clone(),
                            result: reject_msg,
                        },
                    );
                    continue;
                }
            }

            // ── execute the tool ────────────────────────────────────────
            info!(session_id = %session_id, tool = %tool_call.name, id = %tool_call.id, "Executing tool");
            let result = manager.execute_tool(tool_call).await;

            let (result_text, is_error) = if result.success {
                (
                    compress_tool_result(
                        &result.content.unwrap_or_default(),
                        MAX_TOOL_RESULT_BYTES,
                    ),
                    false,
                )
            } else {
                (
                    result.error.unwrap_or_else(|| "Unknown error".to_string()),
                    true,
                )
            };

            tool_results.push((tool_call.id.clone(), result_text.clone(), is_error));

            let _ = app.emit(
                "agent-event",
                &BackendEvent::AgentToolEnd {
                    conversation_id: session_id.clone(),
                    tool_call_id: tool_call.id.clone(),
                    result: result_text,
                },
            );
        }

        // ── add all tool results as a single user message ───────────────
        if let Err(e) = manager
            .add_message_to_session(&session_id, AgentMessage::tool_results(tool_results))
            .await
        {
            error!(session_id = %session_id, error = %e, "Failed to add tool results to history");
        }

        // ── continue conversation (next turn) ──────────────────────────
        match manager
            .continue_session(&session_id, system_prompt.clone())
            .await
        {
            Ok(new_receiver) => {
                receiver = new_receiver;
            }
            Err(e) => {
                error!(session_id = %session_id, error = %e, "Failed to continue conversation");
                let _ = app.emit(
                    "agent-event",
                    &BackendEvent::AgentError {
                        conversation_id: session_id.clone(),
                        error: format!("Failed to continue conversation: {}", e),
                    },
                );
                let _ = app.emit(
                    "agent-event",
                    &BackendEvent::AgentLoopComplete {
                        conversation_id: session_id.clone(),
                        total_turns: turn,
                    },
                );
                return;
            }
        }
    }
}

// =============================================================================
// Provider Management Commands
// =============================================================================

/// Get list of available providers
#[tauri::command]
pub async fn get_providers() -> Result<Vec<String>, String> {
    debug!("Getting available providers");
    Ok(vec![
        "anthropic".to_string(),
        "openai".to_string(),
        "gemini".to_string(),
    ])
}

/// Get the currently active provider
#[tauri::command]
pub async fn get_active_provider(state: State<'_, AgentState>) -> Result<String, String> {
    debug!("Getting active provider");
    let provider = state.manager.get_active_provider().await;
    Ok(provider.as_str().to_string())
}

/// Set the active provider
#[tauri::command]
pub async fn set_active_provider(
    provider: String,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(provider = %provider, "Setting active provider");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    state
        .manager
        .set_active_provider(provider_type)
        .await
        .map_err(|e| e.to_string())
}

/// Get status for a specific provider
#[tauri::command]
pub async fn get_provider_status(
    provider: String,
    state: State<'_, AgentState>,
) -> Result<ProviderStatusResponse, String> {
    debug!(provider = %provider, "Getting provider status");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    let has_credentials = state.credentials.has_credentials(provider_type).await;

    let credential_source = if has_credentials {
        state
            .credentials
            .get_credential_source(provider_type)
            .await
            .ok()
            .flatten()
            .map(|s| s.to_string())
    } else {
        None
    };

    let active_provider = state.manager.get_active_provider().await;

    Ok(ProviderStatusResponse {
        provider: provider_type,
        has_credentials,
        credential_source,
        is_active: active_provider == provider_type,
    })
}

/// Set credentials for a provider
#[tauri::command]
pub async fn set_credentials(
    provider: String,
    api_key: String,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(provider = %provider, "Setting credentials");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    state
        .credentials
        .set_credentials(provider_type, &api_key)
        .await
        .map_err(|e| e.to_string())?;

    // Initialize the provider with the new credentials
    state
        .manager
        .initialize_provider(provider_type)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Check if credentials exist for a provider
#[tauri::command]
pub async fn has_credentials(
    provider: String,
    state: State<'_, AgentState>,
) -> Result<bool, String> {
    debug!(provider = %provider, "Checking credentials");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    Ok(state.credentials.has_credentials(provider_type).await)
}

// =============================================================================
// Model Commands
// =============================================================================

/// Get all available models
#[tauri::command]
pub async fn get_models() -> Result<Vec<ModelInfoResponse>, String> {
    debug!("Getting all models");

    let models = get_all_models();

    Ok(models
        .into_iter()
        .map(|m| ModelInfoResponse {
            id: m.id.clone(),
            display_name: m.display_name.clone(),
            alias: m.alias.clone(),
            provider: m.provider,
            is_default: m.is_default,
            description: m.description.clone(),
            context_window: m.capabilities.context_window,
        })
        .collect())
}

/// Get models for a specific provider
#[tauri::command]
pub async fn get_models_for_provider_cmd(
    provider: String,
) -> Result<Vec<ModelInfoResponse>, String> {
    debug!(provider = %provider, "Getting models for provider");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    let models = get_models_for_provider(provider_type);

    Ok(models
        .iter()
        .map(|m| ModelInfoResponse {
            id: m.id.clone(),
            display_name: m.display_name.clone(),
            alias: m.alias.clone(),
            provider: m.provider,
            is_default: m.is_default,
            description: m.description.clone(),
            context_window: m.capabilities.context_window,
        })
        .collect())
}

// =============================================================================
// Session Commands
// =============================================================================

/// Create a new agent session
#[tauri::command]
pub async fn agent_create_session(
    model: Option<String>,
    state: State<'_, AgentState>,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();

    info!(session_id = %session_id, model = ?model, "Creating agent session");

    // Get the active provider type
    let provider_type = state.manager.get_active_provider().await;

    // Auto-initialize provider if it has credentials but isn't initialized yet
    if !state.manager.is_provider_initialized(provider_type).await {
        if state.credentials.has_credentials(provider_type).await {
            info!(provider = %provider_type.as_str(), "Auto-initializing provider with existing credentials");
            state
                .manager
                .initialize_provider(provider_type)
                .await
                .map_err(|e| e.to_string())?;
        } else {
            return Err(format!(
                "No credentials found for {}. Please add an API key.",
                provider_type.display_name()
            ));
        }
    }

    state
        .manager
        .create_session(session_id.clone(), model)
        .await
        .map_err(|e| e.to_string())?;

    Ok(session_id)
}

/// Update the model for an existing session
#[tauri::command]
pub async fn agent_update_session_model(
    session_id: String,
    model: String,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(session_id = %session_id, model = %model, "Updating session model");
    state
        .manager
        .update_session_model(&session_id, model)
        .await
        .map_err(|e| e.to_string())
}

/// Send a message to the agent and run the full agentic loop.
///
/// The loop streams the LLM response, executes any tool calls, feeds results
/// back to the LLM, and repeats until the LLM produces a response with no
/// tool calls or the maximum turn count is reached.
#[tauri::command]
pub async fn agent_send_message(
    session_id: String,
    content: String,
    system_prompt: Option<String>,
    app: AppHandle,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(session_id = %session_id, content_len = content.len(), "Sending message to agent (agentic loop)");

    // Abort any existing loop for this session
    if let Some(old_sender) = state.abort_senders.write().await.remove(&session_id) {
        let _ = old_sender.send(true);
        info!(session_id = %session_id, "Aborted previous loop for session");
    }

    // Read workspace root from FsState for tool sandboxing
    let fs_state = app.state::<FsState>();
    let workspace_root = fs_state.workspace_root.read().await.clone();

    // Set workspace root on tool registry so file tools enforce path containment
    if let Some(ref root) = workspace_root {
        let registry = state.manager.tool_registry();
        registry.read().await.set_workspace_root(root.clone()).await;
        info!(workspace_root = %root.display(), "Tool registry workspace root set");
    }

    // Build system prompt: use provided one, or generate a default from tool definitions
    let effective_prompt = if system_prompt.is_some() {
        system_prompt
    } else {
        let tools = state.manager.get_tool_definitions().await;
        let ws_root = workspace_root
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string());
        Some(build_system_prompt(&tools, &ws_root))
    };

    // Get the streaming receiver for the initial user message
    let receiver = state
        .manager
        .send_message(&session_id, content, effective_prompt.clone())
        .await
        .map_err(|e| {
            error!(error = %e, session_id = %session_id, "Failed to send message");
            e.to_string()
        })?;

    // Set up abort channel
    let (abort_tx, abort_rx) = watch::channel(false);
    state
        .abort_senders
        .write()
        .await
        .insert(session_id.clone(), abort_tx);

    let manager = state.manager.clone();
    let loop_approvals = state.loop_approvals.clone();
    let abort_senders = state.abort_senders.clone();
    let sid = session_id.clone();

    // Spawn the agentic loop
    tokio::spawn(async move {
        run_agentic_loop(
            manager,
            app,
            sid.clone(),
            effective_prompt,
            receiver,
            abort_rx,
            loop_approvals,
            MAX_AGENTIC_TURNS,
        )
        .await;

        // Clean up the abort sender for this session
        abort_senders.write().await.remove(&sid);
        info!(session_id = %sid, "Agentic loop task finished");
    });

    Ok(())
}

/// Abort a running agentic loop for a session
#[tauri::command]
pub async fn agent_abort_session(
    session_id: String,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(session_id = %session_id, "Aborting agent session");

    if let Some(sender) = state.abort_senders.write().await.remove(&session_id) {
        let _ = sender.send(true);
    }
    Ok(())
}

/// Get conversation history for a session
#[tauri::command]
pub async fn agent_get_history(
    session_id: String,
    state: State<'_, AgentState>,
) -> Result<Vec<AgentMessage>, String> {
    debug!(session_id = %session_id, "Getting conversation history");

    let sessions = state
        .manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    Ok(session.history().to_vec())
}

/// Clear conversation history for a session
#[tauri::command]
pub async fn agent_clear_history(
    session_id: String,
    _state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(session_id = %session_id, "Clearing conversation history");

    // Note: This requires mutable access to the session
    // For now, we'll return an error since the current API doesn't support this well
    // TODO: Add a method to AgentManager to clear a session's history
    Err("Clear history not yet implemented".to_string())
}

// =============================================================================
// Tool Commands
// =============================================================================

/// Get all available tools
#[tauri::command]
pub async fn get_tools(
    state: State<'_, AgentState>,
) -> Result<Vec<ToolDefinitionResponse>, String> {
    debug!("Getting all tools");

    let tools = state.manager.get_tool_definitions().await;

    Ok(tools
        .into_iter()
        .map(|t| ToolDefinitionResponse {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
            needs_approval: t.needs_approval,
        })
        .collect())
}

/// Execute a tool call (manual, outside the loop)
#[tauri::command]
pub async fn execute_tool(
    tool_name: String,
    args: serde_json::Value,
    state: State<'_, AgentState>,
) -> Result<ToolResult, String> {
    info!(tool_name = %tool_name, "Executing tool");

    let tool_call = AgentToolCall {
        id: uuid::Uuid::new_v4().to_string(),
        name: tool_name,
        arguments: serde_json::to_string(&args).unwrap_or_default(),
    };

    let result = state.manager.execute_tool(&tool_call).await;
    Ok(result)
}

/// Approve a pending tool call.
///
/// First checks if the tool call is waiting in the agentic loop (via oneshot
/// channel). Falls back to the registry-based approval if not found.
#[tauri::command]
pub async fn approve_tool_call(
    tool_call_id: String,
    state: State<'_, AgentState>,
) -> Result<ToolCallWithStatus, String> {
    info!(tool_call_id = %tool_call_id, "Approving tool call");

    // Check if there's a loop approval channel for this tool call
    if let Some((original_tool_call, sender)) =
        state.loop_approvals.write().await.remove(&tool_call_id)
    {
        let _ = sender.send(true);
        return Ok(ToolCallWithStatus {
            tool_call: original_tool_call,
            status: ToolCallStatus::Approved,
            result: None,
            error: None,
            needs_approval: true,
        });
    }

    // Fall back to registry-based approval
    state
        .manager
        .approve_tool_call(&tool_call_id)
        .await
        .map_err(|e| e.to_string())
}

/// Reject a pending tool call.
///
/// First checks the agentic loop approval channel, then falls back to
/// registry-based rejection.
#[tauri::command]
pub async fn reject_tool_call(
    tool_call_id: String,
    state: State<'_, AgentState>,
) -> Result<ToolCallWithStatus, String> {
    info!(tool_call_id = %tool_call_id, "Rejecting tool call");

    // Check if there's a loop approval channel for this tool call
    if let Some((original_tool_call, sender)) =
        state.loop_approvals.write().await.remove(&tool_call_id)
    {
        let _ = sender.send(false);
        return Ok(ToolCallWithStatus {
            tool_call: original_tool_call,
            status: ToolCallStatus::Rejected,
            result: None,
            error: None,
            needs_approval: true,
        });
    }

    // Fall back to registry-based rejection
    state
        .manager
        .reject_tool_call(&tool_call_id)
        .await
        .map_err(|e| e.to_string())
}

/// Check if a tool requires approval
#[tauri::command]
pub async fn tool_requires_approval(
    tool_name: String,
    state: State<'_, AgentState>,
) -> Result<bool, String> {
    debug!(tool_name = %tool_name, "Checking if tool requires approval");

    Ok(state.manager.tool_requires_approval(&tool_name).await)
}

// =============================================================================
// Auth Method Commands
// =============================================================================

/// Get authentication method info for a provider
#[tauri::command]
pub async fn get_auth_method(
    provider: String,
    state: State<'_, AgentState>,
) -> Result<AuthMethodInfo, String> {
    debug!(provider = %provider, "Getting auth method info");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    state
        .credentials
        .get_auth_method_info(provider_type)
        .await
        .map_err(|e| e.to_string())
}

// =============================================================================
// OAuth Commands
// =============================================================================

/// Start an OAuth flow for a provider
#[tauri::command]
pub async fn start_oauth_flow(
    provider: String,
    _method: OAuthMethod,
    state: State<'_, AgentState>,
) -> Result<OAuthFlowResult, String> {
    info!(provider = %provider, "Starting OAuth flow");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    let (result, oauth_state) = match provider_type {
        ProviderType::Anthropic => {
            AnthropicOAuthConfig::build_auth_url().map_err(|e| e.to_string())?
        }
        ProviderType::OpenAI => OpenAIOAuthConfig::build_auth_url().map_err(|e| e.to_string())?,
        ProviderType::Gemini => {
            return Err("Gemini does not support OAuth".to_string());
        }
    };

    // Store the OAuth state for later verification
    state
        .oauth_pending
        .write()
        .await
        .insert(oauth_state.state.clone(), oauth_state);

    Ok(result)
}

/// Complete an OAuth flow with the authorization code
#[tauri::command]
pub async fn complete_oauth_flow(
    code: String,
    oauth_state: String,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!("Completing OAuth flow");

    // Look up the pending OAuth state
    let pending_state = state
        .oauth_pending
        .write()
        .await
        .remove(&oauth_state)
        .ok_or_else(|| "OAuth state not found or expired".to_string())?;

    if pending_state.is_expired() {
        return Err("OAuth state has expired".to_string());
    }

    let provider_type = ProviderType::from_str(&pending_state.provider)
        .ok_or_else(|| format!("Unknown provider: {}", pending_state.provider))?;

    match provider_type {
        ProviderType::Anthropic => {
            let token = AnthropicOAuthConfig::exchange_code(&code, &pending_state.code_verifier)
                .await
                .map_err(|e| e.to_string())?;

            state
                .credentials
                .set_oauth_token(provider_type, token)
                .await
                .map_err(|e| e.to_string())?;
        }
        ProviderType::OpenAI => {
            let token = OpenAIOAuthConfig::exchange_code(&code, &pending_state.code_verifier)
                .await
                .map_err(|e| e.to_string())?;

            state
                .credentials
                .set_openai_oauth_token(token)
                .await
                .map_err(|e| e.to_string())?;
        }
        ProviderType::Gemini => {
            return Err("Gemini does not support OAuth".to_string());
        }
    }

    // Re-initialize the provider with the new credentials
    state
        .manager
        .initialize_provider(provider_type)
        .await
        .map_err(|e| e.to_string())?;

    info!(provider = %provider_type.as_str(), "OAuth flow completed successfully");

    Ok(())
}

/// Wait for OAuth callback from browser (starts a local HTTP server)
#[tauri::command]
pub async fn wait_for_oauth_callback() -> Result<(String, String), String> {
    info!("Waiting for OAuth callback");

    let result = start_callback_server(None)
        .await
        .map_err(|e| format!("OAuth callback failed: {:?}", e))?;

    Ok((result.code, result.state))
}

/// Disconnect OAuth for a provider
#[tauri::command]
pub async fn disconnect_oauth(
    provider: String,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(provider = %provider, "Disconnecting OAuth");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    state
        .credentials
        .disconnect_oauth(provider_type)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// =============================================================================
// Manual OAuth Token Commands
// =============================================================================

/// Set an OAuth token manually (e.g. from `claude setup-token`)
///
/// This stores the token as an OAuth credential so it gets sent via
/// `Authorization: Bearer` instead of `x-api-key`.
#[tauri::command]
pub async fn set_oauth_token_manual(
    provider: String,
    token: String,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(provider = %provider, "Setting manual OAuth token");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    // Create an OAuthToken with a long expiry (1 year) since manually pasted
    // tokens don't have known expiry; user can re-paste when it expires.
    let oauth_token = solo_agent::oauth::OAuthToken::new(
        token,
        None,            // no refresh token
        365 * 24 * 3600, // 1 year expiry
        "Bearer".to_string(),
        None,
    );

    state
        .credentials
        .set_oauth_token(provider_type, oauth_token)
        .await
        .map_err(|e| e.to_string())?;

    // Re-initialize the provider with the new OAuth credential
    state
        .manager
        .initialize_provider(provider_type)
        .await
        .map_err(|e| e.to_string())?;

    info!(provider = %provider_type.as_str(), "Manual OAuth token saved successfully");

    Ok(())
}

// =============================================================================
// Claude Code CLI Commands
// =============================================================================

/// Check if Claude Code auth is complete (token exists in keychain)
#[tauri::command]
pub async fn check_claude_auth_status(state: State<'_, AgentState>) -> Result<bool, String> {
    debug!("Checking Claude Code auth status");

    // Check if we have Claude Code OAuth credentials
    let info = state
        .credentials
        .get_auth_method_info(ProviderType::Anthropic)
        .await
        .map_err(|e| e.to_string())?;

    Ok(info.is_authenticated)
}

/// Check if Claude Code CLI is installed
#[tauri::command]
pub async fn check_claude_cli_installed() -> Result<bool, String> {
    debug!("Checking if Claude CLI is installed");

    let output = std::process::Command::new("which")
        .arg("claude")
        .output()
        .map_err(|e| e.to_string())?;

    Ok(output.status.success())
}

/// Open Terminal and run claude to trigger native login flow
#[tauri::command]
pub async fn start_claude_login() -> Result<(), String> {
    info!("Starting Claude Code login");

    std::process::Command::new("open")
        .args(["-a", "Terminal"])
        .spawn()
        .map_err(|e| format!("Failed to open Terminal: {}", e))?;

    Ok(())
}

/// Install Claude Code CLI via npm
#[tauri::command]
pub async fn install_claude_cli() -> Result<(), String> {
    info!("Installing Claude Code CLI");

    let output = std::process::Command::new("npm")
        .args(["install", "-g", "@anthropic-ai/claude-code"])
        .output()
        .map_err(|e| format!("Failed to run npm: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("npm install failed: {}", stderr));
    }

    Ok(())
}
