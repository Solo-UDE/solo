//! OpenAI OAuth configuration
//!
//! OAuth 2.0 configuration for OpenAI/ChatGPT authentication using the Codex CLI flow.
//! This allows ChatGPT Pro/Plus subscribers to use the free Codex API without an API key.

use crate::oauth::callback_server::get_callback_url;
use crate::oauth::pkce::{generate_code_challenge, generate_code_verifier, generate_state};
use crate::oauth::types::{OAuthFlowResult, OAuthState, OpenAIOAuthToken, OpenAITokenResponse};
use crate::provider::ProviderError;
use serde::Deserialize;
use url::Url;

/// Response from RFC 8693 token exchange
#[derive(Debug, Deserialize)]
struct TokenExchangeResponse {
    access_token: String,
}

/// OpenAI OAuth configuration for Codex CLI flow
pub struct OpenAIOAuthConfig;

impl OpenAIOAuthConfig {
    /// OpenAI OAuth authorization endpoint
    pub const AUTHORIZATION_URL: &'static str = "https://auth.openai.com/oauth/authorize";

    /// OpenAI OAuth token endpoint
    pub const TOKEN_URL: &'static str = "https://auth.openai.com/oauth/token";

    /// OAuth client ID for Codex CLI (public client)
    pub const CLIENT_ID: &'static str = "app_EMoamEEZ73f0CkXaXp7hrann";

    /// Required scopes for ChatGPT API access
    pub const SCOPES: &'static [&'static str] = &["openid", "profile", "email", "offline_access"];

    /// Build the authorization URL for browser redirect
    pub fn build_auth_url() -> Result<(OAuthFlowResult, OAuthState), ProviderError> {
        let state = generate_state();
        let code_verifier = generate_code_verifier();
        let code_challenge = generate_code_challenge(&code_verifier);
        let redirect_uri = get_callback_url();

        let mut url = Url::parse(Self::AUTHORIZATION_URL)
            .map_err(|e| ProviderError::OAuthError(format!("Invalid auth URL: {}", e)))?;

        {
            let mut params = url.query_pairs_mut();
            params.append_pair("response_type", "code");
            params.append_pair("client_id", Self::CLIENT_ID);
            params.append_pair("redirect_uri", &redirect_uri);
            params.append_pair("scope", &Self::SCOPES.join(" "));
            params.append_pair("state", &state);
            params.append_pair("code_challenge", &code_challenge);
            params.append_pair("code_challenge_method", "S256");
            // Special parameters for Codex CLI simplified flow
            params.append_pair("id_token_add_organizations", "true");
            params.append_pair("codex_cli_simplified_flow", "true");
            // Attribution parameter
            params.append_pair("originator", "solo_ide");
        }

        let oauth_state = OAuthState::new(
            state.clone(),
            code_verifier,
            "openai".to_string(),
        );

        let result = OAuthFlowResult {
            auth_url: url.to_string(),
            state,
        };

        Ok((result, oauth_state))
    }

    /// Exchange authorization code for tokens, then perform RFC 8693 token
    /// exchange to obtain a usable API key from the id_token.
    pub async fn exchange_code(
        code: &str,
        code_verifier: &str,
    ) -> Result<OpenAIOAuthToken, ProviderError> {
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
            .map_err(|e| ProviderError::OAuthError(format!("Token exchange request failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::OAuthError(format!(
                "Token exchange failed ({}): {}",
                status, body
            )));
        }

        let token_response: OpenAITokenResponse = response
            .json()
            .await
            .map_err(|e| ProviderError::OAuthError(format!("Failed to parse token response: {}", e)))?;

        // Extract account_id from id_token JWT
        let account_id = token_response.id_token.as_ref()
            .and_then(|id_token| extract_account_id_from_jwt(id_token));

        // Perform RFC 8693 token exchange: convert id_token into a usable API key
        let api_key = if let Some(ref id_token) = token_response.id_token {
            match Self::obtain_api_key(id_token).await {
                Ok(key) => {
                    tracing::info!("Successfully exchanged id_token for API key");
                    key
                }
                Err(e) => {
                    tracing::warn!("Token exchange for API key failed, falling back to access_token: {}", e);
                    token_response.access_token.clone()
                }
            }
        } else {
            tracing::warn!("No id_token in OAuth response, using access_token directly");
            token_response.access_token.clone()
        };

        let mut token = OpenAIOAuthToken::from_response(token_response, account_id);
        // Replace access_token with the exchanged API key
        token.access_token = api_key;
        Ok(token)
    }

    /// Exchange an id_token for an OpenAI API key using RFC 8693 token exchange.
    ///
    /// This is the critical step that converts the OAuth id_token into a
    /// usable API key for ChatGPT Pro/Max subscribers.
    pub async fn obtain_api_key(id_token: &str) -> Result<String, ProviderError> {
        let client = reqwest::Client::new();
        let response = client
            .post(Self::TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange"),
                ("client_id", Self::CLIENT_ID),
                ("requested_token_type", "urn:ietf:params:oauth:token-type:access_token"),
                ("subject_token", id_token),
                ("subject_token_type", "urn:ietf:params:oauth:token-type:id_token"),
                ("audience", "https://api.openai.com/v1"),
            ])
            .send()
            .await
            .map_err(|e| ProviderError::OAuthError(format!("API key exchange request failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::OAuthError(format!(
                "API key exchange failed ({}): {}",
                status, body
            )));
        }

        // The response contains { "access_token": "<api-key>", ... }
        let exchange_response: TokenExchangeResponse = response
            .json()
            .await
            .map_err(|e| ProviderError::OAuthError(format!("Failed to parse token exchange response: {}", e)))?;

        Ok(exchange_response.access_token)
    }

    /// Refresh an expired access token, then re-exchange for API key if possible
    pub async fn refresh_token(refresh_token: &str) -> Result<OpenAIOAuthToken, ProviderError> {
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
            .map_err(|e| ProviderError::OAuthError(format!("Token refresh request failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::OAuthError(format!(
                "Token refresh failed ({}): {}",
                status, body
            )));
        }

        let token_response: OpenAITokenResponse = response
            .json()
            .await
            .map_err(|e| ProviderError::OAuthError(format!("Failed to parse refresh token response: {}", e)))?;

        // Extract account_id from id_token JWT (may be present in refresh response)
        let account_id = token_response.id_token.as_ref()
            .and_then(|id_token| extract_account_id_from_jwt(id_token));

        // Re-exchange id_token for API key if present
        let api_key = if let Some(ref id_token) = token_response.id_token {
            match Self::obtain_api_key(id_token).await {
                Ok(key) => {
                    tracing::info!("Successfully exchanged refreshed id_token for API key");
                    key
                }
                Err(e) => {
                    tracing::warn!("Token exchange after refresh failed, using access_token: {}", e);
                    token_response.access_token.clone()
                }
            }
        } else {
            token_response.access_token.clone()
        };

        let mut token = OpenAIOAuthToken::from_response(token_response, account_id);
        token.access_token = api_key;
        Ok(token)
    }
}

/// Extract the ChatGPT account ID from an OpenAI id_token JWT
///
/// The JWT contains claims like:
/// ```json
/// {
///   "chatgpt_account_id": "acct_xxx",
///   "https://api.openai.com/auth": {
///     "chatgpt_account_id": "acct_xxx"
///   }
/// }
/// ```
fn extract_account_id_from_jwt(id_token: &str) -> Option<String> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    // JWT format: header.payload.signature
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() != 3 {
        tracing::warn!("Invalid JWT format: expected 3 parts, got {}", parts.len());
        return None;
    }

    // Decode the payload (middle part) - JWT uses URL-safe base64 without padding
    let payload = parts[1];

    let decoded = match URL_SAFE_NO_PAD.decode(payload) {
        Ok(bytes) => bytes,
        Err(e) => {
            tracing::warn!("Failed to decode JWT payload: {}", e);
            return None;
        }
    };

    let json_str = match String::from_utf8(decoded) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("JWT payload is not valid UTF-8: {}", e);
            return None;
        }
    };

    let claims: serde_json::Value = match serde_json::from_str(&json_str) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Failed to parse JWT claims: {}", e);
            return None;
        }
    };

    // Try direct claim first
    if let Some(account_id) = claims.get("chatgpt_account_id").and_then(|v| v.as_str()) {
        return Some(account_id.to_string());
    }

    // Try nested claim
    if let Some(account_id) = claims
        .get("https://api.openai.com/auth")
        .and_then(|auth| auth.get("chatgpt_account_id"))
        .and_then(|v| v.as_str())
    {
        return Some(account_id.to_string());
    }

    tracing::debug!("No chatgpt_account_id found in JWT claims");
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    #[test]
    fn test_build_auth_url() {
        let (result, state) = OpenAIOAuthConfig::build_auth_url().unwrap();

        // Check that URL contains required parameters
        assert!(result.auth_url.contains("client_id="));
        assert!(result.auth_url.contains("redirect_uri="));
        assert!(result.auth_url.contains("response_type=code"));
        assert!(result.auth_url.contains("scope="));
        assert!(result.auth_url.contains("state="));
        assert!(result.auth_url.contains("code_challenge="));
        assert!(result.auth_url.contains("code_challenge_method=S256"));
        // Check OpenAI-specific params
        assert!(result.auth_url.contains("id_token_add_organizations=true"));
        assert!(result.auth_url.contains("codex_cli_simplified_flow=true"));
        assert!(result.auth_url.contains("originator=solo_ide"));

        // Check that state matches
        assert_eq!(result.state, state.state);

        // Check that code verifier is valid
        assert!(state.code_verifier.len() >= 43);

        // Check provider
        assert_eq!(state.provider, "openai");
    }

    #[test]
    fn test_constants() {
        assert!(OpenAIOAuthConfig::AUTHORIZATION_URL.starts_with("https://"));
        assert!(OpenAIOAuthConfig::TOKEN_URL.starts_with("https://"));
        assert!(!OpenAIOAuthConfig::CLIENT_ID.is_empty());
        assert!(!OpenAIOAuthConfig::SCOPES.is_empty());
        assert!(OpenAIOAuthConfig::SCOPES.contains(&"openid"));
        assert!(OpenAIOAuthConfig::SCOPES.contains(&"offline_access"));
    }

    #[test]
    fn test_extract_account_id_from_jwt() {
        // Create a test JWT with chatgpt_account_id claim
        // Header: {"alg":"none","typ":"JWT"}
        // Payload: {"chatgpt_account_id":"acct_test123","sub":"user123"}
        // Note: This is a test token, not cryptographically signed

        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(r#"{"chatgpt_account_id":"acct_test123","sub":"user123"}"#);
        let signature = "";

        let test_jwt = format!("{}.{}.{}", header, payload, signature);

        let account_id = extract_account_id_from_jwt(&test_jwt);
        assert_eq!(account_id, Some("acct_test123".to_string()));
    }

    #[test]
    fn test_extract_account_id_from_jwt_nested() {
        // Test with nested claim format
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(r#"{"https://api.openai.com/auth":{"chatgpt_account_id":"acct_nested"}}"#);
        let signature = "";

        let test_jwt = format!("{}.{}.{}", header, payload, signature);

        let account_id = extract_account_id_from_jwt(&test_jwt);
        assert_eq!(account_id, Some("acct_nested".to_string()));
    }

    #[test]
    fn test_extract_account_id_invalid_jwt() {
        // Test with invalid JWT
        let result = extract_account_id_from_jwt("not.a.valid.jwt");
        assert!(result.is_none());

        let result = extract_account_id_from_jwt("invalid");
        assert!(result.is_none());
    }
}
