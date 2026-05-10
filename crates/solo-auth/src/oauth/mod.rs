//! OAuth module for Solo IDE
//!
//! Provides OAuth 2.0 authentication support including:
//! - Browser-based authorization flow with PKCE
//! - Local callback server for receiving redirects
//! - Token management with automatic refresh
//! - Provider-specific configurations

pub mod callback_server;
pub mod pkce;
pub mod profiles;
pub mod providers;
pub mod types;

// Re-export commonly used types
pub use callback_server::{
    bind_callback_listener_on, get_callback_url, start_callback_server, start_callback_server_on,
    start_callback_server_with_listener, CallbackError, CallbackResult, CALLBACK_PORT,
};
pub use pkce::{generate_code_challenge, generate_code_verifier, generate_state};
pub use profiles::{is_already_migrated, migrate_legacy_blob, OAuthProfile, ProviderOAuthStore};
pub use providers::AnthropicOAuthConfig;
pub use providers::OpenAIOAuthConfig;
pub use providers::{
    ClaudeAiOAuth, ClaudeCodeCredentials, ClaudeCodeOAuthConfig, ClaudeCodeOAuthFlow,
};
pub use providers::{DeviceCodeResponse, DevicePollResult, GitHubOAuthConfig};
pub use types::{
    AuthMethodInfo, AuthType, Credential, OAuthFlowResult, OAuthMethod, OAuthState, OAuthToken,
    OpenAIOAuthToken, OpenAITokenResponse, TokenResponse,
};
