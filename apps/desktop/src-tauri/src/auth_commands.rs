//! Supabase OAuth authentication commands for Solo IDE
//!
//! Implements PKCE OAuth flow with deep linking for desktop authentication.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use tauri::State;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};
use url::Url;

use crate::provider_commands::ProviderAuthState;

// =============================================================================
// Configuration
// =============================================================================

const REDIRECT_URL: &str = "soloide://auth/callback";
const SUPABASE_URL_ENV_KEYS: &[&str] = &["SOLO_SUPABASE_URL", "SUPABASE_URL"];
const SUPABASE_ANON_KEY_ENV_KEYS: &[&str] = &["SOLO_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"];

/// Vault key names for Supabase auth tokens
const VAULT_KEY_ACCESS_TOKEN: &str = "supabase.accessToken";
const VAULT_KEY_REFRESH_TOKEN: &str = "supabase.refreshToken";

static SUPABASE_CONFIG: OnceLock<Result<SupabaseConfig, String>> = OnceLock::new();

// =============================================================================
// Types
// =============================================================================

/// PKCE state stored during OAuth flow
#[derive(Debug, Clone)]
struct PkceState {
    verifier: String,
    challenge: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SupabaseConfig {
    url: String,
    anon_key: String,
}

/// Supabase user information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: Option<String>,
    pub user_metadata: HashMap<String, serde_json::Value>,
    pub created_at: String,
}

/// Supabase session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub expires_at: Option<i64>,
    pub token_type: String,
    pub user: User,
}

/// Auth state for frontend
#[derive(Debug, Clone, Serialize)]
pub struct AuthStateResponse {
    pub user: Option<User>,
    pub is_authenticated: bool,
}

/// Token exchange response from Supabase
#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    expires_at: Option<i64>,
    token_type: String,
    user: User,
}

/// Error response from Supabase
#[derive(Debug, Deserialize)]
struct SupabaseError {
    error: Option<String>,
    error_description: Option<String>,
    message: Option<String>,
}

// =============================================================================
// Auth State
// =============================================================================

/// Application state for authentication
pub struct AuthState {
    /// Current PKCE state (during OAuth flow)
    pkce: Arc<RwLock<Option<PkceState>>>,
    /// Cached session
    session: Arc<RwLock<Option<Session>>>,
    /// HTTP client for API requests
    client: reqwest::Client,
}

impl AuthState {
    pub fn new() -> Self {
        Self {
            pkce: Arc::new(RwLock::new(None)),
            session: Arc::new(RwLock::new(None)),
            client: reqwest::Client::new(),
        }
    }

    /// Generate PKCE verifier and challenge
    fn generate_pkce() -> PkceState {
        let mut rng = rand::thread_rng();

        // Generate 32-byte random verifier
        let verifier_bytes: [u8; 32] = rng.gen();
        let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);

        // SHA256 hash and base64url encode for challenge
        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let hash = hasher.finalize();
        let challenge = URL_SAFE_NO_PAD.encode(hash);

        PkceState {
            verifier,
            challenge,
        }
    }
}

impl Default for AuthState {
    fn default() -> Self {
        Self::new()
    }
}

fn read_env(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        std::env::var(key)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn normalize_supabase_url(raw_url: &str) -> Result<String, String> {
    let trimmed = raw_url.trim().trim_end_matches('/');
    let parsed =
        Url::parse(trimmed).map_err(|err| format!("Invalid Supabase URL `{trimmed}`: {err}"))?;

    if parsed.scheme() != "https" {
        return Err(format!(
            "Invalid Supabase URL `{trimmed}`: expected an https URL"
        ));
    }

    if parsed.host_str().is_none() {
        return Err(format!("Invalid Supabase URL `{trimmed}`: missing host"));
    }

    Ok(trimmed.to_string())
}

fn resolve_supabase_config(
    compile_time_url: Option<&str>,
    compile_time_anon_key: Option<&str>,
    runtime_url: Option<String>,
    runtime_anon_key: Option<String>,
) -> Result<SupabaseConfig, String> {
    let url = compile_time_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or(runtime_url)
        .ok_or_else(|| {
            format!(
                "Desktop auth is not configured. Set {} before building the app.",
                SUPABASE_URL_ENV_KEYS.join(" or ")
            )
        })?;

    let anon_key = compile_time_anon_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or(runtime_anon_key)
        .ok_or_else(|| {
            format!(
                "Desktop auth is not configured. Set {} before building the app.",
                SUPABASE_ANON_KEY_ENV_KEYS.join(" or ")
            )
        })?;

    Ok(SupabaseConfig {
        url: normalize_supabase_url(&url)?,
        anon_key,
    })
}

fn load_supabase_config() -> Result<SupabaseConfig, String> {
    resolve_supabase_config(
        option_env!("SOLO_SUPABASE_URL").or(option_env!("SUPABASE_URL")),
        option_env!("SOLO_SUPABASE_ANON_KEY").or(option_env!("SUPABASE_ANON_KEY")),
        read_env(SUPABASE_URL_ENV_KEYS),
        read_env(SUPABASE_ANON_KEY_ENV_KEYS),
    )
}

fn supabase_config() -> Result<&'static SupabaseConfig, String> {
    match SUPABASE_CONFIG.get_or_init(load_supabase_config) {
        Ok(config) => Ok(config),
        Err(error) => Err(error.clone()),
    }
}

// =============================================================================
// Vault Helpers (delegate to CredentialManager)
// =============================================================================

/// Read a value from the credential vault
async fn vault_read(auth: &ProviderAuthState, key: &str) -> Option<String> {
    auth.credentials.vault_get_raw(key).await.ok().flatten()
}

/// Write a value to the credential vault
async fn vault_write(auth: &ProviderAuthState, key: &str, value: &str) -> Result<(), String> {
    auth.credentials
        .vault_set_raw(key, value)
        .await
        .map_err(|e| format!("Failed to write to vault: {}", e))
}

/// Delete a value from the credential vault
async fn vault_delete_key(auth: &ProviderAuthState, key: &str) -> Result<(), String> {
    auth.credentials
        .vault_delete_raw(key)
        .await
        .map_err(|e| format!("Failed to delete from vault: {}", e))
}

// =============================================================================
// Commands
// =============================================================================

/// Start OAuth flow - returns URL to open in browser
#[tauri::command]
pub async fn auth_start_oauth(
    provider: String,
    state: State<'_, AuthState>,
) -> Result<String, String> {
    info!(provider = %provider, "Starting OAuth flow");
    let config = supabase_config()?;

    // Validate provider
    if provider != "github" {
        return Err(format!("Unsupported OAuth provider: {}", provider));
    }

    // Generate PKCE codes
    let pkce = AuthState::generate_pkce();

    // Build OAuth URL - let Supabase handle state internally
    let auth_url = format!(
        "{}/auth/v1/authorize?provider={}&redirect_to={}&code_challenge={}&code_challenge_method=S256",
        config.url,
        provider,
        urlencoding::encode(REDIRECT_URL),
        pkce.challenge
    );

    // Store PKCE state for later verification
    *state.pkce.write().await = Some(pkce);

    info!(url = %auth_url, "Generated OAuth URL - opening in browser");
    Ok(auth_url)
}

/// Send magic link email
#[tauri::command]
pub async fn auth_start_magic_link(
    email: String,
    state: State<'_, AuthState>,
) -> Result<(), String> {
    info!(email = %email, "Sending magic link");
    let config = supabase_config()?;

    // Generate PKCE codes for magic link flow
    let pkce = AuthState::generate_pkce();

    let response = state
        .client
        .post(format!("{}/auth/v1/otp", config.url))
        .header("apikey", &config.anon_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "email": email,
            "options": {
                "emailRedirectTo": REDIRECT_URL,
                "shouldCreateUser": true
            }
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to send magic link: {}", e))?;

    if response.status().is_success() {
        // Store PKCE state for token exchange
        *state.pkce.write().await = Some(pkce);
        info!("Magic link sent successfully");
        Ok(())
    } else {
        let error: SupabaseError = response.json().await.unwrap_or(SupabaseError {
            error: Some("Unknown error".to_string()),
            error_description: None,
            message: None,
        });
        Err(error
            .message
            .or(error.error_description)
            .or(error.error)
            .unwrap_or_else(|| "Failed to send magic link".to_string()))
    }
}

/// Exchange authorization code for session tokens
#[tauri::command]
pub async fn auth_exchange_code(
    code: String,
    state: State<'_, AuthState>,
    auth: State<'_, ProviderAuthState>,
) -> Result<AuthStateResponse, String> {
    let config = supabase_config()?;
    info!(
        "Exchanging authorization code for tokens, code={}",
        &code[..8]
    );

    // Get PKCE verifier
    let pkce = match state.pkce.read().await.clone() {
        Some(p) => {
            info!("Found PKCE verifier");
            p
        }
        None => {
            warn!("No PKCE state found - OAuth flow not initiated from this app instance");
            return Err("No pending OAuth flow - please try signing in again".to_string());
        }
    };

    info!("Sending token exchange request to Supabase...");

    // Exchange code for tokens using Supabase's non-standard parameter name
    // Note: Supabase GoTrue uses "auth_code" instead of standard OAuth2 "code"
    // See: https://github.com/supabase/auth/issues/2306
    let response = state
        .client
        .post(format!("{}/auth/v1/token?grant_type=pkce", config.url))
        .header("apikey", &config.anon_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "auth_code": code,
            "code_verifier": pkce.verifier,
        }))
        .send()
        .await
        .map_err(|e| {
            warn!("HTTP request failed: {}", e);
            format!("Failed to exchange code: {}", e)
        })?;

    info!("Received response with status: {}", response.status());

    if response.status().is_success() {
        let token_response: TokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?;

        // Store tokens in vault
        vault_write(&auth, VAULT_KEY_ACCESS_TOKEN, &token_response.access_token).await?;
        vault_write(
            &auth,
            VAULT_KEY_REFRESH_TOKEN,
            &token_response.refresh_token,
        )
        .await?;

        // Create session
        let session = Session {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token,
            expires_in: token_response.expires_in,
            expires_at: token_response.expires_at,
            token_type: token_response.token_type,
            user: token_response.user.clone(),
        };

        // Cache session
        *state.session.write().await = Some(session);

        // Clear PKCE state
        *state.pkce.write().await = None;

        info!(user_id = %token_response.user.id, "Authentication successful");

        Ok(AuthStateResponse {
            user: Some(token_response.user),
            is_authenticated: true,
        })
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        warn!("Token exchange failed with status {}: {}", status, body);

        let error: SupabaseError = serde_json::from_str(&body).unwrap_or(SupabaseError {
            error: Some(format!("HTTP {}", status)),
            error_description: Some(body),
            message: None,
        });

        // Clear PKCE state on error
        *state.pkce.write().await = None;

        let error_msg = error
            .message
            .or(error.error_description)
            .or(error.error)
            .unwrap_or_else(|| "Failed to exchange code".to_string());
        warn!("Auth error: {}", error_msg);
        Err(error_msg)
    }
}

/// Get current session (restores from vault if needed)
#[tauri::command]
pub async fn auth_get_session(
    state: State<'_, AuthState>,
    auth: State<'_, ProviderAuthState>,
) -> Result<AuthStateResponse, String> {
    debug!("Getting current session");

    // Check cached session first
    if let Some(session) = state.session.read().await.as_ref() {
        return Ok(AuthStateResponse {
            user: Some(session.user.clone()),
            is_authenticated: true,
        });
    }

    // Try to restore from vault
    let access_token = match vault_read(&auth, VAULT_KEY_ACCESS_TOKEN).await {
        Some(token) => token,
        None => {
            debug!("No stored session found");
            return Ok(AuthStateResponse {
                user: None,
                is_authenticated: false,
            });
        }
    };

    let refresh_token = vault_read(&auth, VAULT_KEY_REFRESH_TOKEN).await;
    let config = supabase_config()?;

    // Validate token by getting user info
    let response = state
        .client
        .get(format!("{}/auth/v1/user", config.url))
        .header("apikey", &config.anon_key)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to get user: {}", e))?;

    if response.status().is_success() {
        let user: User = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse user: {}", e))?;

        // Create session
        let session = Session {
            access_token,
            refresh_token: refresh_token.unwrap_or_default(),
            expires_in: 0, // Unknown from restore
            expires_at: None,
            token_type: "bearer".to_string(),
            user: user.clone(),
        };

        *state.session.write().await = Some(session);

        Ok(AuthStateResponse {
            user: Some(user),
            is_authenticated: true,
        })
    } else if response.status() == 401 {
        // Token expired, try refresh
        if let Some(refresh) = refresh_token {
            return refresh_session_internal(&state, &auth, &refresh).await;
        }

        // No refresh token, clear invalid tokens
        let _ = vault_delete_key(&auth, VAULT_KEY_ACCESS_TOKEN).await;
        let _ = vault_delete_key(&auth, VAULT_KEY_REFRESH_TOKEN).await;

        Ok(AuthStateResponse {
            user: None,
            is_authenticated: false,
        })
    } else {
        warn!("Failed to validate token");
        Ok(AuthStateResponse {
            user: None,
            is_authenticated: false,
        })
    }
}

/// Refresh the session using refresh token
#[tauri::command]
pub async fn auth_refresh_session(
    state: State<'_, AuthState>,
    auth: State<'_, ProviderAuthState>,
) -> Result<AuthStateResponse, String> {
    info!("Refreshing session");

    let refresh_token = vault_read(&auth, VAULT_KEY_REFRESH_TOKEN)
        .await
        .ok_or("No refresh token available")?;

    refresh_session_internal(&state, &auth, &refresh_token).await
}

/// Internal function to refresh session
async fn refresh_session_internal(
    state: &State<'_, AuthState>,
    auth: &State<'_, ProviderAuthState>,
    refresh_token: &str,
) -> Result<AuthStateResponse, String> {
    let config = supabase_config()?;
    let response = state
        .client
        .post(format!("{}/auth/v1/token", config.url))
        .header("apikey", &config.anon_key)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to refresh token: {}", e))?;

    if response.status().is_success() {
        let token_response: TokenResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

        // Store new tokens in vault
        vault_write(auth, VAULT_KEY_ACCESS_TOKEN, &token_response.access_token).await?;
        vault_write(auth, VAULT_KEY_REFRESH_TOKEN, &token_response.refresh_token).await?;

        let session = Session {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token,
            expires_in: token_response.expires_in,
            expires_at: token_response.expires_at,
            token_type: token_response.token_type,
            user: token_response.user.clone(),
        };

        *state.session.write().await = Some(session);

        info!("Session refreshed successfully");
        Ok(AuthStateResponse {
            user: Some(token_response.user),
            is_authenticated: true,
        })
    } else {
        // Refresh failed, clear tokens
        let _ = vault_delete_key(auth, VAULT_KEY_ACCESS_TOKEN).await;
        let _ = vault_delete_key(auth, VAULT_KEY_REFRESH_TOKEN).await;
        *state.session.write().await = None;

        Err("Session expired, please sign in again".to_string())
    }
}

/// Sign out - clear session and tokens
#[tauri::command]
pub async fn auth_sign_out(
    state: State<'_, AuthState>,
    auth: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    info!("Signing out");
    let config = supabase_config()?;

    // Try to call Supabase logout (best effort)
    if let Some(session) = state.session.read().await.as_ref() {
        let _ = state
            .client
            .post(format!("{}/auth/v1/logout", config.url))
            .header("apikey", &config.anon_key)
            .header("Authorization", format!("Bearer {}", session.access_token))
            .send()
            .await;
    }

    // Clear vault entries
    vault_delete_key(&auth, VAULT_KEY_ACCESS_TOKEN).await?;
    vault_delete_key(&auth, VAULT_KEY_REFRESH_TOKEN).await?;

    // Clear cached session
    *state.session.write().await = None;

    info!("Signed out successfully");
    Ok(())
}

/// Get the current access token (for API calls)
#[tauri::command]
pub async fn auth_get_access_token(
    state: State<'_, AuthState>,
    auth: State<'_, ProviderAuthState>,
) -> Result<Option<String>, String> {
    if let Some(session) = state.session.read().await.as_ref() {
        return Ok(Some(session.access_token.clone()));
    }

    // Try vault
    Ok(vault_read(&auth, VAULT_KEY_ACCESS_TOKEN).await)
}

#[cfg(test)]
mod tests {
    use super::resolve_supabase_config;

    #[test]
    fn uses_compile_time_values_when_present() {
        let config = resolve_supabase_config(
            Some("https://example.supabase.co/"),
            Some("anon-key"),
            Some("https://runtime.supabase.co".to_string()),
            Some("runtime-key".to_string()),
        )
        .unwrap();

        assert_eq!(config.url, "https://example.supabase.co");
        assert_eq!(config.anon_key, "anon-key");
    }

    #[test]
    fn falls_back_to_runtime_values() {
        let config = resolve_supabase_config(
            None,
            None,
            Some("https://runtime.supabase.co".to_string()),
            Some("runtime-key".to_string()),
        )
        .unwrap();

        assert_eq!(config.url, "https://runtime.supabase.co");
        assert_eq!(config.anon_key, "runtime-key");
    }

    #[test]
    fn rejects_invalid_supabase_url() {
        let error = resolve_supabase_config(
            Some("http://example.supabase.co"),
            Some("anon-key"),
            None,
            None,
        )
        .unwrap_err();

        assert!(error.contains("expected an https URL"));
    }
}
