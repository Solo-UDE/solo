//! Provider, credential, OAuth, and Claude CLI command handlers
//!
//! These commands manage authentication, credentials, and provider settings.
//! They are separate from the agent bridge commands.

use solo_auth::{
    models::{get_all_models, get_models_for_provider},
    oauth::{
        AuthMethodInfo, OAuthFlowResult, OAuthMethod, OAuthState,
        AnthropicOAuthConfig, OpenAIOAuthConfig,
        start_callback_server,
    },
    CredentialManager, ProviderType,
};
use solo_protocol::ClaudeSetupStatus;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;
use tracing::{debug, info};

// =============================================================================
// State
// =============================================================================

/// Application state for provider/auth operations
pub struct ProviderAuthState {
    /// Credential manager
    pub credentials: Arc<CredentialManager>,
    /// Active provider
    pub active_provider: RwLock<ProviderType>,
    /// Pending OAuth flows (state -> OAuthState)
    pub oauth_pending: RwLock<HashMap<String, OAuthState>>,
}

impl ProviderAuthState {
    pub fn new() -> Self {
        Self {
            credentials: Arc::new(CredentialManager::new()),
            active_provider: RwLock::new(ProviderType::Anthropic),
            oauth_pending: RwLock::new(HashMap::new()),
        }
    }
}

impl Default for ProviderAuthState {
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
    state: State<'_, ProviderAuthState>,
) -> Result<String, String> {
    debug!("Getting active provider");
    let provider = state.active_provider.read().await;
    Ok(provider.as_str().to_string())
}

/// Set the active provider
#[tauri::command]
pub async fn set_active_provider(
    provider: String,
    state: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    info!(provider = %provider, "Setting active provider");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    *state.active_provider.write().await = provider_type;
    Ok(())
}

/// Get status for a specific provider
#[tauri::command]
pub async fn get_provider_status(
    provider: String,
    state: State<'_, ProviderAuthState>,
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

    let active_provider = *state.active_provider.read().await;

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
    state: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    info!(provider = %provider, "Setting credentials");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    state.credentials
        .set_credentials(provider_type, &api_key)
        .await
        .map_err(|e| e.to_string())
}

/// Check if credentials exist for a provider
#[tauri::command]
pub async fn has_credentials(
    provider: String,
    state: State<'_, ProviderAuthState>,
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
    state: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    debug!(provider = %provider, "Clearing credentials");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    state.credentials
        .clear_credentials(provider_type)
        .await
        .map_err(|e| e.to_string())
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
// Auth Method Commands
// =============================================================================

/// Get authentication method info for a provider
#[tauri::command]
pub async fn get_auth_method(
    provider: String,
    state: State<'_, ProviderAuthState>,
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
    state: State<'_, ProviderAuthState>,
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
    state: State<'_, ProviderAuthState>,
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
    state: State<'_, ProviderAuthState>,
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

/// Check if Claude Code auth is complete (token exists in keychain)
#[tauri::command]
pub async fn check_claude_auth_status(
    state: State<'_, ProviderAuthState>,
) -> Result<bool, String> {
    debug!("Checking Claude Code auth status");

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

/// Verify Claude Code CLI setup
#[tauri::command]
pub async fn verify_claude_setup(
    state: State<'_, ProviderAuthState>,
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

    // 2. Read credentials with full detail
    let detailed = state
        .credentials
        .get_claude_oauth_detailed()
        .await
        .map_err(|e| e.to_string())?;

    let access_token = if let Some((token, expires_at, source, oauth_obj)) = detailed {
        status.credentials_found = true;
        status.credential_source = Some(source.to_string());
        status.token_expires_at = expires_at;

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
    if status.credentials_found {
        let source = status.credential_source.as_deref().unwrap_or("");
        status.requires_cli_mode = source == "claude-oauth" || source == "claude-oauth-file";
    }

    // 4. CLI mode is available when CLI is installed and credentials exist
    status.cli_mode_available = status.cli_installed && status.credentials_found && !status.token_expired;

    // 5. API verification
    if status.requires_cli_mode {
        if !status.cli_installed {
            status.error = Some(
                "Subscription token detected but Claude CLI not installed. \
                 Install with: npm i -g @anthropic-ai/claude-code"
                    .to_string(),
            );
        } else if status.cli_mode_available {
            status.api_verified = Some(true);
        }
    } else if let Some(ref token) = access_token {
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
                    status.error = Some(format!("Network error: {}", e));
                }
            }
        }
    }

    Ok(status)
}
