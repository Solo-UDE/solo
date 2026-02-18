//! Agent command handlers for Solo IDE
//!
//! This module contains all AI agent related IPC commands,
//! including the agentic loop that executes tool calls and
//! feeds results back to the LLM.

use solo_agent::{
    build_system_prompt,
    claude_cli,
    models::{get_all_models, get_models_for_provider},
    oauth::{
        AuthMethodInfo, OAuthFlowResult, OAuthMethod, OAuthState,
        AnthropicOAuthConfig, OpenAIOAuthConfig,
        start_callback_server,
    },
    AgentManager, CredentialManager, ProviderType,
};
use solo_protocol::{AgentMessage, AgentToolCall, BackendEvent, ClaudeSetupStatus, ContentBlock, ToolCallStatus, ToolCallWithStatus, ToolResult};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{oneshot, watch, RwLock};
use tracing::{debug, error, info, warn};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};
use crate::fs_commands::FsState;

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
            info!(session_id = %session_id, tool = %tool_call.name, id = %tool_call.id, args_len = tool_call.arguments.len(), "Executing tool");
            let tool_start = std::time::Instant::now();
            let result = manager.execute_tool(tool_call).await;
            let tool_elapsed_ms = tool_start.elapsed().as_millis();

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
                    result
                        .error
                        .unwrap_or_else(|| "Unknown error".to_string()),
                    true,
                )
            };

            info!(
                session_id = %session_id,
                tool = %tool_call.name,
                success = !is_error,
                result_len = result_text.len(),
                elapsed_ms = %tool_elapsed_ms,
                "Tool execution complete"
            );

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
        debug!(session_id = %session_id, turn, tool_results_count = tool_results.len(), "Conversation state before next turn");
        if let Err(e) = manager
            .add_message_to_session(
                &session_id,
                AgentMessage::tool_results(tool_results),
            )
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
    Ok(vec!["anthropic".to_string(), "openai".to_string(), "gemini".to_string()])
}

/// Get the currently active provider
#[tauri::command]
pub async fn get_active_provider(
    state: State<'_, AgentState>,
) -> Result<String, String> {
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

    state.manager
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

    let has_credentials = state.credentials
        .has_credentials(provider_type)
        .await;

    let credential_source = if has_credentials {
        state.credentials
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

    state.credentials
        .set_credentials(provider_type, &api_key)
        .await
        .map_err(|e| e.to_string())?;

    // Initialize the provider with the new credentials
    state.manager
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

/// Clear credentials for a provider (remove from Keychain)
#[tauri::command]
pub async fn clear_credentials(
    provider: String,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    debug!(provider = %provider, "Clearing credentials");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    state.credentials
        .clear_credentials(provider_type)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
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

    // For Anthropic, always re-initialize to ensure correct provider type
    // (CLI vs Direct API) based on current credentials. This handles the case
    // where the user runs `claude login` after the app starts.
    if provider_type == ProviderType::Anthropic {
        if state.credentials.has_credentials(provider_type).await {
            info!(provider = %provider_type.as_str(), "Re-initializing Anthropic provider to ensure correct mode");
            state.manager
                .reinitialize_provider(provider_type)
                .await
                .map_err(|e| e.to_string())?;
        } else {
            return Err(format!(
                "No credentials found for {}. Please add an API key or run `claude login`.",
                provider_type.display_name()
            ));
        }
    } else if !state.manager.is_provider_initialized(provider_type).await {
        // Other providers: only initialize if not already done
        if state.credentials.has_credentials(provider_type).await {
            info!(provider = %provider_type.as_str(), "Auto-initializing provider with existing credentials");
            state.manager
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

    state.manager
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
    state.manager
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
    mode: Option<String>,
    app: AppHandle,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(session_id = %session_id, content_len = content.len(), mode = ?mode, "Sending message to agent (agentic loop)");

    // Abort any existing loop for this session
    if let Some(old_sender) = state.abort_senders.write().await.remove(&session_id) {
        let _ = old_sender.send(true);
        info!(session_id = %session_id, "Aborted previous loop for session");
    }

    // Read workspace root from FsState for tool sandboxing
    let fs_state = app.state::<FsState>();
    let workspace_root = fs_state.workspace_root.read().await.clone();

    // Detect whether we're using the CLI (OAuth) or direct API
    let is_cli = state.manager.is_cli_mode().await;
    info!(session_id = %session_id, is_cli = is_cli, "Provider mode detected");

    let effective_prompt = if is_cli {
        // CLI mode: the CLI has its own tools — only provide workspace context.
        // Do NOT embed Solo's tool definitions (the CLI can't use them).
        let ws_info = workspace_root
            .as_ref()
            .map(|p| format!("Current workspace root: `{}`", p.to_string_lossy()))
            .unwrap_or_else(|| {
                "No workspace is currently open. The user has not opened a folder yet. \
                 Ask them to open a folder if file operations are needed."
                    .to_string()
            });

        let mut prompt = format!("## Workspace\n\n{}\n", ws_info);
        if mode.as_deref() == Some("planning") {
            prompt = format!(
                "IMPORTANT: You are in planning mode. Take your time to think through problems step by step \
                 before providing solutions. Break down complex tasks into clear steps and explain your \
                 reasoning before writing code.\n\n{}",
                prompt
            );
        }
        Some(prompt)
    } else {
        // Direct API mode: build full prompt with Solo's tool definitions
        // Set workspace root on tool registry so file tools enforce path containment
        if let Some(ref root) = workspace_root {
            let registry = state.manager.tool_registry();
            registry.read().await.set_workspace_root(root.clone()).await;
            info!(workspace_root = %root.display(), "Tool registry workspace root set");
        }

        let tools = state.manager.get_tool_definitions().await;
        let ws_root = workspace_root
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| {
                "No workspace is currently open. The user has not opened a folder yet. \
                 Ask them to open a folder if file operations are needed."
                    .to_string()
            });
        let mut prompt = build_system_prompt(&tools, &ws_root);

        if mode.as_deref() == Some("planning") {
            prompt = format!(
                "IMPORTANT: You are in planning mode. Take your time to think through problems step by step \
                 before providing solutions. Break down complex tasks into clear steps and explain your \
                 reasoning before writing code.\n\n{}",
                prompt
            );
        }
        Some(prompt)
    };

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

    if is_cli {
        // CLI mode: call stream_cli_response directly with the shared approval
        // map so the native `--permission-prompt-tool stdio` control protocol
        // bridges to Solo's existing approve/reject infrastructure.
        let model = {
            if let Some(sessions) = state.manager.get_session(&session_id).await {
                sessions.get(&session_id).map(|s| s.model.clone())
                    .unwrap_or_else(|| "claude-sonnet-4-6".to_string())
            } else {
                "claude-sonnet-4-6".to_string()
            }
        };

        let (event_tx, mut event_rx) = tokio::sync::mpsc::channel(100);
        let approvals_for_cli = loop_approvals.clone();

        // Spawn the CLI streaming task with the native permission bridge
        let cli_sid = sid.clone();
        let cli_prompt = content;
        let cli_system = effective_prompt;
        let cli_model = model;
        let cli_tx = event_tx.clone();
        tokio::spawn(async move {
            let result = claude_cli::stream_cli_response(
                cli_model,
                cli_prompt,
                cli_system,
                cli_sid.clone(),
                cli_tx.clone(),
                Some(approvals_for_cli),
            )
            .await;

            if let Err(e) = result {
                let _ = cli_tx
                    .send(BackendEvent::AgentError {
                        conversation_id: cli_sid,
                        error: e.to_string(),
                    })
                    .await;
            }
        });

        // Forwarding task: reads events from stream_cli_response and emits to frontend
        tokio::spawn(async move {
            // Emit TurnStart so the frontend knows streaming has begun
            let _ = app.emit(
                "agent-event",
                &BackendEvent::AgentTurnStart {
                    conversation_id: sid.clone(),
                    turn_number: 1,
                },
            );

            // Forward all events from the CLI (including AgentToolApprovalNeeded)
            while let Some(event) = event_rx.recv().await {
                let event_type = match &event {
                    BackendEvent::AgentChunk { .. } => "AgentChunk",
                    BackendEvent::AgentToolStart { .. } => "AgentToolStart",
                    BackendEvent::AgentToolEnd { .. } => "AgentToolEnd",
                    BackendEvent::AgentToolApprovalNeeded { .. } => "AgentToolApprovalNeeded",
                    BackendEvent::AgentComplete { .. } => "AgentComplete",
                    BackendEvent::AgentError { .. } => "AgentError",
                    _ => "Other",
                };
                debug!(session_id = %sid, event_type, "Forwarding CLI event to frontend");
                let _ = app.emit("agent-event", &event);
            }

            // Emit LoopComplete so the frontend knows the response is finished
            info!(session_id = %sid, "CLI streaming finished, emitting LoopComplete");
            let _ = app.emit(
                "agent-event",
                &BackendEvent::AgentLoopComplete {
                    conversation_id: sid.clone(),
                    total_turns: 1,
                },
            );

            abort_senders.write().await.remove(&sid);
            info!(session_id = %sid, "CLI streaming task finished");
        });
    } else {
        // Direct API mode: get the streaming receiver via the provider trait
        // and run Solo's full agentic loop with custom tools
        let receiver = state.manager
            .send_message(&session_id, content, effective_prompt.clone())
            .await
            .map_err(|e| {
                error!(error = %e, session_id = %session_id, "Failed to send message");
                e.to_string()
            })?;

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
    }

    Ok(())
}

/// Default Solo server URL (local dev)
const DEFAULT_SERVER_URL: &str = "ws://localhost:3001";

/// Send a message to the agent via the Solo server (WebSocket mode).
///
/// Opens a WebSocket to the server, sends the user request, and streams
/// events back to the frontend. File operations requested by the server
/// are executed locally and responses sent back.
#[tauri::command]
pub async fn agent_send_message_server(
    session_id: String,
    content: String,
    model: String,
    mode: Option<String>,
    app: AppHandle,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(
        session_id = %session_id,
        content_len = content.len(),
        model = %model,
        mode = ?mode,
        "Sending message to agent via server"
    );

    // Abort any existing loop for this session
    if let Some(old_sender) = state.abort_senders.write().await.remove(&session_id) {
        let _ = old_sender.send(true);
    }

    // Read workspace root
    let fs_state = app.state::<FsState>();
    let workspace_root = fs_state.workspace_root.read().await.clone()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    // Build chat history from the session
    let chat_history: Vec<serde_json::Value> = if let Some(sessions) = state.manager.get_session(&session_id).await {
        if let Some(session) = sessions.get(&session_id) {
            session.history().iter().map(|msg| {
                serde_json::json!({
                    "role": msg.role,
                    "content": msg.display_text()
                })
            }).collect()
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    // Build the server URL
    let server_url = std::env::var("SOLO_SERVER_URL")
        .unwrap_or_else(|_| DEFAULT_SERVER_URL.to_string());
    let ws_url = format!("{}/agent/ws/agent", server_url);

    info!(session_id = %session_id, ws_url = %ws_url, "Connecting to Solo server");

    // Connect to server WebSocket
    let (ws_stream, _response) = connect_async(&ws_url)
        .await
        .map_err(|e| format!("Failed to connect to Solo server: {}", e))?;

    let (mut write, mut read) = ws_stream.split();

    // Send user_request message
    let user_request = serde_json::json!({
        "type": "user_request",
        "data": {
            "sessionId": session_id,
            "prompt": content,
            "model": model,
            "mode": mode.unwrap_or_else(|| "fast".to_string()),
            "workspaceRoot": workspace_root,
            "chatHistory": chat_history
        }
    });

    write
        .send(WsMessage::Text(user_request.to_string()))
        .await
        .map_err(|e| format!("Failed to send message to server: {}", e))?;

    // Set up abort channel
    let (abort_tx, mut abort_rx) = watch::channel(false);
    state
        .abort_senders
        .write()
        .await
        .insert(session_id.clone(), abort_tx);

    let abort_senders = state.abort_senders.clone();
    let loop_approvals = state.loop_approvals.clone();
    let sid = session_id.clone();

    // Spawn task to read server events and forward to frontend
    tokio::spawn(async move {
        while let Some(msg_result) = read.next().await {
            // Check abort
            if *abort_rx.borrow() {
                info!(session_id = %sid, "Server mode aborted");
                let _ = write
                    .send(WsMessage::Text(
                        serde_json::json!({"type": "cancel"}).to_string(),
                    ))
                    .await;
                break;
            }

            let msg = match msg_result {
                Ok(m) => m,
                Err(e) => {
                    error!(session_id = %sid, error = %e, "WebSocket read error");
                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentError {
                            conversation_id: sid.clone(),
                            error: format!("Server connection error: {}", e),
                        },
                    );
                    break;
                }
            };

            let text = match msg {
                WsMessage::Text(t) => t,
                WsMessage::Close(_) => {
                    debug!(session_id = %sid, "WebSocket closed by server");
                    break;
                }
                WsMessage::Ping(data) => {
                    let _ = write.send(WsMessage::Pong(data)).await;
                    continue;
                }
                _ => continue,
            };

            // Parse the server message
            let server_msg: serde_json::Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(e) => {
                    warn!(session_id = %sid, error = %e, "Failed to parse server message");
                    continue;
                }
            };

            let msg_type = server_msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

            match msg_type {
                "connected" | "init" => {
                    debug!(session_id = %sid, msg_type, "Server handshake message");
                }

                "agent:chunk" => {
                    let conversation_id = server_msg["conversation_id"].as_str().unwrap_or(&sid).to_string();
                    let chunk_content = server_msg["content"].as_str().unwrap_or("").to_string();
                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentChunk {
                            conversation_id,
                            content: chunk_content,
                        },
                    );
                }

                "agent:turn_start" => {
                    let conversation_id = server_msg["conversation_id"].as_str().unwrap_or(&sid).to_string();
                    let turn_number = server_msg["turn_number"].as_u64().unwrap_or(1) as u32;
                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentTurnStart {
                            conversation_id,
                            turn_number,
                        },
                    );
                }

                "agent:tool_start" => {
                    let conversation_id = server_msg["conversation_id"].as_str().unwrap_or(&sid).to_string();
                    if let Some(tc) = server_msg.get("tool_call") {
                        let tool_call = AgentToolCall {
                            id: tc["id"].as_str().unwrap_or("").to_string(),
                            name: tc["name"].as_str().unwrap_or("").to_string(),
                            arguments: tc["arguments"].as_str().unwrap_or("{}").to_string(),
                        };
                        let _ = app.emit(
                            "agent-event",
                            &BackendEvent::AgentToolStart {
                                conversation_id,
                                tool_call,
                            },
                        );
                    }
                }

                "agent:tool_end" => {
                    let conversation_id = server_msg["conversation_id"].as_str().unwrap_or(&sid).to_string();
                    let tool_call_id = server_msg["tool_call_id"].as_str().unwrap_or("").to_string();
                    let result = server_msg["result"].as_str().unwrap_or("").to_string();
                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentToolEnd {
                            conversation_id,
                            tool_call_id,
                            result,
                        },
                    );
                }

                "agent:tool_approval_needed" => {
                    let conversation_id = server_msg["conversation_id"].as_str().unwrap_or(&sid).to_string();
                    if let Some(tc_data) = server_msg.get("tool_call") {
                        let tool_call_inner = tc_data.get("tool_call").unwrap_or(tc_data);
                        let tool_call = AgentToolCall {
                            id: tool_call_inner["id"].as_str().unwrap_or("").to_string(),
                            name: tool_call_inner["name"].as_str().unwrap_or("").to_string(),
                            arguments: tool_call_inner["arguments"].as_str().unwrap_or("{}").to_string(),
                        };
                        let tool_call_id = tool_call.id.clone();

                        let _ = app.emit(
                            "agent-event",
                            &BackendEvent::AgentToolApprovalNeeded {
                                conversation_id: conversation_id.clone(),
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
                            .insert(tool_call_id.clone(), (tool_call, approval_tx));

                        // Wait for approval and send response back to server
                        let approved = tokio::select! {
                            result = approval_rx => result.unwrap_or(false),
                            _ = tokio::time::sleep(Duration::from_secs(TOOL_APPROVAL_TIMEOUT_SECS)) => {
                                warn!(session_id = %sid, tool_call_id = %tool_call_id, "Server mode tool approval timed out");
                                loop_approvals.write().await.remove(&tool_call_id);
                                false
                            }
                            _ = abort_rx.changed() => {
                                loop_approvals.write().await.remove(&tool_call_id);
                                false
                            }
                        };

                        // Send approval response back to server
                        let approval_response = serde_json::json!({
                            "type": "tool_approval_response",
                            "toolCallId": tool_call_id,
                            "approved": approved
                        });
                        let _ = write
                            .send(WsMessage::Text(approval_response.to_string()))
                            .await;
                    }
                }

                "agent:complete" => {
                    let conversation_id = server_msg["conversation_id"].as_str().unwrap_or(&sid).to_string();
                    // Build AgentMessage from server data
                    let text = server_msg["message"]["text"].as_str().map(String::from);
                    let content_blocks: Vec<ContentBlock> = if let Some(ref t) = text {
                        vec![ContentBlock::Text { text: t.clone() }]
                    } else {
                        vec![]
                    };
                    let agent_msg = AgentMessage {
                        role: "assistant".to_string(),
                        content: content_blocks,
                        text,
                    };
                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentComplete {
                            conversation_id,
                            message: agent_msg,
                        },
                    );
                }

                "agent:error" => {
                    let conversation_id = server_msg["conversation_id"].as_str().unwrap_or(&sid).to_string();
                    let error_msg = server_msg["error"].as_str().unwrap_or("Unknown server error").to_string();
                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentError {
                            conversation_id,
                            error: error_msg,
                        },
                    );
                }

                "agent:loop_complete" => {
                    let conversation_id = server_msg["conversation_id"].as_str().unwrap_or(&sid).to_string();
                    let total_turns = server_msg["total_turns"].as_u64().unwrap_or(1) as u32;
                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentLoopComplete {
                            conversation_id,
                            total_turns,
                        },
                    );
                }

                "agent:aborted" => {
                    let conversation_id = server_msg["conversation_id"].as_str().unwrap_or(&sid).to_string();
                    let reason = server_msg["reason"].as_str().unwrap_or("Unknown").to_string();
                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentAborted {
                            conversation_id,
                            reason,
                        },
                    );
                }

                "fs_operation" => {
                    // Server is requesting a local file operation
                    let op_id = server_msg["id"].as_str().unwrap_or("").to_string();
                    let operation = server_msg["operation"].as_str().unwrap_or("");

                    let (success, data, error_msg) = match operation {
                        "read" => {
                            let path = server_msg["path"].as_str().unwrap_or("");
                            match tokio::fs::read_to_string(path).await {
                                Ok(content) => (true, Some(serde_json::Value::String(content)), None),
                                Err(e) => (false, None, Some(e.to_string())),
                            }
                        }
                        "write" => {
                            let path = server_msg["path"].as_str().unwrap_or("");
                            let file_content = server_msg["content"].as_str().unwrap_or("");
                            // Ensure parent directory exists
                            if let Some(parent) = std::path::Path::new(path).parent() {
                                let _ = tokio::fs::create_dir_all(parent).await;
                            }
                            match tokio::fs::write(path, file_content).await {
                                Ok(_) => (true, Some(serde_json::Value::String("ok".to_string())), None),
                                Err(e) => (false, None, Some(e.to_string())),
                            }
                        }
                        "list" => {
                            let path = server_msg["path"].as_str().unwrap_or(".");
                            match tokio::fs::read_dir(path).await {
                                Ok(mut entries) => {
                                    let mut items = Vec::new();
                                    while let Ok(Some(entry)) = entries.next_entry().await {
                                        items.push(entry.file_name().to_string_lossy().to_string());
                                    }
                                    (true, Some(serde_json::json!(items)), None)
                                }
                                Err(e) => (false, None, Some(e.to_string())),
                            }
                        }
                        "run_command" => {
                            let cmd = server_msg["command"].as_str().unwrap_or("");
                            let cwd = if workspace_root.is_empty() { "." } else { &workspace_root };
                            match tokio::process::Command::new("sh")
                                .arg("-c")
                                .arg(cmd)
                                .current_dir(cwd)
                                .output()
                                .await
                            {
                                Ok(output) => {
                                    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                                    let combined = if stderr.is_empty() {
                                        stdout
                                    } else {
                                        format!("{}\n{}", stdout, stderr)
                                    };
                                    (output.status.success(), Some(serde_json::Value::String(combined.clone())), if !output.status.success() { Some(combined) } else { None })
                                }
                                Err(e) => (false, None, Some(e.to_string())),
                            }
                        }
                        "ripgrep" => {
                            if let Some(params) = server_msg.get("ripgrepParameters") {
                                let pattern = params["pattern"].as_str().unwrap_or("");
                                let search_path = params["path"].as_str().unwrap_or(".");
                                let mut args = vec![pattern.to_string(), search_path.to_string()];
                                if params.get("caseInsensitive").and_then(|v| v.as_bool()).unwrap_or(false) {
                                    args.insert(0, "-i".to_string());
                                }
                                let output_mode = params["output_mode"].as_str().unwrap_or("files_with_matches");
                                match output_mode {
                                    "files_with_matches" => args.insert(0, "-l".to_string()),
                                    "count" => args.insert(0, "-c".to_string()),
                                    _ => {} // "content" is the default
                                }
                                if let Some(glob_pat) = params["glob"].as_str() {
                                    args.insert(0, format!("--glob={}", glob_pat));
                                }
                                match tokio::process::Command::new("rg")
                                    .args(&args)
                                    .output()
                                    .await
                                {
                                    Ok(output) => {
                                        let result = String::from_utf8_lossy(&output.stdout).to_string();
                                        (true, Some(serde_json::Value::String(result)), None)
                                    }
                                    Err(e) => (false, None, Some(e.to_string())),
                                }
                            } else {
                                (false, None, Some("Missing ripgrepParameters".to_string()))
                            }
                        }
                        "glob" => {
                            if let Some(params) = server_msg.get("globParameters") {
                                let pattern = params["pattern"].as_str().unwrap_or("*");
                                let search_path = params["path"].as_str().unwrap_or(".");
                                // Use fd or find as a fallback for glob
                                let cmd = format!("find {} -name '{}' -type f 2>/dev/null | head -100", search_path, pattern);
                                match tokio::process::Command::new("sh")
                                    .arg("-c")
                                    .arg(&cmd)
                                    .output()
                                    .await
                                {
                                    Ok(output) => {
                                        let result = String::from_utf8_lossy(&output.stdout).to_string();
                                        (true, Some(serde_json::Value::String(result)), None)
                                    }
                                    Err(e) => (false, None, Some(e.to_string())),
                                }
                            } else {
                                (false, None, Some("Missing globParameters".to_string()))
                            }
                        }
                        "delete" => {
                            let path = server_msg["path"].as_str().unwrap_or("");
                            match tokio::fs::remove_file(path).await {
                                Ok(_) => (true, Some(serde_json::Value::String("ok".to_string())), None),
                                Err(e) => (false, None, Some(e.to_string())),
                            }
                        }
                        _ => {
                            (false, None, Some(format!("Unknown operation: {}", operation)))
                        }
                    };

                    // Send response back to server
                    let response = serde_json::json!({
                        "type": "fs_operation_response",
                        "id": op_id,
                        "success": success,
                        "data": data,
                        "error": error_msg
                    });
                    let _ = write
                        .send(WsMessage::Text(response.to_string()))
                        .await;
                }

                "complete" | "cancelled" => {
                    debug!(session_id = %sid, msg_type, "Server session ended");
                    break;
                }

                "error" => {
                    let error_data = server_msg["data"].as_str().unwrap_or("Unknown server error");
                    error!(session_id = %sid, error = %error_data, "Server error message");
                    let _ = app.emit(
                        "agent-event",
                        &BackendEvent::AgentError {
                            conversation_id: sid.clone(),
                            error: error_data.to_string(),
                        },
                    );
                }

                _ => {
                    debug!(session_id = %sid, msg_type, "Unknown server message type");
                }
            }
        }

        // Clean up
        abort_senders.write().await.remove(&sid);
        info!(session_id = %sid, "Server mode task finished");
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

    let sessions = state.manager
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
    if let Some((original_tool_call, sender)) = state.loop_approvals.write().await.remove(&tool_call_id) {
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
    state.manager
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
    if let Some((original_tool_call, sender)) = state.loop_approvals.write().await.remove(&tool_call_id) {
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
    state.manager
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

    state.credentials
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
        ProviderType::OpenAI => {
            OpenAIOAuthConfig::build_auth_url().map_err(|e| e.to_string())?
        }
        ProviderType::Gemini => {
            return Err("Gemini does not support OAuth".to_string());
        }
    };

    // Store the OAuth state for later verification
    state.oauth_pending
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
    let pending_state = state.oauth_pending
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

            state.credentials
                .set_oauth_token(provider_type, token)
                .await
                .map_err(|e| e.to_string())?;
        }
        ProviderType::OpenAI => {
            let token = OpenAIOAuthConfig::exchange_code(&code, &pending_state.code_verifier)
                .await
                .map_err(|e| e.to_string())?;

            state.credentials
                .set_openai_oauth_token(token)
                .await
                .map_err(|e| e.to_string())?;
        }
        ProviderType::Gemini => {
            return Err("Gemini does not support OAuth".to_string());
        }
    }

    // Re-initialize the provider with the new credentials
    state.manager
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

    state.credentials
        .disconnect_oauth(provider_type)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// =============================================================================
// Claude Code CLI Commands
// =============================================================================

/// Check if Claude Code auth is complete (token exists in keychain)
#[tauri::command]
pub async fn check_claude_auth_status(
    state: State<'_, AgentState>,
) -> Result<bool, String> {
    debug!("Checking Claude Code auth status");

    // Check if we have Claude Code OAuth credentials
    let info = state.credentials
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

/// Open Terminal and run `claude login` to trigger the native login flow
#[tauri::command]
pub async fn start_claude_login() -> Result<(), String> {
    info!("Starting Claude Code login");

    std::process::Command::new("osascript")
        .args([
            "-e",
            "tell application \"Terminal\" to do script \"claude login\"",
        ])
        .spawn()
        .map_err(|e| format!("Failed to open Terminal with claude login: {}", e))?;

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

/// Verify Claude Code CLI setup: CLI presence, credential parsing, and optional API validation.
///
/// Returns a structured `ClaudeSetupStatus` with all discoverable information
/// rather than a bare boolean.
#[tauri::command]
pub async fn verify_claude_setup(
    state: State<'_, AgentState>,
) -> Result<ClaudeSetupStatus, String> {
    info!("Verifying Claude Code setup");

    let mut status = ClaudeSetupStatus {
        cli_installed: false,
        cli_path: None,
        credentials_found: false,
        credential_source: None,
        token_expired: false,
        token_expires_at: None,
        token_expires_in_seconds: None,
        scopes: None,
        api_verified: None,
        error: None,
        cli_mode_available: false,
        requires_cli_mode: false,
    };

    // 1. Check CLI installation
    match std::process::Command::new("which").arg("claude").output() {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            status.cli_installed = true;
            if !path.is_empty() {
                status.cli_path = Some(path);
            }
        }
        _ => {}
    }

    // 2. Read credentials (keychain then file fallback) with full detail
    let detailed = state
        .credentials
        .get_claude_oauth_detailed()
        .await
        .map_err(|e| e.to_string())?;

    let access_token = if let Some((token, expires_at, source, oauth_obj)) = detailed {
        status.credentials_found = true;
        status.credential_source = Some(source.to_string());
        status.token_expires_at = expires_at;

        // Extract scopes if present
        if let Some(scopes_val) = oauth_obj.get("scopes") {
            if let Some(arr) = scopes_val.as_array() {
                let scopes: Vec<String> = arr
                    .iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect();
                if !scopes.is_empty() {
                    status.scopes = Some(scopes);
                }
            }
        }

        // Check expiry
        if let Some(exp) = expires_at {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;

            let diff_seconds = (exp - now_ms) / 1000;
            status.token_expires_in_seconds = Some(diff_seconds);
            status.token_expired = exp <= now_ms;
        }

        Some(token)
    } else {
        None
    };

    // 3. Determine if this is a subscription token that requires CLI mode
    // Claude Code OAuth tokens cannot be used for direct API calls - they must
    // go through the CLI which handles subscription billing.
    if status.credentials_found {
        let source = status.credential_source.as_deref().unwrap_or("");
        status.requires_cli_mode = source == "claude-oauth" || source == "claude-oauth-file";
    }

    // 4. CLI mode is available when CLI is installed and credentials exist
    status.cli_mode_available = status.cli_installed && status.credentials_found && !status.token_expired;

    // 5. API verification — skip for subscription tokens since they require CLI mode
    // Direct API calls with OAuth tokens will fail with billing errors
    if status.requires_cli_mode {
        // Don't verify API directly - subscription tokens can't be used this way
        if !status.cli_installed {
            status.error = Some(
                "Subscription token detected but Claude CLI not installed. \
                 Install with: npm i -g @anthropic-ai/claude-code"
                    .to_string(),
            );
        } else if status.cli_mode_available {
            // CLI mode is available, mark as working
            status.api_verified = Some(true);
        }
    } else if let Some(ref token) = access_token {
        // For non-subscription tokens (Solo OAuth), verify API directly
        if !status.token_expired {
            match reqwest::Client::new()
                .get("https://api.anthropic.com/v1/models")
                .header("Authorization", format!("Bearer {}", token))
                .header("anthropic-version", "2023-06-01")
                .header("anthropic-beta", "oauth-2025-04-20")
                .send()
                .await
            {
                Ok(resp) => {
                    let code = resp.status().as_u16();
                    if code == 200 {
                        status.api_verified = Some(true);
                    } else {
                        status.api_verified = Some(false);
                        status.error = Some(format!("API returned HTTP {}", code));
                    }
                }
                Err(e) => {
                    // Network error — leave api_verified as None
                    status.error = Some(format!("Network error: {}", e));
                }
            }
        }
    }

    Ok(status)
}
