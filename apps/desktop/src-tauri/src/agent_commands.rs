//! Agent command handlers for Solo IDE
//!
//! This module contains all AI agent related IPC commands.

use solo_agent::{
    models::{get_all_models, get_models_for_provider},
    oauth::{
        AnthropicOAuthConfig, OpenAIOAuthConfig, AuthMethodInfo, OAuthFlowResult, OAuthMethod, OAuthState,
        start_callback_server,
    },
    AgentManager, CredentialManager, CredentialSource, ProviderType,
};
use solo_protocol::{AgentMessage, AgentToolCall, ToolCallWithStatus, ToolResult};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use tracing::{debug, error, info};

/// Application state for agent operations
pub struct AgentState {
    /// Agent manager for handling sessions and providers
    pub manager: Arc<AgentManager>,
    /// Credential manager
    pub credentials: Arc<CredentialManager>,
    /// Pending OAuth flows (state -> OAuthState)
    pub oauth_pending: RwLock<HashMap<String, OAuthState>>,
}

impl AgentState {
    pub fn new() -> Self {
        let credentials = Arc::new(CredentialManager::new());
        let manager = Arc::new(AgentManager::new(credentials.clone()));
        Self {
            manager,
            credentials,
            oauth_pending: RwLock::new(HashMap::new()),
        }
    }
}

impl Default for AgentState {
    fn default() -> Self {
        Self::new()
    }
}

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
}

// =============================================================================
// Provider Management Commands
// =============================================================================

/// Get list of available providers
#[tauri::command]
pub async fn get_providers() -> Result<Vec<String>, String> {
    debug!("Getting available providers");
    Ok(vec!["anthropic".to_string(), "openai".to_string()])
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

/// Send a message to the agent and stream the response
#[tauri::command]
pub async fn agent_send_message(
    session_id: String,
    content: String,
    system_prompt: Option<String>,
    app: AppHandle,
    state: State<'_, AgentState>,
) -> Result<(), String> {
    info!(session_id = %session_id, content_len = content.len(), "Sending message to agent");

    // Get the streaming receiver
    let mut receiver = state.manager
        .send_message(&session_id, content, system_prompt)
        .await
        .map_err(|e| {
            error!(error = %e, session_id = %session_id, "Failed to send message");
            e.to_string()
        })?;

    info!(session_id = %session_id, "Got streaming receiver, spawning event forwarder");

    // Spawn a task to forward events to the frontend
    let session_id_clone = session_id.clone();
    tokio::spawn(async move {
        let mut event_count = 0u32;
        while let Some(event) = receiver.recv().await {
            event_count += 1;
            // Log every event for debugging
            info!(session_id = %session_id_clone, event_count = event_count, event_type = ?std::mem::discriminant(&event), "Forwarding event to frontend");

            if let Err(e) = app.emit("backend-event", &event) {
                error!(error = %e, session_id = %session_id_clone, "Failed to emit agent event");
            }
        }
        info!(session_id = %session_id_clone, total_events = event_count, "Event stream completed");
    });

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

/// Tool definition response for frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolDefinitionResponse {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
    pub needs_approval: bool,
}

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

/// Execute a tool call
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

/// Approve a pending tool call
#[tauri::command]
pub async fn approve_tool_call(
    tool_call_id: String,
    state: State<'_, AgentState>,
) -> Result<ToolCallWithStatus, String> {
    info!(tool_call_id = %tool_call_id, "Approving tool call");

    state.manager
        .approve_tool_call(&tool_call_id)
        .await
        .map_err(|e| e.to_string())
}

/// Reject a pending tool call
#[tauri::command]
pub async fn reject_tool_call(
    tool_call_id: String,
    state: State<'_, AgentState>,
) -> Result<ToolCallWithStatus, String> {
    info!(tool_call_id = %tool_call_id, "Rejecting tool call");

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
