//! GitHub OAuth configuration
//!
//! Direct GitHub OAuth 2.0 flow for git operations (push, pull, clone private repos).
//! Separate from Supabase auth — this gives us a real GitHub access token with repo scope.
//! Supports both Authorization Code flow (legacy) and Device Flow (recommended).

use crate::oauth::callback_server::get_callback_url;
use crate::oauth::pkce::{generate_code_verifier, generate_state};
use crate::oauth::types::{OAuthFlowResult, OAuthState, OAuthToken};
use crate::provider::ProviderError;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;

/// Response from GitHub's device code endpoint (crate-internal)
#[derive(Debug, Clone)]
pub struct DeviceCodeResponse {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub expires_in: u32,
    pub interval: u32,
}

/// Result of polling for device authorization (crate-internal)
#[derive(Debug, Clone)]
pub enum DevicePollResult {
    /// Still waiting for user to authorize
    Pending,
    /// User authorized — token included
    Complete(OAuthToken),
    /// The device code expired
    Expired,
    /// An error occurred
    Error(String),
}

/// GitHub OAuth configuration for Solo IDE
pub struct GitHubOAuthConfig;

impl GitHubOAuthConfig {
    pub const AUTHORIZATION_URL: &'static str = "https://github.com/login/oauth/authorize";
    pub const TOKEN_URL: &'static str = "https://github.com/login/oauth/access_token";
    pub const DEVICE_CODE_URL: &'static str = "https://github.com/login/device/code";
    pub const SCOPES: &'static [&'static str] = &["repo", "read:user", "user:email"];

    /// Get client ID from environment (compile-time or runtime)
    pub fn client_id() -> String {
        option_env!("SOLO_GITHUB_CLIENT_ID")
            .map(String::from)
            .or_else(|| std::env::var("SOLO_GITHUB_CLIENT_ID").ok())
            .unwrap_or_else(|| "Ov23li75IEkY755KbcWI".to_string())
    }

    /// Get client secret from environment (compile-time or runtime).
    /// Returns an error if not configured — secrets must not be hardcoded.
    pub fn client_secret() -> Result<String, ProviderError> {
        option_env!("SOLO_GITHUB_CLIENT_SECRET")
            .map(String::from)
            .or_else(|| std::env::var("SOLO_GITHUB_CLIENT_SECRET").ok())
            .ok_or_else(|| {
                ProviderError::AuthError(
                    "GitHub OAuth client secret not configured. Set SOLO_GITHUB_CLIENT_SECRET environment variable.".to_string()
                )
            })
    }

    // =========================================================================
    // Authorization Code Flow (legacy — requires client secret + callback server)
    // =========================================================================

    /// Build the authorization URL for browser redirect.
    ///
    /// GitHub OAuth Apps don't support PKCE natively, but we still generate a
    /// code_verifier to keep the OAuthState struct consistent. The `state` param
    /// provides CSRF protection.
    pub fn build_auth_url() -> Result<(OAuthFlowResult, OAuthState), ProviderError> {
        let state = generate_state();
        let code_verifier = generate_code_verifier();
        let redirect_uri = get_callback_url();

        let client_id = Self::client_id();

        let mut url = Url::parse(Self::AUTHORIZATION_URL)
            .map_err(|e| ProviderError::AuthError(format!("Invalid auth URL: {}", e)))?;

        {
            let mut params = url.query_pairs_mut();
            params.append_pair("client_id", &client_id);
            params.append_pair("redirect_uri", &redirect_uri);
            params.append_pair("scope", &Self::SCOPES.join(" "));
            params.append_pair("state", &state);
        }

        let oauth_state = OAuthState::new(state.clone(), code_verifier, "github".to_string());

        let result = OAuthFlowResult {
            auth_url: url.to_string(),
            state,
        };

        Ok((result, oauth_state))
    }

    /// Exchange authorization code for an access token.
    ///
    /// GitHub requires client_id + client_secret + code (no PKCE code_verifier).
    /// GitHub returns form-encoded by default, so we set Accept: application/json.
    /// GitHub tokens don't expire unless the OAuth App has token expiration enabled,
    /// so we set a far-future expiry (10 years).
    pub async fn exchange_code(code: &str) -> Result<OAuthToken, ProviderError> {
        let redirect_uri = get_callback_url();
        let client_id = Self::client_id();
        let client_secret = Self::client_secret()?;

        let client = reqwest::Client::new();
        let response = client
            .post(Self::TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id.as_str()),
                ("client_secret", client_secret.as_str()),
                ("code", code),
                ("redirect_uri", &redirect_uri),
            ])
            .send()
            .await
            .map_err(|e| {
                ProviderError::AuthError(format!("Token exchange request failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::AuthError(format!(
                "Token exchange failed ({}): {}",
                status, body
            )));
        }

        let body: serde_json::Value = response.json().await.map_err(|e| {
            ProviderError::AuthError(format!("Failed to parse token response: {}", e))
        })?;

        // GitHub may return an error in a 200 response
        if let Some(error) = body.get("error").and_then(|e| e.as_str()) {
            let desc = body
                .get("error_description")
                .and_then(|d| d.as_str())
                .unwrap_or("Unknown error");
            return Err(ProviderError::AuthError(format!(
                "GitHub OAuth error: {}: {}",
                error, desc
            )));
        }

        let access_token = body
            .get("access_token")
            .and_then(|t| t.as_str())
            .ok_or_else(|| {
                ProviderError::AuthError("No access_token in GitHub response".to_string())
            })?
            .to_string();

        let scope = body
            .get("scope")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string());

        let token_type = body
            .get("token_type")
            .and_then(|t| t.as_str())
            .unwrap_or("bearer")
            .to_string();

        // GitHub tokens don't expire by default. Set expiry to 10 years.
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();
        let ten_years = 10 * 365 * 24 * 3600;

        Ok(OAuthToken {
            access_token,
            refresh_token: None,
            expires_at: now + ten_years,
            token_type,
            scope,
        })
    }

    // =========================================================================
    // Device Flow (recommended — no client secret, no callback server)
    // =========================================================================

    /// Start the GitHub Device Flow.
    ///
    /// POST to https://github.com/login/device/code with client_id and scope.
    /// Returns user_code (for the user to enter at verification_uri),
    /// device_code (for polling), and timing parameters.
    ///
    /// Requires "Enable Device Flow" to be checked in the GitHub OAuth App settings.
    pub async fn start_device_flow() -> Result<DeviceCodeResponse, ProviderError> {
        let client_id = Self::client_id();
        let scope = Self::SCOPES.join(" ");

        let client = reqwest::Client::new();
        let response = client
            .post(Self::DEVICE_CODE_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id.as_str()),
                ("scope", scope.as_str()),
            ])
            .send()
            .await
            .map_err(|e| {
                ProviderError::AuthError(format!("Device flow request failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::AuthError(format!(
                "Device flow request failed ({}): {}",
                status, body
            )));
        }

        let body: serde_json::Value = response.json().await.map_err(|e| {
            ProviderError::AuthError(format!("Failed to parse device code response: {}", e))
        })?;

        // Check for error response
        if let Some(error) = body.get("error").and_then(|e| e.as_str()) {
            let desc = body
                .get("error_description")
                .and_then(|d| d.as_str())
                .unwrap_or("Unknown error");
            return Err(ProviderError::AuthError(format!(
                "Device flow error: {}: {}",
                error, desc
            )));
        }

        let user_code = body
            .get("user_code")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                ProviderError::AuthError("No user_code in device flow response".to_string())
            })?
            .to_string();

        let verification_uri = body
            .get("verification_uri")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                ProviderError::AuthError(
                    "No verification_uri in device flow response".to_string(),
                )
            })?
            .to_string();

        let device_code = body
            .get("device_code")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                ProviderError::AuthError("No device_code in device flow response".to_string())
            })?
            .to_string();

        let expires_in = body
            .get("expires_in")
            .and_then(|v| v.as_u64())
            .unwrap_or(900) as u32;

        let interval = body
            .get("interval")
            .and_then(|v| v.as_u64())
            .unwrap_or(5) as u32;

        Ok(DeviceCodeResponse {
            user_code,
            verification_uri,
            device_code,
            expires_in,
            interval,
        })
    }

    /// Poll GitHub for device authorization completion.
    ///
    /// POST to the token endpoint with device_code and the device_code grant type.
    /// GitHub returns different error codes depending on the state:
    /// - `authorization_pending`: User hasn't authorized yet, keep polling
    /// - `slow_down`: Polling too fast, increase interval by 5 seconds
    /// - `expired_token`: Device code expired, user needs to restart
    /// - `access_denied`: User denied authorization
    pub async fn poll_device_token(device_code: &str) -> Result<DevicePollResult, ProviderError> {
        let client_id = Self::client_id();

        let client = reqwest::Client::new();
        let response = client
            .post(Self::TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id.as_str()),
                ("device_code", device_code),
                (
                    "grant_type",
                    "urn:ietf:params:oauth:grant-type:device_code",
                ),
            ])
            .send()
            .await
            .map_err(|e| {
                ProviderError::AuthError(format!("Device token poll failed: {}", e))
            })?;

        let body: serde_json::Value = response.json().await.map_err(|e| {
            ProviderError::AuthError(format!("Failed to parse device poll response: {}", e))
        })?;

        // Check for known error states
        if let Some(error) = body.get("error").and_then(|e| e.as_str()) {
            return match error {
                "authorization_pending" | "slow_down" => Ok(DevicePollResult::Pending),
                "expired_token" => Ok(DevicePollResult::Expired),
                "access_denied" => Ok(DevicePollResult::Error(
                    "Authorization was denied by the user".to_string(),
                )),
                _ => {
                    let desc = body
                        .get("error_description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("Unknown error");
                    Ok(DevicePollResult::Error(format!("{}: {}", error, desc)))
                }
            };
        }

        // No error — extract the access token
        let access_token = body
            .get("access_token")
            .and_then(|t| t.as_str())
            .ok_or_else(|| {
                ProviderError::AuthError(
                    "No access_token or error in device poll response".to_string(),
                )
            })?
            .to_string();

        let scope = body
            .get("scope")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string());

        let token_type = body
            .get("token_type")
            .and_then(|t| t.as_str())
            .unwrap_or("bearer")
            .to_string();

        // GitHub tokens don't expire by default. Set expiry to 10 years.
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();
        let ten_years = 10 * 365 * 24 * 3600;

        let token = OAuthToken {
            access_token,
            refresh_token: None,
            expires_at: now + ten_years,
            token_type,
            scope,
        };

        Ok(DevicePollResult::Complete(token))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_auth_url() {
        let (result, state) = GitHubOAuthConfig::build_auth_url().unwrap();

        assert!(result.auth_url.contains("client_id="));
        assert!(result.auth_url.contains("redirect_uri="));
        assert!(result.auth_url.contains("scope="));
        assert!(result.auth_url.contains("state="));

        assert_eq!(result.state, state.state);
        assert!(state.code_verifier.len() >= 43);
        assert_eq!(state.provider, "github");
    }

    #[test]
    fn test_constants() {
        assert!(GitHubOAuthConfig::AUTHORIZATION_URL.starts_with("https://"));
        assert!(GitHubOAuthConfig::TOKEN_URL.starts_with("https://"));
        assert!(GitHubOAuthConfig::DEVICE_CODE_URL.starts_with("https://"));
        assert!(!GitHubOAuthConfig::client_id().is_empty());
        assert!(!GitHubOAuthConfig::SCOPES.is_empty());
        assert!(GitHubOAuthConfig::SCOPES.contains(&"repo"));
    }
}
