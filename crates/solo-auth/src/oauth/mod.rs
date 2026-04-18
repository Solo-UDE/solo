//! OAuth module for Solo IDE
//!
//! Provides OAuth 2.0 authentication support including:
//! - Browser-based authorization flow with PKCE
//! - Local callback server for receiving redirects
//! - Token management with automatic refresh
//! - Provider-specific configurations

pub mod types;
pub mod pkce;
pub mod callback_server;
pub mod profiles;
pub mod providers;

// Re-export commonly used types
pub use types::{
    AuthMethodInfo, AuthType, Credential, OAuthFlowResult, OAuthMethod, OAuthState, OAuthToken,
    TokenResponse, OpenAITokenResponse, OpenAIOAuthToken,
};
pub use pkce::{generate_code_challenge, generate_code_verifier, generate_state};
pub use callback_server::{start_callback_server, start_callback_server_on, get_callback_url, CallbackError, CallbackResult, CALLBACK_PORT};
pub use providers::AnthropicOAuthConfig;
pub use providers::{GitHubOAuthConfig, DeviceCodeResponse, DevicePollResult};
pub use providers::OpenAIOAuthConfig;
pub use providers::{ClaudeCodeOAuthConfig, ClaudeCodeOAuthFlow, ClaudeAiOAuth, ClaudeCodeCredentials};
pub use profiles::{OAuthProfile, ProviderOAuthStore, migrate_legacy_blob, is_already_migrated};
