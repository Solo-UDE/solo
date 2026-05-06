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
use tauri::State;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};
use url::Url;

use crate::desktop_config::{self, CognitoConfig, REDIRECT_URL, SIGNOUT_URL};
use crate::provider_commands::ProviderAuthState;

fn now_epoch_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Deserialize)]
struct JwtExpiryClaims {
    exp: Option<i64>,
}

fn jwt_expires_within(token: &str, leeway_secs: i64) -> bool {
    let Some(payload) = token.split('.').nth(1) else {
        return true;
    };
    let Ok(decoded) = URL_SAFE_NO_PAD.decode(payload) else {
        return true;
    };
    let Ok(claims) = serde_json::from_slice::<JwtExpiryClaims>(&decoded) else {
        return true;
    };
    claims.exp.map_or(true, |exp| exp <= now_epoch_secs() + leeway_secs)
}

// =============================================================================
// Configuration
// =============================================================================

/// Vault keys — `cognito.*` per the Supabase→Cognito migration.
const VAULT_KEY_ACCESS_TOKEN: &str = "cognito.accessToken";
const VAULT_KEY_REFRESH_TOKEN: &str = "cognito.refreshToken";
const VAULT_KEY_ID_TOKEN: &str = "cognito.idToken";

// =============================================================================
// Types
// =============================================================================

/// PKCE state stored during OAuth flow.
#[derive(Debug, Clone)]
struct PkceState {
    verifier: String,
    challenge: String,
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
    info!(provider = %provider, "[auth_start_oauth] begin");
    let config = match desktop_config::cognito_config() {
        Ok(cfg) => {
            info!(
                domain = %cfg.domain,
                client_id = %cfg.client_id,
                region = %cfg.region,
                "[auth_start_oauth] resolved Cognito config"
            );
            cfg
        }
        Err(err) => {
            warn!(error = %err, "[auth_start_oauth] cognito_config() failed");
            return Err(err);
        }
    };
    let idp = cognito_identity_provider(&provider)?;
    info!(
        provider = %provider,
        idp = ?idp,
        "[auth_start_oauth] mapped provider"
    );

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

    let built = url.to_string();
    info!(
        url = %built,
        len = built.len(),
        "[auth_start_oauth] returning URL to frontend"
    );
    Ok(built)
}

/// Structured diagnostic report for the auth pipeline. Returned by the
/// `auth_diagnose` command so the UI (or a CLI tail of logs) can show every
/// piece of the flow in one shot without reproducing the failure first.
#[derive(Debug, Serialize)]
pub struct AuthDiagnostic {
    pub stage: String,
    pub config_ok: bool,
    pub config_error: Option<String>,
    pub cognito_domain: Option<String>,
    pub cognito_client_id: Option<String>,
    pub cognito_region: Option<String>,
    pub redirect_uri: String,
    pub signout_uri: String,
    pub sample_authorize_url: Option<String>,
    pub authorize_probe: Option<HttpProbe>,
    pub signout_probe: Option<HttpProbe>,
    pub has_cached_session: bool,
    pub vault_has_access_token: bool,
    pub vault_has_refresh_token: bool,
}

#[derive(Debug, Serialize)]
pub struct HttpProbe {
    pub status: u16,
    pub location: Option<String>,
    pub body_snippet: Option<String>,
    pub error: Option<String>,
}

async fn probe_url(client: &reqwest::Client, url: &str) -> HttpProbe {
    match client
        .get(url)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let body_snippet = if !(300..400).contains(&status) {
                let text = resp.text().await.unwrap_or_default();
                let snippet: String = text.chars().take(200).collect();
                Some(snippet)
            } else {
                None
            };
            HttpProbe {
                status,
                location,
                body_snippet,
                error: None,
            }
        }
        Err(err) => HttpProbe {
            status: 0,
            location: None,
            body_snippet: None,
            error: Some(err.to_string()),
        },
    }
}

/// Run a full diagnostic of the auth pipeline and return a structured report.
/// Used by the LoginScreen's "Diagnose" button and by the external CLI probe.
/// Never mutates state; safe to call at any time.
#[tauri::command]
pub async fn auth_diagnose(
    state: State<'_, AuthState>,
    auth: State<'_, ProviderAuthState>,
) -> Result<AuthDiagnostic, String> {
    info!("[auth_diagnose] begin");
    let mut report = AuthDiagnostic {
        stage: String::new(),
        config_ok: false,
        config_error: None,
        cognito_domain: None,
        cognito_client_id: None,
        cognito_region: None,
        redirect_uri: REDIRECT_URL.to_string(),
        signout_uri: SIGNOUT_URL.to_string(),
        sample_authorize_url: None,
        authorize_probe: None,
        signout_probe: None,
        has_cached_session: state.session.read().await.is_some(),
        vault_has_access_token: vault_read(&auth, VAULT_KEY_ACCESS_TOKEN).await.is_some(),
        vault_has_refresh_token: vault_read(&auth, VAULT_KEY_REFRESH_TOKEN).await.is_some(),
    };

    match desktop_config::cognito_config() {
        Ok(cfg) => {
            report.config_ok = true;
            report.cognito_domain = Some(cfg.domain.clone());
            report.cognito_client_id = Some(cfg.client_id.clone());
            report.cognito_region = Some(cfg.region.clone());
            report.stage = if cfg.domain.contains("solo-ide-dev") {
                "dev".to_string()
            } else if cfg.domain.contains("solo-ide-prod") {
                "prod".to_string()
            } else {
                "custom".to_string()
            };

            let sample_pkce = AuthState::generate_pkce();
            let mut url = Url::parse(&format!("{}/oauth2/authorize", cfg.base_url()))
                .map_err(|e| format!("url parse failed: {}", e))?;
            {
                let mut q = url.query_pairs_mut();
                q.append_pair("response_type", "code");
                q.append_pair("client_id", &cfg.client_id);
                q.append_pair("redirect_uri", REDIRECT_URL);
                q.append_pair("scope", "openid email profile");
                q.append_pair("code_challenge", &sample_pkce.challenge);
                q.append_pair("code_challenge_method", "S256");
                q.append_pair("identity_provider", "GitHub");
            }
            let authorize = url.to_string();
            report.sample_authorize_url = Some(authorize.clone());
            info!(url = %authorize, "[auth_diagnose] probing authorize URL");
            report.authorize_probe = Some(probe_url(&state.client, &authorize).await);

            let mut logout = Url::parse(&format!("{}/logout", cfg.base_url()))
                .map_err(|e| format!("url parse failed: {}", e))?;
            logout
                .query_pairs_mut()
                .append_pair("client_id", &cfg.client_id)
                .append_pair("logout_uri", SIGNOUT_URL);
            info!(url = %logout, "[auth_diagnose] probing signout URL");
            report.signout_probe = Some(probe_url(&state.client, &logout.to_string()).await);
        }
        Err(err) => {
            warn!(error = %err, "[auth_diagnose] cognito_config() failed");
            report.config_error = Some(err);
            report.stage = "unconfigured".to_string();
        }
    }

    info!(report = ?report, "[auth_diagnose] done");
    Ok(report)
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
    let config = desktop_config::cognito_config()?;
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
    let config = desktop_config::cognito_config()?;
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

    match fetch_user_info(
        &state.client,
        desktop_config::cognito_config()?,
        &access_token,
    )
    .await
    {
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
    let config = desktop_config::cognito_config()?;
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

    // The GitHub access token cached from /v1/github/token is tied to the
    // Cognito identity — once the user signs out we must drop it so a
    // different user on this machine doesn't inherit git push creds.
    match auth.credentials.clear_github_oauth_token().await {
        Ok(()) => info!("auth_sign_out: cleared cached GitHub token"),
        Err(e) => tracing::warn!(error = %e, "auth_sign_out: GitHub token clear failed (ignored)"),
    }

    // Build the Cognito logout URL when possible. Missing env / bad config
    // is NOT a sign-out failure — local state is already clean. Return an
    // empty URL so the frontend can skip opening a browser.
    let logout_url = match desktop_config::cognito_config() {
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

/// Non-command helper: returns a non-expired ID token, refreshing through
/// Cognito when the keychain token is absent or near expiry.
pub async fn fresh_id_token_snapshot(
    state: &State<'_, AuthState>,
    auth: &State<'_, ProviderAuthState>,
) -> Option<String> {
    let current = vault_read(auth, VAULT_KEY_ID_TOKEN).await;
    if current
        .as_deref()
        .is_some_and(|token| !jwt_expires_within(token, 60))
    {
        return current;
    }

    let refresh_token = vault_read(auth, VAULT_KEY_REFRESH_TOKEN).await?;
    match refresh_session_internal(state, auth, &refresh_token).await {
        Ok(_) => vault_read(auth, VAULT_KEY_ID_TOKEN).await,
        Err(error) => {
            warn!("fresh_id_token_snapshot: refresh failed: {}", error);
            None
        }
    }
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
    use super::{cognito_identity_provider, jwt_expires_within, now_epoch_secs, URL_SAFE_NO_PAD};
    use base64::Engine;

    fn unsigned_jwt_with_exp(exp: i64) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none"}"#);
        let payload = URL_SAFE_NO_PAD.encode(format!(r#"{{"exp":{exp}}}"#));
        format!("{header}.{payload}.")
    }

    #[test]
    fn maps_providers() {
        assert_eq!(cognito_identity_provider("google").unwrap(), Some("Google"));
        assert_eq!(cognito_identity_provider("github").unwrap(), Some("GitHub"));
        assert_eq!(cognito_identity_provider("email").unwrap(), None);
        assert_eq!(cognito_identity_provider("").unwrap(), None);
        assert!(cognito_identity_provider("facebook").is_err());
    }

    #[test]
    fn detects_expired_or_near_expiry_jwts() {
        let expired = unsigned_jwt_with_exp(now_epoch_secs() - 1);
        let near_expiry = unsigned_jwt_with_exp(now_epoch_secs() + 30);
        let fresh = unsigned_jwt_with_exp(now_epoch_secs() + 300);

        assert!(jwt_expires_within(&expired, 60));
        assert!(jwt_expires_within(&near_expiry, 60));
        assert!(!jwt_expires_within(&fresh, 60));
        assert!(jwt_expires_within("not-a-jwt", 60));
    }
}
