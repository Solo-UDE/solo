//! Claude Code OAuth configuration
//!
//! OAuth 2.0 configuration compatible with Claude Code CLI authentication.
//! Uses claude.ai OAuth endpoints and stores tokens in the same keychain format.

use crate::oauth::pkce::{generate_code_challenge, generate_code_verifier, generate_state};
use crate::provider::ProviderError;
use serde::{Deserialize, Serialize};
use url::Url;

/// Claude Code OAuth configuration
/// Uses the same OAuth flow as the official Claude Code CLI
pub struct ClaudeCodeOAuthConfig;

/// OAuth flow result returned to frontend
#[derive(Debug, Clone, Serialize)]
pub struct ClaudeCodeOAuthFlow {
    /// The authorization URL to open in browser
    pub auth_url: String,
    /// State parameter for CSRF protection
    pub state: String,
    /// Code verifier for PKCE (kept server-side)
    pub code_verifier: String,
}

/// Claude Code credential format stored in keychain
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeCredentials {
    pub claude_ai_oauth: ClaudeAiOAuth,
}

/// OAuth token data in Claude Code format
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAiOAuth {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub scopes: Vec<String>,
    #[serde(default)]
    pub subscription_type: Option<String>,
    #[serde(default)]
    pub rate_limit_tier: Option<String>,
}

/// Token response from Claude.ai OAuth
#[derive(Debug, Deserialize)]
struct ClaudeTokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    #[serde(default)]
    scope: Option<String>,
}

impl ClaudeCodeOAuthConfig {
    /// Claude.ai OAuth authorization endpoint
    pub const AUTHORIZATION_URL: &'static str = "https://claude.ai/oauth/authorize";

    /// OAuth token endpoint
    pub const TOKEN_URL: &'static str = "https://api.anthropic.com/oauth/token";

    /// OAuth client ID (same as Claude Code CLI)
    pub const CLIENT_ID: &'static str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

    /// Redirect URI that shows the authorization code
    pub const REDIRECT_URI: &'static str = "https://platform.claude.com/oauth/code/callback";

    /// Required scope for inference
    pub const SCOPE: &'static str = "user:inference";

    /// Build the authorization URL for browser redirect
    pub fn build_auth_url() -> Result<ClaudeCodeOAuthFlow, ProviderError> {
        let state = generate_state();
        let code_verifier = generate_code_verifier();
        let code_challenge = generate_code_challenge(&code_verifier);

        let mut url = Url::parse(Self::AUTHORIZATION_URL)
            .map_err(|e| ProviderError::AuthError(format!("Invalid auth URL: {}", e)))?;

        {
            let mut params = url.query_pairs_mut();
            params.append_pair("code", "true");
            params.append_pair("client_id", Self::CLIENT_ID);
            params.append_pair("response_type", "code");
            params.append_pair("redirect_uri", Self::REDIRECT_URI);
            params.append_pair("scope", Self::SCOPE);
            params.append_pair("code_challenge", &code_challenge);
            params.append_pair("code_challenge_method", "S256");
            params.append_pair("state", &state);
        }

        Ok(ClaudeCodeOAuthFlow {
            auth_url: url.to_string(),
            state,
            code_verifier,
        })
    }

    /// Exchange authorization code for tokens
    pub async fn exchange_code(
        code: &str,
        code_verifier: &str,
    ) -> Result<ClaudeAiOAuth, ProviderError> {
        // Build a client with browser-like headers to avoid Cloudflare blocking
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .map_err(|e| ProviderError::AuthError(format!("Failed to build HTTP client: {}", e)))?;

        let response = client
            .post(Self::TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "application/json")
            .header("Origin", "https://claude.ai")
            .header("Referer", "https://claude.ai/")
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", Self::CLIENT_ID),
                ("code", code),
                ("redirect_uri", Self::REDIRECT_URI),
                ("code_verifier", code_verifier),
            ])
            .send()
            .await
            .map_err(|e| ProviderError::AuthError(format!("Token exchange request failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::AuthError(format!(
                "Token exchange failed ({}): {}",
                status, body
            )));
        }

        let token_response: ClaudeTokenResponse = response
            .json()
            .await
            .map_err(|e| ProviderError::AuthError(format!("Failed to parse token response: {}", e)))?;

        // Calculate expiry timestamp (milliseconds since epoch)
        let expires_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
            + (token_response.expires_in * 1000);

        let scopes = token_response
            .scope
            .map(|s| s.split_whitespace().map(String::from).collect())
            .unwrap_or_else(|| vec![Self::SCOPE.to_string()]);

        Ok(ClaudeAiOAuth {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token,
            expires_at,
            scopes,
            subscription_type: None,
            rate_limit_tier: None,
        })
    }

    /// Store credentials in keychain in Claude Code format
    pub fn store_in_keychain(oauth: &ClaudeAiOAuth) -> Result<(), ProviderError> {
        let credentials = ClaudeCodeCredentials {
            claude_ai_oauth: oauth.clone(),
        };

        let json = serde_json::to_string(&credentials)
            .map_err(|e| ProviderError::AuthError(format!("Failed to serialize credentials: {}", e)))?;

        // Get current username for the account field
        let username = std::env::var("USER").unwrap_or_else(|_| "user".to_string());

        // Delete existing entry if it exists
        let _ = std::process::Command::new("security")
            .args(["delete-generic-password", "-s", "Claude Code-credentials"])
            .output();

        // Add new entry
        let output = std::process::Command::new("security")
            .args([
                "add-generic-password",
                "-s", "Claude Code-credentials",
                "-a", &username,
                "-w", &json,
                "-U",
            ])
            .output()
            .map_err(|e| ProviderError::KeychainError(e.to_string()))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(ProviderError::KeychainError(error.to_string()));
        }

        tracing::info!("Stored Claude Code credentials in keychain");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_auth_url() {
        let flow = ClaudeCodeOAuthConfig::build_auth_url().unwrap();

        // Check that URL contains required parameters
        assert!(flow.auth_url.contains("client_id="));
        assert!(flow.auth_url.contains("redirect_uri="));
        assert!(flow.auth_url.contains("response_type=code"));
        assert!(flow.auth_url.contains("scope="));
        assert!(flow.auth_url.contains("state="));
        assert!(flow.auth_url.contains("code_challenge="));
        assert!(flow.auth_url.contains("code_challenge_method=S256"));
        assert!(flow.auth_url.contains("code=true"));

        // Check that code verifier is valid
        assert!(flow.code_verifier.len() >= 43);
    }

    #[test]
    fn test_constants() {
        assert!(ClaudeCodeOAuthConfig::AUTHORIZATION_URL.starts_with("https://claude.ai"));
        assert!(ClaudeCodeOAuthConfig::TOKEN_URL.starts_with("https://"));
        assert!(!ClaudeCodeOAuthConfig::CLIENT_ID.is_empty());
    }
}
