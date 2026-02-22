//! OAuth provider configurations
//!
//! Contains provider-specific OAuth configuration including endpoints,
//! client IDs, and scope requirements.

pub mod anthropic;
pub mod claude_code;
pub mod github;
pub mod openai;

pub use anthropic::AnthropicOAuthConfig;
pub use claude_code::{ClaudeCodeOAuthConfig, ClaudeCodeOAuthFlow, ClaudeAiOAuth, ClaudeCodeCredentials};
pub use github::{GitHubOAuthConfig, DeviceCodeResponse, DevicePollResult};
pub use openai::OpenAIOAuthConfig;
