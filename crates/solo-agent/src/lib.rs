//! Solo Agent - AI agent for Solo IDE
//!
//! This crate provides session management, tool infrastructure, and model
//! definitions for the AI agent. All LLM communication is routed through the
//! Solo server (Vercel AI SDK) via WebSocket — no direct API providers remain.

pub mod provider;
pub mod models;
pub mod tools;
pub mod system_prompt;
pub mod keychain;

// Re-export main types
pub use provider::{ProviderType, ProviderConfig, ProviderError, ProviderResult, ToolDefinition};
pub use models::{AIModel, ModelCapabilities};
pub use tools::{ToolRegistry, ToolExecutor, ToolError, ToolContext, SharedWorkspaceRoot, create_default_registry};
pub use system_prompt::build_system_prompt;
pub use keychain::{set_api_key, get_api_key, has_api_key, clear_api_key};

use solo_protocol::AgentMessage;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Agent session state (message history only — LLM calls go through server)
pub struct AgentSession {
    /// Conversation history
    messages: Vec<AgentMessage>,
    /// Session ID
    pub session_id: String,
    /// Current model
    pub model: String,
}

impl AgentSession {
    /// Create a new agent session
    pub fn new(session_id: String, model: String) -> Self {
        Self {
            messages: Vec::new(),
            session_id,
            model,
        }
    }

    /// Add a message to the conversation history
    pub fn add_message(&mut self, message: AgentMessage) {
        self.messages.push(message);
    }

    /// Get conversation history
    pub fn history(&self) -> &[AgentMessage] {
        &self.messages
    }

    /// Clear conversation history
    pub fn clear_history(&mut self) {
        self.messages.clear();
    }
}

/// Agent manager for handling sessions and tools
pub struct AgentManager {
    /// Active sessions
    sessions: RwLock<std::collections::HashMap<String, AgentSession>>,
    /// Active provider type (for model picker / settings)
    active_provider: RwLock<ProviderType>,
    /// Tool registry
    tool_registry: Arc<RwLock<ToolRegistry>>,
}

impl AgentManager {
    /// Create a new agent manager
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(std::collections::HashMap::new()),
            active_provider: RwLock::new(ProviderType::Anthropic),
            tool_registry: Arc::new(RwLock::new(create_default_registry())),
        }
    }

    /// Get the tool registry
    pub fn tool_registry(&self) -> Arc<RwLock<ToolRegistry>> {
        self.tool_registry.clone()
    }

    /// Get all tool definitions
    pub async fn get_tool_definitions(&self) -> Vec<ToolDefinition> {
        self.tool_registry.read().await.definitions()
    }

    /// Execute a tool call
    pub async fn execute_tool(&self, tool_call: &solo_protocol::AgentToolCall) -> solo_protocol::ToolResult {
        let registry = self.tool_registry.read().await;
        registry.execute(tool_call).await
    }

    /// Get the active provider type
    pub async fn get_active_provider(&self) -> ProviderType {
        *self.active_provider.read().await
    }

    /// Set the active provider type
    pub async fn set_active_provider(&self, provider_type: ProviderType) {
        *self.active_provider.write().await = provider_type;
    }

    /// Create a new session
    pub async fn create_session(&self, session_id: String, model: Option<String>) -> ProviderResult<()> {
        let provider_type = self.get_active_provider().await;
        let model = model.unwrap_or_else(|| {
            models::get_default_model(provider_type).id.to_string()
        });

        let session = AgentSession::new(session_id.clone(), model);
        self.sessions.write().await.insert(session_id, session);
        Ok(())
    }

    /// Update the model for an existing session
    pub async fn update_session_model(&self, session_id: &str, model: String) -> ProviderResult<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| ProviderError::SessionNotFound(session_id.to_string()))?;
        session.model = model;
        Ok(())
    }

    /// Get a session by ID (returns read guard over all sessions)
    pub async fn get_session(&self, session_id: &str) -> Option<tokio::sync::RwLockReadGuard<'_, std::collections::HashMap<String, AgentSession>>> {
        let sessions = self.sessions.read().await;
        if sessions.contains_key(session_id) {
            Some(sessions)
        } else {
            None
        }
    }

    /// Check if a provider has credentials (via keychain)
    pub async fn has_credentials(&self, provider_type: ProviderType) -> bool {
        has_api_key(provider_type.as_str()).unwrap_or(false)
    }
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_type_display() {
        assert_eq!(ProviderType::Anthropic.as_str(), "anthropic");
        assert_eq!(ProviderType::OpenAI.as_str(), "openai");
    }
}
