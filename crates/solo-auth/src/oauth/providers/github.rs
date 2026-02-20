//! GitHub OAuth configuration
//!
//! Direct GitHub OAuth 2.0 flow for git operations (push, pull, clone private repos).
//! Separate from Supabase auth — this gives us a real GitHub access token with repo scope.

use crate::oauth::callback_server::get_callback_url;
use crate::oauth::pkce::{generate_code_verifier, generate_state};
use crate::oauth::types::{OAuthFlowResult, OAuthState, OAuthToken};
use crate::provider::ProviderError;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;

/// GitHub OAuth configuration for Solo IDE
pub struct GitHubOAuthConfig;

impl GitHubOAuthConfig {
    pub const AUTHORIZATION_URL: &'static str = "https://github.com/login/oauth/authorize";
    pub const TOKEN_URL: &'static str = "https://github.com/login/oauth/access_token";
    pub const CLIENT_ID: &'static str = "Ov23liwTZvhwuuli58QQ";
    pub const CLIENT_SECRET: &'static str = "d868272c66f7eef32417a5208dc06cfd4d8ee20e";
    pub const SCOPES: &'static [&'static str] = &["repo", "read:user", "user:email"];

    /// Build the authorization URL for browser redirect.
    ///
    /// GitHub OAuth Apps don't support PKCE natively, but we still generate a
    /// code_verifier to keep the OAuthState struct consistent. The `state` param
    /// provides CSRF protection.
    pub fn build_auth_url() -> Result<(OAuthFlowResult, OAuthState), ProviderError> {
        let state = generate_state();
        let code_verifier = generate_code_verifier();
        let redirect_uri = get_callback_url();

        let mut url = Url::parse(Self::AUTHORIZATION_URL)
            .map_err(|e| ProviderError::AuthError(format!("Invalid auth URL: {}", e)))?;

        {
            let mut params = url.query_pairs_mut();
            params.append_pair("client_id", Self::CLIENT_ID);
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

        let client = reqwest::Client::new();
        let response = client
            .post(Self::TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", Self::CLIENT_ID),
                ("client_secret", Self::CLIENT_SECRET),
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
        assert!(!GitHubOAuthConfig::CLIENT_ID.is_empty());
        assert!(!GitHubOAuthConfig::CLIENT_SECRET.is_empty());
        assert!(!GitHubOAuthConfig::SCOPES.is_empty());
        assert!(GitHubOAuthConfig::SCOPES.contains(&"repo"));
    }
}
