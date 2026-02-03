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
use solo_protocol::AgentMessage;
use std::collections::HashMap;
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
// OAuth Commands
// =============================================================================

/// Start an OAuth flow for a provider
#[tauri::command]
pub async fn start_oauth_flow(
    provider: String,
    method: OAuthMethod,
    state: State<'_, AgentState>,
) -> Result<OAuthFlowResult, String> {
    info!(provider = %provider, method = ?method, "Starting OAuth flow");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    // Build authorization URL based on provider
    let (result, oauth_state) = match provider_type {
        ProviderType::Anthropic => AnthropicOAuthConfig::build_auth_url()
            .map_err(|e| e.to_string())?,
        ProviderType::OpenAI => OpenAIOAuthConfig::build_auth_url()
            .map_err(|e| e.to_string())?,
    };

    // Store the pending OAuth state
    state.oauth_pending
        .write()
        .await
        .insert(result.state.clone(), oauth_state);

    // If browser method, open the URL in the default browser
    if method == OAuthMethod::Browser {
        if let Err(e) = webbrowser::open(&result.auth_url) {
            error!(error = %e, "Failed to open browser for OAuth");
            // Don't fail - user can still copy the URL
        }
    }

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

    // Get and remove the pending OAuth state
    let pending = state.oauth_pending
        .write()
        .await
        .remove(&oauth_state)
        .ok_or_else(|| "Invalid or expired OAuth state".to_string())?;

    // Check if state has expired
    if pending.is_expired() {
        return Err("OAuth state has expired. Please try again.".to_string());
    }

    let provider_type = ProviderType::from_str(&pending.provider)
        .ok_or_else(|| format!("Unknown provider: {}", pending.provider))?;

    // Exchange code for token based on provider
    match provider_type {
        ProviderType::Anthropic => {
            let token = AnthropicOAuthConfig::exchange_code(&code, &pending.code_verifier)
                .await
                .map_err(|e| e.to_string())?;
            // Store the token
            state.credentials
                .set_oauth_token(provider_type, token)
                .await
                .map_err(|e| e.to_string())?;
        }
        ProviderType::OpenAI => {
            let token = OpenAIOAuthConfig::exchange_code(&code, &pending.code_verifier)
                .await
                .map_err(|e| e.to_string())?;
            // Store the OpenAI-specific token (includes account_id)
            state.credentials
                .set_openai_oauth_token(token)
                .await
                .map_err(|e| e.to_string())?;
        }
    };

    // Initialize the provider with the new credentials
    state.manager
        .initialize_provider(provider_type)
        .await
        .map_err(|e| e.to_string())?;

    info!(provider = %pending.provider, "OAuth flow completed successfully");

    Ok(())
}

/// Wait for OAuth callback from browser (used with Browser method)
#[tauri::command]
pub async fn wait_for_oauth_callback(
    _state: State<'_, AgentState>,
) -> Result<(String, String), String> {
    info!("Waiting for OAuth callback");

    let result = start_callback_server(None)
        .await
        .map_err(|e| e.to_string())?;

    Ok((result.code, result.state))
}

/// Get authentication method info for a provider
#[tauri::command]
pub async fn get_auth_method(
    provider: String,
    state: State<'_, AgentState>,
) -> Result<AuthMethodInfo, String> {
    debug!(provider = %provider, "Getting auth method");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    state.credentials
        .get_auth_method_info(provider_type)
        .await
        .map_err(|e| e.to_string())
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
        .map_err(|e| e.to_string())
}

// =============================================================================
// Claude Code CLI Commands
// =============================================================================

/// Check if Claude Code CLI is installed
#[tauri::command]
pub async fn check_claude_cli_installed() -> Result<bool, String> {
    debug!("Checking if Claude Code CLI is installed");

    let output = std::process::Command::new("which")
        .arg("claude")
        .output();

    match output {
        Ok(output) => {
            let is_installed = output.status.success();
            debug!(installed = is_installed, "Claude CLI check complete");
            Ok(is_installed)
        }
        Err(e) => {
            error!(error = %e, "Failed to check for Claude CLI");
            Ok(false)
        }
    }
}

/// Install Claude Code CLI via npm
#[tauri::command]
pub async fn install_claude_cli() -> Result<(), String> {
    info!("Installing Claude Code CLI via npm");

    // First check if npm is available
    let npm_check = std::process::Command::new("which")
        .arg("npm")
        .output();

    match npm_check {
        Ok(output) if !output.status.success() => {
            return Err("npm is not installed. Please install Node.js from https://nodejs.org".to_string());
        }
        Err(e) => {
            return Err(format!("Failed to check for npm: {}. Please install Node.js from https://nodejs.org", e));
        }
        _ => {}
    }

    // Install Claude Code CLI globally
    let output = std::process::Command::new("npm")
        .args(["install", "-g", "@anthropic-ai/claude-code"])
        .output()
        .map_err(|e| format!("Failed to run npm install: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("npm install failed: {}", stderr));
    }

    info!("Claude Code CLI installed successfully");
    Ok(())
}

/// Open Terminal and run `claude` to trigger the native login flow
#[tauri::command]
pub async fn start_claude_login() -> Result<(), String> {
    info!("Opening Terminal to run Claude Code CLI");

    // Use osascript to open Terminal and run claude
    // This opens a new Terminal window and runs the claude command
    let output = std::process::Command::new("osascript")
        .args([
            "-e",
            r#"tell application "Terminal"
                activate
                do script "claude"
            end tell"#,
        ])
        .output()
        .map_err(|e| format!("Failed to open Terminal: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to open Terminal: {}", stderr));
    }

    info!("Terminal opened with claude command");
    Ok(())
}

/// Check if Claude Code auth is complete (token exists in keychain)
#[tauri::command]
pub async fn check_claude_auth_status(
    state: State<'_, AgentState>,
) -> Result<bool, String> {
    info!("Checking Claude Code auth status");

    // Clear cache first to get fresh credentials
    state.credentials.clear_cache().await;

    // Check if we have any credentials for Anthropic
    let has_creds = state.credentials
        .has_credentials(ProviderType::Anthropic)
        .await;

    info!(has_credentials = has_creds, "Credential check result");

    if has_creds {
        // Try to initialize the provider to verify credentials work
        if let Err(e) = state.manager.initialize_provider(ProviderType::Anthropic).await {
            info!(error = %e, "Failed to initialize provider with credentials");
            return Ok(false);
        }

        // Check the credential source
        if let Ok(Some(source)) = state.credentials
            .get_credential_source(ProviderType::Anthropic)
            .await
        {
            info!(source = %source, "Credential source");
            // Accept any valid credential source (ClaudeOAuth, Keychain, or Environment)
            return Ok(true);
        }
    }

    Ok(false)
}
