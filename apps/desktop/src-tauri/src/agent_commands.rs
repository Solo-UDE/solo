//! Agent command handlers for Solo IDE
//!
//! This module contains AI agent IPC commands. All LLM communication is routed
//! through the Solo server via WebSocket — the desktop app manages sessions,
//! credentials (keychain), and tool execution for server-delegated tools.

use crate::fs_commands::FsState;
use futures_util::{SinkExt, StreamExt};
use solo_agent::{
    keychain,
    models::{get_all_models, get_models_for_provider},
    AgentManager, ProviderType,
};
use solo_protocol::{AgentMessage, AgentToolCall, BackendEvent, ContentBlock, ToolResult};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{watch, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};
use tracing::{debug, error, info, warn};

// =============================================================================
// State
// =============================================================================

/// Application state for agent operations
pub struct AgentState {
    /// Agent manager for handling sessions and tools
    pub manager: Arc<AgentManager>,
    /// Abort senders per session — send `true` to cancel a running stream
    abort_senders: Arc<RwLock<HashMap<String, watch::Sender<bool>>>>,
    /// Approval channels per session — frontend sends (tool_call_id, approved) tuples
    approval_channels:
        Arc<RwLock<HashMap<String, tokio::sync::mpsc::UnboundedSender<(String, bool)>>>>,
}

impl AgentState {
    pub fn new() -> Self {
        let manager = Arc::new(AgentManager::new());
        Self {
            manager,
            abort_senders: Arc::new(RwLock::new(HashMap::new())),
            approval_channels: Arc::new(RwLock::new(HashMap::new())),
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

    state.manager.set_active_provider(provider_type).await;
    Ok(())
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

    let has_credentials = keychain::has_api_key(provider_type.as_str()).unwrap_or(false);

    let credential_source = if has_credentials {
        // Determine source: keychain or env
        #[cfg(target_os = "macos")]
        {
            use security_framework::passwords::get_generic_password;
            if get_generic_password("com.solo-ide.agent", provider_type.as_str()).is_ok() {
                Some("keychain".to_string())
            } else {
                Some("environment".to_string())
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            Some("environment".to_string())
        }
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

/// Set credentials for a provider (stores in keychain)
#[tauri::command]
pub async fn set_credentials(
    provider: String,
    api_key: String,
    _state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(provider = %provider, "Setting credentials");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    keychain::set_api_key(provider_type.as_str(), &api_key)
}

/// Check if credentials exist for a provider
#[tauri::command]
pub async fn has_credentials(
    provider: String,
    _state: State<'_, AgentState>,
) -> Result<bool, String> {
    debug!(provider = %provider, "Checking credentials");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    keychain::has_api_key(provider_type.as_str())
}

/// Clear credentials for a provider (remove from keychain)
#[tauri::command]
pub async fn clear_credentials(
    provider: String,
    _state: State<'_, AgentState>,
) -> Result<(), String> {
    debug!(provider = %provider, "Clearing credentials");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    keychain::clear_api_key(provider_type.as_str())
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
    let workspace_root = fs_state
        .workspace_root
        .read()
        .await
        .clone()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    // Build chat history from the session
    let chat_history: Vec<serde_json::Value> =
        if let Some(sessions) = state.manager.get_session(&session_id).await {
            if let Some(session) = sessions.get(&session_id) {
                session
                    .history()
                    .iter()
                    .map(|msg| {
                        serde_json::json!({
                            "role": msg.role,
                            "content": msg.display_text()
                        })
                    })
                    .collect()
            } else {
                vec![]
            }
        } else {
            vec![]
        };

    // Build the server URL
    let server_url =
        std::env::var("SOLO_SERVER_URL").unwrap_or_else(|_| DEFAULT_SERVER_URL.to_string());
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

    // Set up approval channel — frontend sends (tool_call_id, approved) via this
    let (approval_tx, mut approval_rx) = tokio::sync::mpsc::unbounded_channel::<(String, bool)>();
    state
        .approval_channels
        .write()
        .await
        .insert(session_id.clone(), approval_tx);

    let abort_senders = state.abort_senders.clone();
    let approval_channels = state.approval_channels.clone();
    let sid = session_id.clone();

    // Spawn task to read server events and forward to frontend
    tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;

                // Priority 1: abort signal
                _ = abort_rx.changed() => {
                    if *abort_rx.borrow() {
                        info!(session_id = %sid, "Server mode aborted");
                        let _ = write
                            .send(WsMessage::Text(
                                serde_json::json!({"type": "cancel"}).to_string(),
                            ))
                            .await;
                        break;
                    }
                }

                // Priority 2: tool approval responses from frontend
                Some((tool_call_id, approved)) = approval_rx.recv() => {
                    debug!(session_id = %sid, tool_call_id = %tool_call_id, approved, "Sending tool approval response");
                    let response = serde_json::json!({
                        "type": "tool_approval_response",
                        "toolCallId": tool_call_id,
                        "approved": approved,
                    });
                    let _ = write
                        .send(WsMessage::Text(response.to_string()))
                        .await;
                }

                // Priority 3: WebSocket messages from server
                msg = read.next() => {
                    let msg = match msg {
                        Some(Ok(m)) => m,
                        Some(Err(e)) => {
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
                        None => {
                            debug!(session_id = %sid, "WebSocket stream ended");
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

                        "agent:complete" => {
                            let conversation_id = server_msg["conversation_id"].as_str().unwrap_or(&sid).to_string();
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

                        "agent:tool_approval_needed" => {
                            // Auto-approve all tool calls (approval UI was removed)
                            let tool_call_id = server_msg
                                .get("tool_call")
                                .and_then(|tc| tc.get("tool_call"))
                                .and_then(|tc| tc.get("id"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            debug!(session_id = %sid, tool_call_id = %tool_call_id, "Auto-approving tool call");
                            let response = serde_json::json!({
                                "type": "tool_approval_response",
                                "toolCallId": tool_call_id,
                                "approved": true
                            });
                            let _ = write
                                .send(WsMessage::Text(response.to_string()))
                                .await;
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
                                            _ => {}
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
            }
        }

        // Clean up
        abort_senders.write().await.remove(&sid);
        approval_channels.write().await.remove(&sid);
        info!(session_id = %sid, "Server mode task finished");
    });

    Ok(())
}

/// Resolve a tool approval request from the frontend
#[tauri::command]
pub async fn resolve_tool_approval(
    session_id: String,
    tool_call_id: String,
    approved: bool,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(session_id = %session_id, tool_call_id = %tool_call_id, approved, "Resolving tool approval");

    let channels = state.approval_channels.read().await;
    if let Some(tx) = channels.get(&session_id) {
        tx.send((tool_call_id, approved))
            .map_err(|_| "Approval channel closed — session may have ended".to_string())?;
    } else {
        return Err(format!("No active session found for {}", session_id));
    }
    Ok(())
}

/// Abort a running agent session
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

/// Execute a tool call (for server-delegated tools)
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
