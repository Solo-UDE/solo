//! OAuth types for Solo IDE
//!
//! Defines OAuth token structures, credential types, and state management
//! for browser-based authentication flows.

use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use ts_rs::TS;

/// Buffer time before token expiry to trigger refresh (15 minutes)
const REFRESH_BUFFER_SECONDS: u64 = 15 * 60;

/// OAuth token with expiration tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthToken {
    /// The access token for API authentication
    pub access_token: String,
    /// Refresh token for obtaining new access tokens (optional)
    pub refresh_token: Option<String>,
    /// Unix timestamp when the token expires
    pub expires_at: u64,
    /// Token type (usually "Bearer")
    pub token_type: String,
    /// Scopes granted by the token
    pub scope: Option<String>,
}

impl OAuthToken {
    /// Create a new OAuth token with expiry calculation
    pub fn new(
        access_token: String,
        refresh_token: Option<String>,
        expires_in: u64,
        token_type: String,
        scope: Option<String>,
    ) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();

        Self {
            access_token,
            refresh_token,
            expires_at: now + expires_in,
            token_type,
            scope,
        }
    }

    /// Check if the token has expired
    pub fn is_expired(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();

        now >= self.expires_at
    }

    /// Check if the token should be refreshed (within buffer time of expiry)
    pub fn needs_refresh(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();

        now + REFRESH_BUFFER_SECONDS >= self.expires_at
    }

    /// Get seconds until token expires (0 if already expired)
    pub fn expires_in_seconds(&self) -> u64 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();

        self.expires_at.saturating_sub(now)
    }

    /// Check if token can be refreshed
    pub fn can_refresh(&self) -> bool {
        self.refresh_token.is_some()
    }
}

/// PKCE and CSRF state for OAuth flow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthState {
    /// Random state parameter for CSRF protection
    pub state: String,
    /// PKCE code verifier (stored locally, not sent to server)
    pub code_verifier: String,
    /// Provider this state is for
    pub provider: String,
    /// Unix timestamp when this state was created
    pub created_at: u64,
}

impl OAuthState {
    /// Create a new OAuth state
    pub fn new(state: String, code_verifier: String, provider: String) -> Self {
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();

        Self {
            state,
            code_verifier,
            provider,
            created_at,
        }
    }

    /// Check if this state has expired (10 minute timeout)
    pub fn is_expired(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();

        // OAuth state expires after 10 minutes
        now > self.created_at + 600
    }
}

/// Unified credential type supporting both API keys and OAuth tokens
#[derive(Debug, Clone)]
pub enum Credential {
    /// Traditional API key
    ApiKey(String),
    /// OAuth access token
    OAuth(OAuthToken),
}

impl Credential {
    /// Get the authorization value for API requests
    pub fn auth_value(&self) -> &str {
        match self {
            Credential::ApiKey(key) => key,
            Credential::OAuth(token) => &token.access_token,
        }
    }

    /// Check if this credential is expired (API keys never expire)
    pub fn is_expired(&self) -> bool {
        match self {
            Credential::ApiKey(_) => false,
            Credential::OAuth(token) => token.is_expired(),
        }
    }

    /// Check if this credential needs refresh
    pub fn needs_refresh(&self) -> bool {
        match self {
            Credential::ApiKey(_) => false,
            Credential::OAuth(token) => token.needs_refresh(),
        }
    }
}

/// OAuth flow method (browser or manual code entry)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "kebab-case")]
pub enum OAuthMethod {
    /// Open browser for authentication
    Browser,
    /// User manually copies and pastes the code
    PasteCode,
}

/// Result from starting an OAuth flow
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct OAuthFlowResult {
    /// The authorization URL to open
    pub auth_url: String,
    /// State parameter to verify callback
    pub state: String,
}

/// Authentication method info for display
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct AuthMethodInfo {
    /// Type of authentication
    pub auth_type: AuthType,
    /// Whether currently authenticated
    pub is_authenticated: bool,
    /// Seconds until token expires (None for API keys)
    pub expires_in_seconds: Option<u64>,
    /// Source of the credential
    pub credential_source: Option<String>,
}

/// Type of authentication method
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "kebab-case")]
pub enum AuthType {
    /// Not authenticated
    None,
    /// API key authentication
    ApiKey,
    /// OAuth token authentication
    OAuth,
    /// Claude Code OAuth (read from Claude Code's keychain)
    ClaudeOAuth,
}

/// Token response from OAuth provider (generic)
#[derive(Debug, Clone, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
    pub scope: Option<String>,
}

impl From<TokenResponse> for OAuthToken {
    fn from(response: TokenResponse) -> Self {
        OAuthToken::new(
            response.access_token,
            response.refresh_token,
            response.expires_in,
            response.token_type,
            response.scope,
        )
    }
}

/// Token response from OpenAI OAuth (includes id_token)
#[derive(Debug, Clone, Deserialize)]
pub struct OpenAITokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
    pub scope: Option<String>,
    /// JWT containing ChatGPT account information
    pub id_token: Option<String>,
}

/// OpenAI OAuth token with ChatGPT account ID
///
/// This extends the standard OAuth token with OpenAI-specific fields
/// needed for API authentication (ChatGPT-Account-Id header).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAIOAuthToken {
    /// The access token for API authentication
    pub access_token: String,
    /// Refresh token for obtaining new access tokens
    pub refresh_token: Option<String>,
    /// Unix timestamp when the token expires
    pub expires_at: u64,
    /// Token type (usually "Bearer")
    pub token_type: String,
    /// Scopes granted by the token
    pub scope: Option<String>,
    /// JWT id_token from OpenAI (contains account info)
    pub id_token: Option<String>,
    /// ChatGPT account ID extracted from id_token
    /// Required for API calls via ChatGPT-Account-Id header
    pub account_id: Option<String>,
    /// Email extracted from the id_token's `email` claim. `None` if the JWT
    /// did not include one (e.g. older tokens, stripped by refresh flow).
    #[serde(default)]
    pub email: Option<String>,
}

impl OpenAIOAuthToken {
    /// Create a new OpenAI OAuth token from a token response
    pub fn from_response(
        response: OpenAITokenResponse,
        account_id: Option<String>,
        email: Option<String>,
    ) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(std::time::Duration::ZERO)
            .as_secs();

        Self {
            access_token: response.access_token,
            refresh_token: response.refresh_token,
            expires_at: now + response.expires_in,
            token_type: response.token_type,
            scope: response.scope,
            id_token: response.id_token,
            account_id,
            email,
        }
    }

    /// Check if the token has expired
    pub fn is_expired(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(std::time::Duration::ZERO)
            .as_secs();

        now >= self.expires_at
    }

    /// Check if the token should be refreshed (within buffer time of expiry)
    pub fn needs_refresh(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(std::time::Duration::ZERO)
            .as_secs();

        // Refresh 15 minutes before expiry
        now + (15 * 60) >= self.expires_at
    }

    /// Get seconds until token expires (0 if already expired)
    pub fn expires_in_seconds(&self) -> u64 {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(std::time::Duration::ZERO)
            .as_secs();

        self.expires_at.saturating_sub(now)
    }

    /// Check if token can be refreshed
    pub fn can_refresh(&self) -> bool {
        self.refresh_token.is_some()
    }

    /// Convert to standard OAuthToken (loses OpenAI-specific fields)
    pub fn to_oauth_token(&self) -> OAuthToken {
        OAuthToken {
            access_token: self.access_token.clone(),
            refresh_token: self.refresh_token.clone(),
            expires_at: self.expires_at,
            token_type: self.token_type.clone(),
            scope: self.scope.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_oauth_token_expiry() {
        // Token that expires in 1 hour
        let token = OAuthToken::new(
            "access".to_string(),
            Some("refresh".to_string()),
            3600,
            "Bearer".to_string(),
            None,
        );

        assert!(!token.is_expired());
        assert!(!token.needs_refresh());
        assert!(token.expires_in_seconds() > 0);
        assert!(token.can_refresh());
    }

    #[test]
    fn test_oauth_token_needs_refresh() {
        // Token that expires in 5 minutes (within 15-min buffer)
        let token = OAuthToken::new(
            "access".to_string(),
            None,
            300,
            "Bearer".to_string(),
            None,
        );

        assert!(!token.is_expired());
        assert!(token.needs_refresh()); // Should need refresh
        assert!(!token.can_refresh()); // No refresh token
    }

    #[test]
    fn test_credential_api_key() {
        let cred = Credential::ApiKey("sk-test".to_string());
        assert_eq!(cred.auth_value(), "sk-test");
        assert!(!cred.is_expired());
        assert!(!cred.needs_refresh());
    }

    #[test]
    fn test_oauth_state_expiry() {
        let state = OAuthState::new(
            "state123".to_string(),
            "verifier123".to_string(),
            "anthropic".to_string(),
        );

        assert!(!state.is_expired());
    }
}
