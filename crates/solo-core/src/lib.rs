#![warn(clippy::all, clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::wildcard_imports,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::uninlined_format_args,
    clippy::doc_markdown,
    clippy::return_self_not_must_use,
    clippy::redundant_closure_for_method_calls,
    clippy::single_match_else,
    clippy::if_not_else,
    clippy::match_same_arms,
    clippy::map_unwrap_or,
    clippy::similar_names,
    clippy::struct_excessive_bools
)]

//! Solo Core - Core traits and types for the Solo IDE
//!
//! This crate provides the foundational abstractions used across
//! the Solo IDE, including traits for services and common types.

use thiserror::Error;

/// Core error types for the Solo IDE
#[derive(Error, Debug)]
pub enum SoloError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Terminal error: {0}")]
    Terminal(String),

    #[error("Agent error: {0}")]
    Agent(String),

    #[error("File system error: {0}")]
    FileSystem(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("{0}")]
    Other(String),
}

/// Result type alias for Solo operations
pub type SoloResult<T> = Result<T, SoloError>;

/// Trait for services that can be started and stopped
#[async_trait::async_trait]
pub trait Service: Send + Sync {
    /// Start the service
    async fn start(&self) -> SoloResult<()>;

    /// Stop the service gracefully
    async fn stop(&self) -> SoloResult<()>;

    /// Check if the service is running
    fn is_running(&self) -> bool;
}

/// Configuration for the Solo IDE
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct SoloConfig {
    /// Path to the workspace root
    pub workspace_root: Option<String>,

    /// Terminal configuration
    pub terminal: TerminalConfig,

    /// AI agent configuration
    pub agent: AgentConfig,
}

/// Terminal configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TerminalConfig {
    /// Default shell to use
    pub shell: Option<String>,

    /// Font size in pixels
    pub font_size: u32,

    /// Font family
    pub font_family: String,
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            shell: None,
            font_size: 14,
            font_family: "JetBrains Mono, Menlo, Monaco, monospace".to_string(),
        }
    }
}

/// AI Agent configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentConfig {
    /// Anthropic API key (loaded from environment)
    #[serde(skip_serializing)]
    pub api_key: Option<String>,

    /// Model to use
    pub model: String,

    /// Maximum tokens in response
    pub max_tokens: u32,
}

pub const DEFAULT_MODEL_ID: &str = "claude-opus-4-6";

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            model: DEFAULT_MODEL_ID.to_string(),
            max_tokens: 4096,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = SoloConfig::default();
        assert!(config.workspace_root.is_none());
        assert_eq!(config.terminal.font_size, 14);
        assert_eq!(config.agent.model, DEFAULT_MODEL_ID);
    }
}
