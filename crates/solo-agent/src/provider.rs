//! Provider trait and types for multi-provider AI support

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use solo_protocol::{AgentMessage, BackendEvent};
use thiserror::Error;
use ts_rs::TS;

/// AI Provider types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    Anthropic,
    OpenAI,
}

impl ProviderType {
    /// Get the string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderType::Anthropic => "anthropic",
            ProviderType::OpenAI => "openai",
        }
    }

    /// Get the display name
    pub fn display_name(&self) -> &'static str {
        match self {
            ProviderType::Anthropic => "Anthropic (Claude)",
            ProviderType::OpenAI => "OpenAI",
        }
    }

    /// Get the environment variable name for the API key
    pub fn env_var_name(&self) -> &'static str {
        match self {
            ProviderType::Anthropic => "ANTHROPIC_API_KEY",
            ProviderType::OpenAI => "OPENAI_API_KEY",
        }
    }

    /// Parse from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "anthropic" | "claude" => Some(ProviderType::Anthropic),
            "openai" | "gpt" => Some(ProviderType::OpenAI),
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
    /// Provider type
    pub provider_type: ProviderType,
    /// API key (not serialized for security)
    #[serde(skip_serializing)]
    pub api_key: Option<String>,
    /// Custom API base URL (for proxies or self-hosted)
    pub api_base_url: Option<String>,
    /// Default model to use
    pub default_model: Option<String>,
    /// Maximum tokens for responses
    pub max_tokens: Option<u32>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            provider_type: ProviderType::Anthropic,
            api_key: None,
            api_base_url: None,
            default_model: None,
            max_tokens: Some(8192),
        }
    }
}

/// Provider status information
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ProviderStatus {
    /// Provider type
    pub provider_type: ProviderType,
    /// Whether credentials are configured
    pub has_credentials: bool,
    /// Source of credentials (env, keychain, etc.)
    pub credential_source: Option<String>,
    /// Whether the provider is currently active
    pub is_active: bool,
    /// Available models for this provider
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

    #[error("HTTP error: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Keychain error: {0}")]
    KeychainError(String),

    #[error("{0}")]
    Other(String),
}

/// Result type for provider operations
pub type ProviderResult<T> = Result<T, ProviderError>;

/// Tool definition for the provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// Tool name
    pub name: String,
    /// Tool description
    pub description: String,
    /// Input schema as JSON
    pub input_schema: serde_json::Value,
}

/// Trait for AI providers
#[async_trait]
pub trait AIProvider: Send + Sync {
    /// Get the provider type
    fn provider_type(&self) -> ProviderType;

    /// Send a message and receive streaming responses via channel
    async fn send_message(
        &self,
        conversation_id: &str,
        model: &str,
        messages: &[AgentMessage],
        system_prompt: Option<&str>,
    ) -> ProviderResult<tokio::sync::mpsc::Receiver<BackendEvent>>;

    /// Get available models for this provider
    fn available_models(&self) -> Vec<String>;

    /// Validate API key
    async fn validate_credentials(&self) -> ProviderResult<bool>;

    /// Set tools for tool use
    fn set_tools(&mut self, tools: Vec<ToolDefinition>);

    /// Get current tools
    fn get_tools(&self) -> &[ToolDefinition];
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_type_parsing() {
        assert_eq!(ProviderType::from_str("anthropic"), Some(ProviderType::Anthropic));
        assert_eq!(ProviderType::from_str("claude"), Some(ProviderType::Anthropic));
        assert_eq!(ProviderType::from_str("openai"), Some(ProviderType::OpenAI));
        assert_eq!(ProviderType::from_str("gpt"), Some(ProviderType::OpenAI));
        assert_eq!(ProviderType::from_str("invalid"), None);
    }

    #[test]
    fn test_provider_config_default() {
        let config = ProviderConfig::default();
        assert_eq!(config.provider_type, ProviderType::Anthropic);
        assert!(config.api_key.is_none());
        assert_eq!(config.max_tokens, Some(8192));
    }
}
