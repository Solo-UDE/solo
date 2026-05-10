//! Anthropic OAuth configuration
//!
//! OAuth 2.0 configuration for Anthropic/Claude authentication.

use crate::oauth::callback_server::get_callback_url;
use crate::oauth::pkce::{generate_code_challenge, generate_code_verifier, generate_state};
use crate::oauth::types::{OAuthFlowResult, OAuthState, OAuthToken, TokenResponse};
use crate::provider::ProviderError;
use url::Url;

/// Anthropic OAuth configuration
pub struct AnthropicOAuthConfig;

impl AnthropicOAuthConfig {
    /// Anthropic OAuth authorization endpoint
    pub const AUTHORIZATION_URL: &'static str = "https://console.anthropic.com/oauth/authorize";

    /// Anthropic OAuth token endpoint
    pub const TOKEN_URL: &'static str = "https://api.anthropic.com/oauth/token";

    /// OAuth client ID for Solo IDE
    /// Note: This should be registered with Anthropic for production use
    pub const CLIENT_ID: &'static str = "solo-ide";

    /// Required scopes for Solo IDE functionality
    pub const SCOPES: &'static [&'static str] = &["messages:write", "messages:read"];

    /// Build the authorization URL for browser redirect
    pub fn build_auth_url() -> Result<(OAuthFlowResult, OAuthState), ProviderError> {
        let state = generate_state();
        let code_verifier = generate_code_verifier();
        let code_challenge = generate_code_challenge(&code_verifier);
        let redirect_uri = get_callback_url();

        let mut url = Url::parse(Self::AUTHORIZATION_URL)
            .map_err(|e| ProviderError::AuthError(format!("Invalid auth URL: {}", e)))?;

        {
            let mut params = url.query_pairs_mut();
            params.append_pair("client_id", Self::CLIENT_ID);
            params.append_pair("redirect_uri", &redirect_uri);
            params.append_pair("response_type", "code");
            params.append_pair("scope", &Self::SCOPES.join(" "));
            params.append_pair("state", &state);
            params.append_pair("code_challenge", &code_challenge);
            params.append_pair("code_challenge_method", "S256");
        }

        let oauth_state = OAuthState::new(state.clone(), code_verifier, "anthropic".to_string());

        let result = OAuthFlowResult {
            auth_url: url.to_string(),
            state,
        };

        Ok((result, oauth_state))
    }

    /// Exchange authorization code for tokens
    pub async fn exchange_code(
        code: &str,
        code_verifier: &str,
    ) -> Result<OAuthToken, ProviderError> {
        let redirect_uri = get_callback_url();

        let client = reqwest::Client::new();
        let response = client
            .post(Self::TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", Self::CLIENT_ID),
                ("code", code),
                ("redirect_uri", &redirect_uri),
                ("code_verifier", code_verifier),
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

        let token_response: TokenResponse = response.json().await.map_err(|e| {
            ProviderError::AuthError(format!("Failed to parse token response: {}", e))
        })?;

        Ok(OAuthToken::from(token_response))
    }

    /// Refresh an expired access token
    pub async fn refresh_token(refresh_token: &str) -> Result<OAuthToken, ProviderError> {
        let client = reqwest::Client::new();
        let response = client
            .post(Self::TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", Self::CLIENT_ID),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await
            .map_err(|e| {
                ProviderError::AuthError(format!("Token refresh request failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::AuthError(format!(
                "Token refresh failed ({}): {}",
                status, body
            )));
        }

        let token_response: TokenResponse = response.json().await.map_err(|e| {
            ProviderError::AuthError(format!("Failed to parse refresh token response: {}", e))
        })?;

        Ok(OAuthToken::from(token_response))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_auth_url() {
        let (result, state) = AnthropicOAuthConfig::build_auth_url().unwrap();

        // Check that URL contains required parameters
        assert!(result.auth_url.contains("client_id="));
        assert!(result.auth_url.contains("redirect_uri="));
        assert!(result.auth_url.contains("response_type=code"));
        assert!(result.auth_url.contains("scope="));
        assert!(result.auth_url.contains("state="));
        assert!(result.auth_url.contains("code_challenge="));
        assert!(result.auth_url.contains("code_challenge_method=S256"));

        // Check that state matches
        assert_eq!(result.state, state.state);

        // Check that code verifier is valid
        assert!(state.code_verifier.len() >= 43);

        // Check provider
        assert_eq!(state.provider, "anthropic");
    }

    #[test]
    fn test_constants() {
        assert!(AnthropicOAuthConfig::AUTHORIZATION_URL.starts_with("https://"));
        assert!(AnthropicOAuthConfig::TOKEN_URL.starts_with("https://"));
        assert!(!AnthropicOAuthConfig::CLIENT_ID.is_empty());
        assert!(!AnthropicOAuthConfig::SCOPES.is_empty());
    }
}
