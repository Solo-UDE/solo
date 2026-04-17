//! AWS Cognito OAuth authentication commands for Solo IDE.
//!
//! Implements PKCE OAuth flow with deep linking for desktop authentication
//! against an AWS Cognito User Pool. Federates Google and GitHub (via the
//! solo-ide GitHub OIDC wrapper); email/password also supported via the
//! Cognito Hosted UI.

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

fn now_epoch_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// =============================================================================
// Configuration
// =============================================================================

const REDIRECT_URL: &str = "soloide://auth/callback";
const SIGNOUT_URL: &str = "soloide://auth/signout";

const COGNITO_DOMAIN_ENV_KEYS: &[&str] = &["SOLO_COGNITO_DOMAIN"];
const COGNITO_CLIENT_ID_ENV_KEYS: &[&str] = &["SOLO_COGNITO_CLIENT_ID"];
const COGNITO_REGION_ENV_KEYS: &[&str] = &["SOLO_AWS_REGION", "AWS_REGION"];

/// Vault keys — `cognito.*` per the Supabase→Cognito migration.
const VAULT_KEY_ACCESS_TOKEN: &str = "cognito.accessToken";
const VAULT_KEY_REFRESH_TOKEN: &str = "cognito.refreshToken";
const VAULT_KEY_ID_TOKEN: &str = "cognito.idToken";

static COGNITO_CONFIG: OnceLock<Result<CognitoConfig, String>> = OnceLock::new();

// =============================================================================
// Types
// =============================================================================

/// PKCE state stored during OAuth flow.
#[derive(Debug, Clone)]
struct PkceState {
    verifier: String,
    challenge: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CognitoConfig {
    /// Fully-qualified Cognito domain, e.g. `solo-ide-dev.auth.us-east-1.amazoncognito.com`.
    /// Does NOT include the scheme; scheme is always `https`.
    domain: String,
    client_id: String,
    #[allow(dead_code)]
    region: String,
}

impl CognitoConfig {
    fn base_url(&self) -> String {
        format!("https://{}", self.domain)
    }
}

/// User information — same shape as the Supabase-era struct for frontend
/// compatibility. `id` holds Cognito's `sub`; `user_metadata` absorbs other
/// standard OIDC claims like `name`, `picture`, `preferred_username`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: Option<String>,
    pub user_metadata: HashMap<String, serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub expires_at: Option<i64>,
    pub token_type: String,
    pub user: User,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthStateResponse {
    pub user: Option<User>,
    pub is_authenticated: bool,
}

/// Token exchange response from Cognito (`POST /oauth2/token`).
#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    /// Refresh token is only returned on the initial authorization-code
    /// exchange, not on refresh-token grant responses.
    #[serde(default)]
    refresh_token: Option<String>,
    id_token: String,
    expires_in: i64,
    token_type: String,
}

/// Standard OIDC userInfo response (`GET /oauth2/userInfo`).
#[derive(Debug, Deserialize)]
struct UserInfoResponse {
    sub: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    email_verified: Option<serde_json::Value>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    preferred_username: Option<String>,
    #[serde(default)]
    picture: Option<String>,
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

/// Error response from Cognito (`application/json`).
#[derive(Debug, Deserialize)]
struct CognitoError {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

// =============================================================================
// Auth State
// =============================================================================

pub struct AuthState {
    pkce: Arc<RwLock<Option<PkceState>>>,
    session: Arc<RwLock<Option<Session>>>,
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

    fn generate_pkce() -> PkceState {
        let mut rng = rand::thread_rng();
        let verifier_bytes: [u8; 32] = rng.gen();
        let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);

        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
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

fn normalize_cognito_domain(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let candidate = if trimmed.starts_with("https://") {
        trimmed.trim_start_matches("https://").to_string()
    } else if trimmed.starts_with("http://") {
        return Err(format!(
            "Invalid Cognito domain `{trimmed}`: must be https, not http"
        ));
    } else {
        trimmed.to_string()
    };

    let probe = format!("https://{}", candidate);
    let parsed = Url::parse(&probe)
        .map_err(|err| format!("Invalid Cognito domain `{candidate}`: {err}"))?;
    if parsed.host_str().is_none() {
        return Err(format!("Invalid Cognito domain `{candidate}`: missing host"));
    }
    if !candidate.contains(".amazoncognito.com") && !candidate.contains(".") {
        return Err(format!(
            "Invalid Cognito domain `{candidate}`: expected a fully-qualified hostname"
        ));
    }
    Ok(candidate)
}

fn resolve_cognito_config(
    compile_domain: Option<&str>,
    compile_client_id: Option<&str>,
    compile_region: Option<&str>,
    runtime_domain: Option<String>,
    runtime_client_id: Option<String>,
    runtime_region: Option<String>,
) -> Result<CognitoConfig, String> {
    let domain = compile_domain
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or(runtime_domain)
        .ok_or_else(|| {
            format!(
                "Desktop auth is not configured. Set {} before building the app.",
                COGNITO_DOMAIN_ENV_KEYS.join(" or ")
            )
        })?;

    let client_id = compile_client_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or(runtime_client_id)
        .ok_or_else(|| {
            format!(
                "Desktop auth is not configured. Set {} before building the app.",
                COGNITO_CLIENT_ID_ENV_KEYS.join(" or ")
            )
        })?;

    let region = compile_region
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or(runtime_region)
        .unwrap_or_else(|| "us-east-1".to_string());

    Ok(CognitoConfig {
        domain: normalize_cognito_domain(&domain)?,
        client_id,
        region,
    })
}

fn load_cognito_config() -> Result<CognitoConfig, String> {
    resolve_cognito_config(
        option_env!("SOLO_COGNITO_DOMAIN"),
        option_env!("SOLO_COGNITO_CLIENT_ID"),
        option_env!("SOLO_AWS_REGION"),
        read_env(COGNITO_DOMAIN_ENV_KEYS),
        read_env(COGNITO_CLIENT_ID_ENV_KEYS),
        read_env(COGNITO_REGION_ENV_KEYS),
    )
}

fn cognito_config() -> Result<&'static CognitoConfig, String> {
    match COGNITO_CONFIG.get_or_init(load_cognito_config) {
        Ok(cfg) => Ok(cfg),
        Err(error) => Err(error.clone()),
    }
}

/// Maps a caller-facing provider string to the Cognito IdP name (or None for
/// email/password via the Hosted UI). Accepted inputs are case-insensitive.
fn cognito_identity_provider(provider: &str) -> Result<Option<&'static str>, String> {
    match provider.to_ascii_lowercase().as_str() {
        "google" => Ok(Some("Google")),
        "github" => Ok(Some("GitHub")),
        "email" | "" | "cognito" => Ok(None),
        other => Err(format!("Unsupported OAuth provider: {}", other)),
    }
}

// =============================================================================
// Vault helpers
// =============================================================================

async fn vault_read(auth: &ProviderAuthState, key: &str) -> Option<String> {
    auth.credentials.vault_get_raw(key).await.ok().flatten()
}

async fn vault_write(auth: &ProviderAuthState, key: &str, value: &str) -> Result<(), String> {
    auth.credentials
        .vault_set_raw(key, value)
        .await
        .map_err(|e| format!("Failed to write to vault: {}", e))
}

async fn vault_delete_key(auth: &ProviderAuthState, key: &str) -> Result<(), String> {
    auth.credentials
        .vault_delete_raw(key)
        .await
        .map_err(|e| format!("Failed to delete from vault: {}", e))
}

fn email_verified_as_bool(raw: &Option<serde_json::Value>) -> bool {
    match raw {
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::String(s)) => {
            let lower = s.to_ascii_lowercase();
            lower == "true" || lower == "1"
        }
        _ => false,
    }
}

fn user_from_info(info: UserInfoResponse) -> User {
    let UserInfoResponse {
        sub,
        email,
        email_verified,
        name,
        preferred_username,
        picture,
        extra,
    } = info;
    let mut metadata: HashMap<String, serde_json::Value> = extra;
    metadata.insert(
        "email_verified".to_string(),
        serde_json::Value::Bool(email_verified_as_bool(&email_verified)),
    );
    if let Some(n) = name.as_ref() {
        metadata.insert("name".to_string(), serde_json::Value::String(n.clone()));
    }
    if let Some(u) = preferred_username.as_ref() {
        metadata.insert(
            "preferred_username".to_string(),
            serde_json::Value::String(u.clone()),
        );
    }
    if let Some(p) = picture.as_ref() {
        metadata.insert(
            "avatar_url".to_string(),
            serde_json::Value::String(p.clone()),
        );
    }
    User {
        id: sub,
        email,
        user_metadata: metadata,
        created_at: String::new(),
    }
}

async fn fetch_user_info(
    client: &reqwest::Client,
    config: &CognitoConfig,
    access_token: &str,
) -> Result<User, String> {
    let resp = client
        .get(format!("{}/oauth2/userInfo", config.base_url()))
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch userInfo: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("userInfo failed ({}): {}", status, body));
    }
    let info: UserInfoResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse userInfo: {}", e))?;
    Ok(user_from_info(info))
}

// =============================================================================
// Commands
// =============================================================================

/// Start OAuth flow. Returns the URL the frontend should open in the browser.
/// `provider` accepts `google`, `github`, or `email` (also `cognito` / empty
/// string) to route through the Cognito Hosted UI for email+password.
#[tauri::command]
pub async fn auth_start_oauth(
    provider: String,
    state: State<'_, AuthState>,
) -> Result<String, String> {
    info!(provider = %provider, "Starting OAuth flow");
    let config = cognito_config()?;
    let idp = cognito_identity_provider(&provider)?;

    let pkce = AuthState::generate_pkce();

    let mut url = Url::parse(&format!("{}/oauth2/authorize", config.base_url()))
        .map_err(|e| format!("Failed to build authorize URL: {}", e))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", &config.client_id);
        q.append_pair("redirect_uri", REDIRECT_URL);
        q.append_pair("scope", "openid email profile");
        q.append_pair("code_challenge", &pkce.challenge);
        q.append_pair("code_challenge_method", "S256");
        if let Some(provider_name) = idp {
            q.append_pair("identity_provider", provider_name);
        }
    }

    *state.pkce.write().await = Some(pkce);

    info!(url = %url, "Generated OAuth URL - opening in browser");
    Ok(url.to_string())
}

/// Backwards-compatible stub. Magic links aren't native to Cognito; instead
/// we open the Hosted UI email/password signup page with the address pre-filled
/// via `login_hint`.
#[tauri::command]
pub async fn auth_start_magic_link(
    email: String,
    state: State<'_, AuthState>,
) -> Result<String, String> {
    info!(email = %email, "Opening email signin (Cognito Hosted UI)");
    let config = cognito_config()?;
    let pkce = AuthState::generate_pkce();

    let mut url = Url::parse(&format!("{}/oauth2/authorize", config.base_url()))
        .map_err(|e| format!("Failed to build authorize URL: {}", e))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", &config.client_id);
        q.append_pair("redirect_uri", REDIRECT_URL);
        q.append_pair("scope", "openid email profile");
        q.append_pair("code_challenge", &pkce.challenge);
        q.append_pair("code_challenge_method", "S256");
        q.append_pair("login_hint", &email);
    }

    *state.pkce.write().await = Some(pkce);
    Ok(url.to_string())
}

/// Exchange authorization code for session tokens.
#[tauri::command]
pub async fn auth_exchange_code(
    code: String,
    state: State<'_, AuthState>,
    auth: State<'_, ProviderAuthState>,
) -> Result<AuthStateResponse, String> {
    let config = cognito_config()?;
    info!(
        "Exchanging authorization code for tokens, code={}",
        &code[..code.len().min(8)]
    );

    let pkce = match state.pkce.read().await.clone() {
        Some(p) => p,
        None => {
            warn!("No PKCE state found — OAuth flow not initiated from this app instance");
            return Err("No pending OAuth flow — please try signing in again".to_string());
        }
    };

    let response = state
        .client
        .post(format!("{}/oauth2/token", config.base_url()))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", config.client_id.as_str()),
            ("code", code.as_str()),
            ("redirect_uri", REDIRECT_URL),
            ("code_verifier", pkce.verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| {
            warn!("HTTP request failed: {}", e);
            format!("Failed to exchange code: {}", e)
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        warn!("Token exchange failed with status {}: {}", status, body);
        let error: CognitoError = serde_json::from_str(&body).unwrap_or(CognitoError {
            error: Some(format!("HTTP {}", status)),
            error_description: Some(body.clone()),
            message: None,
        });
        *state.pkce.write().await = None;
        let msg = error
            .message
            .or(error.error_description)
            .or(error.error)
            .unwrap_or_else(|| "Failed to exchange code".to_string());
        return Err(msg);
    }

    let tokens: TokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    let refresh_token = tokens
        .refresh_token
        .clone()
        .ok_or_else(|| "Cognito did not return a refresh_token".to_string())?;

    let user = fetch_user_info(&state.client, config, &tokens.access_token).await?;

    vault_write(&auth, VAULT_KEY_ACCESS_TOKEN, &tokens.access_token).await?;
    vault_write(&auth, VAULT_KEY_REFRESH_TOKEN, &refresh_token).await?;
    vault_write(&auth, VAULT_KEY_ID_TOKEN, &tokens.id_token).await?;

    let session = Session {
        access_token: tokens.access_token,
        refresh_token,
        expires_in: tokens.expires_in,
        expires_at: Some(now_epoch_secs() + tokens.expires_in),
        token_type: tokens.token_type,
        user: user.clone(),
    };

    *state.session.write().await = Some(session);
    *state.pkce.write().await = None;

    info!(user_id = %user.id, "Authentication successful");
    Ok(AuthStateResponse {
        user: Some(user),
        is_authenticated: true,
    })
}

/// Get current session — restores from vault if needed, refreshes on expiry.
#[tauri::command]
pub async fn auth_get_session(
    state: State<'_, AuthState>,
    auth: State<'_, ProviderAuthState>,
) -> Result<AuthStateResponse, String> {
    debug!("Getting current session");

    if let Some(session) = state.session.read().await.as_ref() {
        return Ok(AuthStateResponse {
            user: Some(session.user.clone()),
            is_authenticated: true,
        });
    }

    let access_token = match vault_read(&auth, VAULT_KEY_ACCESS_TOKEN).await {
        Some(t) => t,
        None => {
            debug!("No stored session found");
            return Ok(AuthStateResponse {
                user: None,
                is_authenticated: false,
            });
        }
    };
    let refresh_token = vault_read(&auth, VAULT_KEY_REFRESH_TOKEN).await;

    match fetch_user_info(&state.client, cognito_config()?, &access_token).await {
        Ok(user) => {
            let session = Session {
                access_token,
                refresh_token: refresh_token.clone().unwrap_or_default(),
                expires_in: 0,
                expires_at: None,
                token_type: "Bearer".to_string(),
                user: user.clone(),
            };
            *state.session.write().await = Some(session);
            Ok(AuthStateResponse {
                user: Some(user),
                is_authenticated: true,
            })
        }
        Err(err) => {
            warn!("userInfo probe failed: {}", err);
            if let Some(refresh) = refresh_token {
                return refresh_session_internal(&state, &auth, &refresh).await;
            }
            let _ = vault_delete_key(&auth, VAULT_KEY_ACCESS_TOKEN).await;
            let _ = vault_delete_key(&auth, VAULT_KEY_REFRESH_TOKEN).await;
            let _ = vault_delete_key(&auth, VAULT_KEY_ID_TOKEN).await;
            Ok(AuthStateResponse {
                user: None,
                is_authenticated: false,
            })
        }
    }
}

/// Refresh the current session using the stored refresh token.
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

async fn refresh_session_internal(
    state: &State<'_, AuthState>,
    auth: &State<'_, ProviderAuthState>,
    refresh_token: &str,
) -> Result<AuthStateResponse, String> {
    let config = cognito_config()?;
    let response = state
        .client
        .post(format!("{}/oauth2/token", config.base_url()))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", config.client_id.as_str()),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to refresh token: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        warn!("Refresh failed ({}): {}", status, body);
        let _ = vault_delete_key(auth, VAULT_KEY_ACCESS_TOKEN).await;
        let _ = vault_delete_key(auth, VAULT_KEY_REFRESH_TOKEN).await;
        let _ = vault_delete_key(auth, VAULT_KEY_ID_TOKEN).await;
        *state.session.write().await = None;
        return Err("Session expired, please sign in again".to_string());
    }

    let tokens: TokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    let refresh_token = tokens
        .refresh_token
        .clone()
        .unwrap_or_else(|| refresh_token.to_string());

    let user = fetch_user_info(&state.client, config, &tokens.access_token).await?;

    vault_write(auth, VAULT_KEY_ACCESS_TOKEN, &tokens.access_token).await?;
    vault_write(auth, VAULT_KEY_REFRESH_TOKEN, &refresh_token).await?;
    vault_write(auth, VAULT_KEY_ID_TOKEN, &tokens.id_token).await?;

    let session = Session {
        access_token: tokens.access_token,
        refresh_token,
        expires_in: tokens.expires_in,
        expires_at: Some(now_epoch_secs() + tokens.expires_in),
        token_type: tokens.token_type,
        user: user.clone(),
    };
    *state.session.write().await = Some(session);

    info!("Session refreshed successfully");
    Ok(AuthStateResponse {
        user: Some(user),
        is_authenticated: true,
    })
}

/// Sign out — clears local tokens and returns the Cognito logout URL when
/// available. Never fails from the caller's perspective: sign-out is a
/// *local* operation by contract — the browser hop to Cognito's hosted
/// `/logout` is a nicety to invalidate the hosted-UI cookie, but if the
/// config is missing or vault I/O errors, local state still ends up cleared.
///
/// Returns an empty string when no logout URL can be constructed; callers
/// should just skip the browser open in that case.
#[tauri::command]
pub async fn auth_sign_out(
    state: State<'_, AuthState>,
    auth: State<'_, ProviderAuthState>,
) -> Result<String, String> {
    info!("auth_sign_out: start");

    // Drop in-memory state first so any concurrent access sees a
    // "signed-out" snapshot even if the vault I/O below takes its time.
    info!("auth_sign_out: acquiring session write lock");
    {
        let mut guard = state.session.write().await;
        *guard = None;
    }
    info!("auth_sign_out: session cleared");
    info!("auth_sign_out: acquiring pkce write lock");
    {
        let mut guard = state.pkce.write().await;
        *guard = None;
    }
    info!("auth_sign_out: pkce cleared");

    for (label, key) in [
        ("access", VAULT_KEY_ACCESS_TOKEN),
        ("refresh", VAULT_KEY_REFRESH_TOKEN),
        ("id", VAULT_KEY_ID_TOKEN),
    ] {
        match vault_delete_key(&auth, key).await {
            Ok(()) => info!(token = label, "auth_sign_out: vault key deleted"),
            Err(e) => {
                // Non-fatal: missing keys are fine during sign-out. Log so
                // a real keychain failure still surfaces in telemetry.
                tracing::warn!(token = label, error = %e, "auth_sign_out: vault delete failed (ignored)");
            }
        }
    }
    info!("auth_sign_out: vault cleared");

    // Build the Cognito logout URL when possible. Missing env / bad config
    // is NOT a sign-out failure — local state is already clean. Return an
    // empty URL so the frontend can skip opening a browser.
    let logout_url = match cognito_config() {
        Ok(config) => match Url::parse(&format!("{}/logout", config.base_url())) {
            Ok(mut url) => {
                url.query_pairs_mut()
                    .append_pair("client_id", &config.client_id)
                    .append_pair("logout_uri", SIGNOUT_URL);
                let built = url.to_string();
                info!(url = %built, "auth_sign_out: built logout url");
                built
            }
            Err(e) => {
                tracing::warn!(error = %e, "auth_sign_out: failed to parse logout url; returning empty");
                String::new()
            }
        },
        Err(e) => {
            tracing::warn!(
                error = %e,
                "auth_sign_out: cognito config unavailable; skipping browser logout hop"
            );
            String::new()
        }
    };

    info!("auth_sign_out: done");
    Ok(logout_url)
}

#[tauri::command]
pub async fn auth_get_access_token(
    state: State<'_, AuthState>,
    auth: State<'_, ProviderAuthState>,
) -> Result<Option<String>, String> {
    Ok(access_token_snapshot(&state, &auth).await)
}

/// Non-command helper: returns the current access token without going through
/// the Tauri invoke layer. Used by `stats_commands` and other backend modules
/// that need to make authenticated HTTP calls on behalf of the signed-in user.
pub async fn access_token_snapshot(
    state: &State<'_, AuthState>,
    auth: &State<'_, ProviderAuthState>,
) -> Option<String> {
    if let Some(session) = state.session.read().await.as_ref() {
        return Some(session.access_token.clone());
    }
    vault_read(auth, VAULT_KEY_ACCESS_TOKEN).await
}

/// Returns the stored ID token (JWT with identity claims) — useful for
/// offline inspection of the current user without hitting Cognito.
#[tauri::command]
pub async fn auth_get_id_token(
    auth: State<'_, ProviderAuthState>,
) -> Result<Option<String>, String> {
    Ok(vault_read(&auth, VAULT_KEY_ID_TOKEN).await)
}

#[cfg(test)]
mod tests {
    use super::{cognito_identity_provider, normalize_cognito_domain, resolve_cognito_config};

    #[test]
    fn uses_compile_time_values_when_present() {
        let cfg = resolve_cognito_config(
            Some("solo-ide-dev.auth.us-east-1.amazoncognito.com"),
            Some("abc123"),
            Some("us-east-1"),
            Some("runtime-domain.example".to_string()),
            Some("runtime-client".to_string()),
            Some("eu-west-1".to_string()),
        )
        .unwrap();
        assert_eq!(cfg.domain, "solo-ide-dev.auth.us-east-1.amazoncognito.com");
        assert_eq!(cfg.client_id, "abc123");
        assert_eq!(cfg.region, "us-east-1");
    }

    #[test]
    fn falls_back_to_runtime_values() {
        let cfg = resolve_cognito_config(
            None,
            None,
            None,
            Some("runtime.auth.us-east-1.amazoncognito.com".to_string()),
            Some("runtime-client".to_string()),
            Some("us-west-2".to_string()),
        )
        .unwrap();
        assert_eq!(cfg.domain, "runtime.auth.us-east-1.amazoncognito.com");
        assert_eq!(cfg.client_id, "runtime-client");
        assert_eq!(cfg.region, "us-west-2");
    }

    #[test]
    fn rejects_http_domain() {
        let err = normalize_cognito_domain("http://example.amazoncognito.com").unwrap_err();
        assert!(err.to_lowercase().contains("https"));
    }

    #[test]
    fn accepts_domain_with_scheme_prefix() {
        let n = normalize_cognito_domain("https://x.auth.us-east-1.amazoncognito.com/").unwrap();
        assert_eq!(n, "x.auth.us-east-1.amazoncognito.com");
    }

    #[test]
    fn maps_providers() {
        assert_eq!(cognito_identity_provider("google").unwrap(), Some("Google"));
        assert_eq!(cognito_identity_provider("github").unwrap(), Some("GitHub"));
        assert_eq!(cognito_identity_provider("email").unwrap(), None);
        assert_eq!(cognito_identity_provider("").unwrap(), None);
        assert!(cognito_identity_provider("facebook").is_err());
    }
}
