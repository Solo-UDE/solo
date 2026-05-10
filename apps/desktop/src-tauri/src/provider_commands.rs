//! Provider, credential, OAuth, and Claude CLI command handlers
//!
//! These commands manage authentication, credentials, and provider settings.
//! They are separate from the agent bridge commands.

use solo_auth::{
    credentials::CredentialSource,
    models::{get_all_models, get_models_for_provider},
    oauth::{
        start_callback_server, start_callback_server_on, AnthropicOAuthConfig, AuthMethodInfo,
        OAuthFlowResult, OAuthMethod, OAuthState, OpenAIOAuthConfig,
    },
    CredentialManager, ProviderType,
};
use solo_protocol::ClaudeSetupStatus;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
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

fn shell_claude_path() -> Option<PathBuf> {
    let output = std::process::Command::new("/bin/zsh")
        .args(["-lc", "command -v claude"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

fn common_claude_paths() -> Vec<PathBuf> {
    let home = std::env::var("HOME").ok().map(PathBuf::from);
    let mut paths = Vec::new();

    if let Some(home) = home {
        paths.extend([
            home.join(".local/bin/claude"),
            home.join(".bun/bin/claude"),
            home.join(".npm-global/bin/claude"),
        ]);
    }

    paths.extend([
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ]);

    paths
}

fn find_claude_cli() -> Option<PathBuf> {
    shell_claude_path().or_else(|| {
        common_claude_paths()
            .into_iter()
            .find(|path| path.is_file())
    })
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn applescript_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn claude_login_command(cli_path: Option<&PathBuf>) -> String {
    match cli_path {
        Some(path) => format!("{} /login", shell_quote(&path.to_string_lossy())),
        None => "claude /login".to_string(),
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
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDiagnosticResponse {
    pub provider: ProviderType,
    pub model: String,
    pub ok: bool,
    pub authenticated: bool,
    pub credential_source: Option<String>,
    pub status: String,
    pub message: String,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

fn truncate_response_body(body: &str) -> String {
    const MAX_LEN: usize = 360;
    let trimmed = body.trim();
    if trimmed.len() <= MAX_LEN {
        trimmed.to_string()
    } else {
        format!("{}...", &trimmed[..MAX_LEN])
    }
}

fn is_gemini_auth_error(status_code: u16, body: &str) -> bool {
    matches!(status_code, 401 | 403)
        || body.contains("API_KEY_INVALID")
        || body.contains("API key not valid")
}

fn resolve_model_for_provider(provider: ProviderType, model: String) -> Result<String, String> {
    let models = get_models_for_provider(provider);
    let trimmed = model.trim();
    let normalized_model = if provider == ProviderType::Gemini {
        match trimmed {
            "gemini-3-pro" => "gemini-3.1-pro-preview",
            "gemini-3-flash" => "gemini-3-flash-preview",
            _ => trimmed,
        }
    } else {
        trimmed
    };

    if normalized_model.is_empty() {
        return models
            .iter()
            .find(|m| m.is_default)
            .or_else(|| models.first())
            .map(|m| m.id.clone())
            .ok_or_else(|| format!("No models configured for {}", provider.as_str()));
    }

    let needle = normalized_model.to_ascii_lowercase();
    models
        .iter()
        .find(|m| m.id.to_ascii_lowercase() == needle || m.alias.to_ascii_lowercase() == needle)
        .map(|m| m.id.clone())
        .ok_or_else(|| format!("{} is not a configured {} model", model, provider.as_str()))
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
pub async fn get_active_provider(state: State<'_, ProviderAuthState>) -> Result<String, String> {
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

    // Validate the key against the provider's API before storing it.
    // Transient errors (5xx, network) do NOT block — see validate_api_key_http.
    solo_auth::CredentialManager::validate_api_key_http(provider_type, &api_key)
        .await
        .map_err(|e| e.to_string())?;

    state
        .credentials
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

    state
        .credentials
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
            max_output_tokens: m.capabilities.max_output_tokens,
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
            max_output_tokens: m.capabilities.max_output_tokens,
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

    state
        .credentials
        .get_auth_method_info(provider_type)
        .await
        .map_err(|e| e.to_string())
}

/// Auth-check an API key WITHOUT storing it.
///
/// Returns Ok(()) if the key is accepted by the provider. Useful for
/// "Test connection" buttons; also called internally before
/// `set_credentials` persists the key.
#[tauri::command]
pub async fn validate_api_key(provider: String, api_key: String) -> Result<(), String> {
    debug!(provider = %provider, "Validating API key");
    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;
    solo_auth::CredentialManager::validate_api_key_http(provider_type, &api_key)
        .await
        .map_err(|e| e.to_string())
}

/// Verify that a provider is authenticated and can reach a selected model.
#[tauri::command]
pub async fn verify_provider_model(
    provider: String,
    model: String,
    state: State<'_, ProviderAuthState>,
) -> Result<ProviderModelDiagnosticResponse, String> {
    info!(provider = %provider, model = %model, "Verifying provider model");

    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;
    let model_id = resolve_model_for_provider(provider_type, model)?;

    // External sign-in tools can change credentials while Solo is open.
    state.credentials.clear_cache().await;

    let started = Instant::now();
    let credential_info = match state
        .credentials
        .get_credentials_with_source(provider_type)
        .await
        .map_err(|e| e.to_string())?
    {
        Some(info) => info,
        None => {
            return Ok(ProviderModelDiagnosticResponse {
                provider: provider_type,
                model: model_id,
                ok: false,
                authenticated: false,
                credential_source: None,
                status: "error".to_string(),
                message: format!(
                    "No credentials configured for {}",
                    provider_type.display_name()
                ),
                latency_ms: None,
                error: None,
            });
        }
    };

    let source = credential_info.source;
    let source_label = Some(source.to_string());

    if provider_type == ProviderType::Anthropic
        && matches!(
            source,
            CredentialSource::ClaudeOAuth | CredentialSource::ClaudeOAuthFile
        )
    {
        let cli_path = find_claude_cli();
        return Ok(ProviderModelDiagnosticResponse {
            provider: provider_type,
            model: model_id.clone(),
            ok: cli_path.is_some(),
            authenticated: true,
            credential_source: source_label,
            status: if cli_path.is_some() { "ok" } else { "error" }.to_string(),
            message: if let Some(path) = cli_path {
                format!(
                    "{} is available through Claude Code CLI at {}",
                    model_id,
                    path.to_string_lossy()
                )
            } else {
                "Claude Code credentials were found, but the Claude CLI is not installed"
                    .to_string()
            },
            latency_ms: Some(started.elapsed().as_millis() as u64),
            error: None,
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("HTTP client: {}", e))?;

    let request = match provider_type {
        ProviderType::OpenAI => {
            let uses_chatgpt_backend = matches!(
                source,
                CredentialSource::SoloOAuth | CredentialSource::CodexOAuthFile
            );
            let url = if uses_chatgpt_backend {
                "https://chatgpt.com/backend-api/codex/responses"
            } else {
                "https://api.openai.com/v1/responses"
            };
            let body = if uses_chatgpt_backend {
                serde_json::json!({
                    "model": model_id.clone(),
                    "instructions": "You are Solo. Reply directly and concisely.",
                    "input": [{
                        "role": "user",
                        "content": [{ "type": "input_text", "text": "Reply with ok." }],
                    }],
                    "stream": true,
                    "store": false,
                    "tools": [],
                })
            } else {
                serde_json::json!({
                    "model": model_id.clone(),
                    "input": "Reply with ok.",
                    "max_output_tokens": 8,
                    "tools": [],
                })
            };
            let mut req = client
                .post(url)
                .bearer_auth(&credential_info.api_key)
                .header("content-type", "application/json")
                .json(&body);

            if uses_chatgpt_backend {
                if let Some(account_id) = state
                    .credentials
                    .get_openai_account_id()
                    .await
                    .map_err(|e| e.to_string())?
                {
                    req = req.header("ChatGPT-Account-Id", account_id);
                }
            }

            req
        }
        ProviderType::Anthropic => {
            let mut req = client
                .post("https://api.anthropic.com/v1/messages")
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&serde_json::json!({
                    "model": model_id.clone(),
                    "max_tokens": 8,
                    "messages": [{ "role": "user", "content": "Reply with ok." }],
                }));

            if source == CredentialSource::SoloOAuth {
                req = req
                    .bearer_auth(&credential_info.api_key)
                    .header("anthropic-beta", "oauth-2025-04-20");
            } else {
                req = req.header("x-api-key", &credential_info.api_key);
            }

            req
        }
        ProviderType::Gemini => client
            .post(format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                model_id
            ))
            .query(&[("key", &credential_info.api_key)])
            .header("content-type", "application/json")
            .json(&serde_json::json!({
                "contents": [{ "role": "user", "parts": [{ "text": "Reply with ok." }] }],
                "generationConfig": { "maxOutputTokens": 8 },
            })),
    };

    let resp = request
        .send()
        .await
        .map_err(|e| format!("Network error while checking {}: {}", model_id, e))?;

    let status_code = resp.status();
    let latency_ms = started.elapsed().as_millis() as u64;
    let ok = status_code.is_success();
    let body = if ok {
        String::new()
    } else {
        truncate_response_body(&resp.text().await.unwrap_or_default())
    };
    let auth_failed = if provider_type == ProviderType::Gemini {
        is_gemini_auth_error(status_code.as_u16(), &body)
    } else {
        matches!(status_code.as_u16(), 401 | 403)
    };

    Ok(ProviderModelDiagnosticResponse {
        provider: provider_type,
        model: model_id.clone(),
        ok,
        authenticated: ok || !auth_failed,
        credential_source: source_label,
        status: if ok { "ok" } else { "error" }.to_string(),
        message: if ok {
            format!("{} responded successfully", model_id)
        } else if auth_failed {
            format!("Authentication failed for {}", provider_type.display_name())
        } else {
            format!("{} returned HTTP {}", model_id, status_code.as_u16())
        },
        latency_ms: Some(latency_ms),
        error: (!ok).then_some(body).filter(|value| !value.is_empty()),
    })
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
        ProviderType::OpenAI => OpenAIOAuthConfig::build_auth_url().map_err(|e| e.to_string())?,
        ProviderType::Gemini => {
            return Err(format!(
                "{} does not support OAuth",
                provider_type.display_name()
            ));
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
    state: State<'_, ProviderAuthState>,
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
            return Err(format!(
                "{} does not support OAuth",
                provider_type.display_name()
            ));
        }
    }

    info!(provider = %provider_type.as_str(), "OAuth flow completed successfully");

    Ok(())
}

/// Wait for OAuth callback from browser (starts a local HTTP server).
/// The expected_state parameter is validated against the callback's state
/// to prevent CSRF attacks. The provider argument selects the port the
/// server binds to — some providers (OpenAI/Codex) have their OAuth app
/// registered against a specific localhost port, so we must match it
/// exactly or auth.openai.com returns "unknown_error".
#[tauri::command]
pub async fn wait_for_oauth_callback(
    expected_state: String,
    provider: Option<String>,
) -> Result<(String, String), String> {
    let provider_str = provider.as_deref().unwrap_or("");
    info!(provider = %provider_str, "Waiting for OAuth callback");

    let result = match provider_str {
        "openai" => {
            start_callback_server_on(&expected_state, None, OpenAIOAuthConfig::CALLBACK_PORT).await
        }
        _ => start_callback_server(&expected_state, None).await,
    }
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

    state
        .credentials
        .disconnect_oauth(provider_type)
        .await
        .map_err(|e| e.to_string())
}

// =============================================================================
// Profile Management Commands
// =============================================================================

use solo_auth::credentials::ProfileSummary;

/// List OAuth profiles for a provider.
#[tauri::command]
pub async fn list_profiles(
    provider: String,
    state: State<'_, ProviderAuthState>,
) -> Result<Vec<ProfileSummary>, String> {
    debug!(provider = %provider, "Listing profiles");
    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;
    state
        .credentials
        .list_profiles(provider_type)
        .await
        .map_err(|e| e.to_string())
}

/// Set the active profile for a provider.
#[tauri::command]
pub async fn set_active_profile(
    provider: String,
    profile_name: String,
    state: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    info!(provider = %provider, profile = %profile_name, "Setting active profile");
    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;
    state
        .credentials
        .set_active_profile(provider_type, &profile_name)
        .await
        .map_err(|e| e.to_string())
}

/// Remove a named profile.
#[tauri::command]
pub async fn remove_profile(
    provider: String,
    profile_name: String,
    state: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    info!(provider = %provider, profile = %profile_name, "Removing profile");
    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;
    state
        .credentials
        .remove_profile(provider_type, &profile_name)
        .await
        .map_err(|e| e.to_string())
}

/// Sign out of a specific profile. If `profile_name` is None, removes ALL
/// profiles for the provider (equivalent to disconnect_oauth).
#[tauri::command]
pub async fn sign_out_profile(
    provider: String,
    profile_name: Option<String>,
    state: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    info!(provider = %provider, profile = ?profile_name, "Signing out profile");
    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;
    match profile_name {
        Some(name) => state
            .credentials
            .remove_profile(provider_type, &name)
            .await
            .map_err(|e| e.to_string()),
        None => state
            .credentials
            .disconnect_oauth(provider_type)
            .await
            .map_err(|e| e.to_string()),
    }
}

// =============================================================================
// Claude Code CLI Commands
// =============================================================================

/// Check if Claude Code auth is complete (token exists in keychain)
#[tauri::command]
pub async fn check_claude_auth_status(state: State<'_, ProviderAuthState>) -> Result<bool, String> {
    debug!("Checking Claude Code auth status");

    // `claude /login` happens outside this process. Force a fresh read so the
    // Verify button sees credentials written after the modal was opened.
    state.credentials.clear_cache().await;

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

    Ok(find_claude_cli().is_some())
}

/// Open Terminal and run `claude /login` to trigger the native login flow
#[tauri::command]
pub async fn start_claude_login() -> Result<(), String> {
    info!("Starting Claude Code login");

    let cli_path = find_claude_cli();
    let command = claude_login_command(cli_path.as_ref());

    std::process::Command::new("osascript")
        .args([
            "-e",
            &format!(
                "tell application \"Terminal\" to do script {}",
                applescript_quote(&command)
            ),
        ])
        .spawn()
        .map_err(|e| format!("Failed to open Terminal with claude /login: {}", e))?;

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

    // Clear credential cache so we always read fresh from keychain/file
    state.credentials.clear_cache().await;

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
    if let Some(path) = find_claude_cli() {
        status.cli_installed = true;
        status.cli_path = Some(path.to_string_lossy().into_owned());
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
    status.cli_mode_available =
        status.cli_installed && status.credentials_found && !status.token_expired;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_login_command_uses_slash_login_with_resolved_path() {
        let path = PathBuf::from("/opt/homebrew/bin/claude");

        assert_eq!(
            claude_login_command(Some(&path)),
            "'/opt/homebrew/bin/claude' /login"
        );
    }

    #[test]
    fn claude_login_command_uses_slash_login_fallback() {
        assert_eq!(claude_login_command(None), "claude /login");
    }
}
