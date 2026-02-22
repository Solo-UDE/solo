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
pub use provider::{ProviderConfig, ProviderError, ProviderResult, ProviderStatus, ProviderType};
pub use oauth::{
    AuthMethodInfo, AuthType, GitHubOAuthConfig, OAuthFlowResult, OAuthMethod, OAuthState,
    OAuthToken, AnthropicOAuthConfig, OpenAIOAuthConfig,
    DeviceCodeResponse, DevicePollResult,
    start_callback_server,
};
