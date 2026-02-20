//! Provider types for auth and credential management

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

/// AI Provider types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    Anthropic,
    OpenAI,
    Gemini,
}

impl ProviderType {
    /// Get the string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderType::Anthropic => "anthropic",
            ProviderType::OpenAI => "openai",
            ProviderType::Gemini => "gemini",
        }
    }

    /// Get the display name
    pub fn display_name(&self) -> &'static str {
        match self {
            ProviderType::Anthropic => "Anthropic (Claude)",
            ProviderType::OpenAI => "OpenAI",
            ProviderType::Gemini => "Google (Gemini)",
        }
    }

    /// Get the environment variable name for the API key
    pub fn env_var_name(&self) -> &'static str {
        match self {
            ProviderType::Anthropic => "ANTHROPIC_API_KEY",
            ProviderType::OpenAI => "OPENAI_API_KEY",
            ProviderType::Gemini => "GOOGLE_API_KEY",
        }
    }

    /// Parse from string
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "anthropic" | "claude" => Some(ProviderType::Anthropic),
            "openai" | "gpt" => Some(ProviderType::OpenAI),
            "gemini" | "google" => Some(ProviderType::Gemini),
            _ => None,
        }
    }
}

impl std::fmt::Display for ProviderType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Provider configuration
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ProviderConfig {
    pub provider_type: ProviderType,
    #[serde(skip_serializing)]
    pub api_key: Option<String>,
    pub api_base_url: Option<String>,
    pub default_model: Option<String>,
    pub max_tokens: Option<u32>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            provider_type: ProviderType::Anthropic,
            api_key: None,
            api_base_url: None,
            default_model: None,
            max_tokens: Some(64_000),
        }
    }
}

/// Provider status information
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ProviderStatus {
    pub provider_type: ProviderType,
    pub has_credentials: bool,
    pub credential_source: Option<String>,
    pub is_active: bool,
    pub available_models: Vec<String>,
}

/// Provider errors
#[derive(Error, Debug)]
pub enum ProviderError {
    #[error("API request failed: {0}")]
    ApiError(String),

    #[error("Authentication failed: {0}")]
    AuthError(String),

    #[error("Rate limited: retry after {0} seconds")]
    RateLimited(u32),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Credentials not found for provider: {0}")]
    CredentialsNotFound(ProviderType),

    #[error("Provider not initialized: {0}")]
    ProviderNotInitialized(ProviderType),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Streaming error: {0}")]
    StreamError(String),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Keychain error: {0}")]
    KeychainError(String),

    #[error("{0}")]
    Other(String),
}

/// Result type for provider operations
pub type ProviderResult<T> = Result<T, ProviderError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_type_parsing() {
        assert_eq!(
            ProviderType::from_str("anthropic"),
            Some(ProviderType::Anthropic)
        );
        assert_eq!(
            ProviderType::from_str("claude"),
            Some(ProviderType::Anthropic)
        );
        assert_eq!(ProviderType::from_str("openai"), Some(ProviderType::OpenAI));
        assert_eq!(ProviderType::from_str("gpt"), Some(ProviderType::OpenAI));
        assert_eq!(ProviderType::from_str("gemini"), Some(ProviderType::Gemini));
        assert_eq!(ProviderType::from_str("google"), Some(ProviderType::Gemini));
        assert_eq!(ProviderType::from_str("invalid"), None);
    }

    #[test]
    fn test_provider_config_default() {
        let config = ProviderConfig::default();
        assert_eq!(config.provider_type, ProviderType::Anthropic);
        assert!(config.api_key.is_none());
        assert_eq!(config.max_tokens, Some(64_000));
    }
}
