//! Solo Auth - Authentication, credentials, and provider management
//!
//! Provides OAuth 2.0, API key, and Claude Code CLI credential management
//! for Solo IDE's multi-provider AI system.

pub mod credentials;
pub mod models;
pub mod oauth;
pub mod provider;

// Re-export commonly used types
pub use credentials::{CredentialManager, CredentialSource};
pub use models::{get_all_models, get_models_for_provider, AIModel};
pub use oauth::{
    start_callback_server, AnthropicOAuthConfig, AuthMethodInfo, AuthType, DeviceCodeResponse,
    DevicePollResult, GitHubOAuthConfig, OAuthFlowResult, OAuthMethod, OAuthState, OAuthToken,
    OpenAIOAuthConfig,
};
pub use provider::{ProviderConfig, ProviderError, ProviderResult, ProviderStatus, ProviderType};

/// Issue a single-turn Claude completion using whatever Anthropic credential
/// is stored in `credentials` (Solo OAuth, API key, Claude Code OAuth, or env).
///
/// - OAuth-derived tokens (Solo OAuth, Claude Code OAuth) are sent as
///   `Authorization: Bearer {token}`.
/// - Raw API keys (keychain vault or `ANTHROPIC_API_KEY` env var) are sent as
///   `x-api-key: {key}`.
///
/// Returns the assistant text from the first content block.
pub async fn claude_simple_completion(
    credentials: &CredentialManager,
    model: &str,
    system: &str,
    user: &str,
) -> ProviderResult<String> {
    // Fetch credential + source to determine which header to use.
    let cred_info = credentials
        .get_credentials_with_source(ProviderType::Anthropic)
        .await?
        .ok_or(ProviderError::CredentialsNotFound(ProviderType::Anthropic))?;

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "system": system,
        "messages": [{ "role": "user", "content": user }],
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| ProviderError::ApiError(format!("failed to build HTTP client: {e}")))?;

    // Choose auth header based on credential source.
    let req = match cred_info.source {
        CredentialSource::SoloOAuth
        | CredentialSource::ClaudeOAuth
        | CredentialSource::ClaudeOAuthFile
        | CredentialSource::CodexOAuthFile => client
            .post("https://api.anthropic.com/v1/messages")
            .bearer_auth(&cred_info.api_key)
            .header("anthropic-version", "2023-06-01"),
        CredentialSource::Keychain | CredentialSource::Environment => client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &cred_info.api_key)
            .header("anthropic-version", "2023-06-01"),
    };

    let resp = req
        .json(&body)
        .send()
        .await
        .map_err(|e| ProviderError::ApiError(format!("Claude API request failed: {e}")))?
        .error_for_status()
        .map_err(|e| ProviderError::ApiError(format!("Claude API error: {e}")))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| ProviderError::ApiError(format!("Failed to parse Claude response: {e}")))?;

    let text = resp
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| {
            ProviderError::ApiError(format!("unexpected Claude response shape: {}", resp))
        })?
        .to_string();

    Ok(text)
}
