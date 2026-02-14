//! Solo Agent - Multi-provider AI agent for Solo IDE
//!
//! This crate provides a unified interface for interacting with multiple AI providers
//! (Anthropic/Claude and OpenAI) with support for streaming responses, tool use, and
//! credential management.

pub mod provider;
pub mod models;
pub mod credentials;
pub mod anthropic;
pub mod openai;
pub mod gemini;
pub mod claude_cli;
pub mod tools;
pub mod middleware;
pub mod telemetry;
pub mod oauth;
pub mod system_prompt;

// Re-export main types
pub use provider::{AIProvider, ProviderType, ProviderConfig, ProviderError, ProviderResult, ToolDefinition};
pub use models::{AIModel, ModelCapabilities};
pub use credentials::{CredentialManager, CredentialSource};
pub use anthropic::AnthropicProvider;
pub use openai::OpenAIProvider;
pub use gemini::GeminiProvider;
pub use claude_cli::ClaudeCliProvider;
pub use tools::{ToolRegistry, ToolExecutor, ToolError, ToolContext, SharedWorkspaceRoot, create_default_registry};
pub use middleware::{
    Middleware, MiddlewareChain, MiddlewareContext, MiddlewareResponse,
    LoggingMiddleware, RateLimitMiddleware, GuardrailsMiddleware, MetricsMiddleware,
    MiddlewareMetrics, create_default_middleware_chain, create_production_middleware_chain,
};
pub use telemetry::{
    TelemetryCollector, TelemetryEvent, TelemetryValue, SpanTracker,
    AITelemetry, TelemetrySummary,
};
pub use system_prompt::build_system_prompt;

use solo_protocol::{AgentMessage, AgentToolCall, BackendEvent, ToolCallWithStatus, ToolResult};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Agent session state
pub struct AgentSession {
    /// Current provider
    provider: Arc<dyn AIProvider>,
    /// Conversation history
    messages: Vec<AgentMessage>,
    /// Session ID
    pub session_id: String,
    /// Current model
    pub model: String,
}

impl AgentSession {
    /// Create a new agent session
    pub fn new(provider: Arc<dyn AIProvider>, session_id: String, model: String) -> Self {
        Self {
            provider,
            messages: Vec::new(),
            session_id,
            model,
        }
    }

    /// Send a message and get a streaming response
    pub async fn send_message(
        &mut self,
        content: String,
        system_prompt: Option<String>,
    ) -> ProviderResult<tokio::sync::mpsc::Receiver<BackendEvent>> {
        // Add user message to history
        self.messages.push(AgentMessage::text("user", &content));

        // Send to provider
        let receiver = self
            .provider
            .send_message(
                &self.session_id,
                &self.model,
                &self.messages,
                system_prompt.as_deref(),
            )
            .await?;

        Ok(receiver)
    }

    /// Continue the session by re-sending the current history to the LLM
    /// (used by the agentic loop after adding tool results)
    pub async fn continue_conversation(
        &self,
        system_prompt: Option<String>,
    ) -> ProviderResult<tokio::sync::mpsc::Receiver<BackendEvent>> {
        let receiver = self
            .provider
            .send_message(
                &self.session_id,
                &self.model,
                &self.messages,
                system_prompt.as_deref(),
            )
            .await?;

        Ok(receiver)
    }

    /// Add an arbitrary message to the conversation history
    pub fn add_message(&mut self, message: AgentMessage) {
        self.messages.push(message);
    }

    /// Add an assistant message with text and optional tool calls
    pub fn add_assistant_message(&mut self, text: &str, tool_calls: &[AgentToolCall]) {
        self.messages
            .push(AgentMessage::assistant_with_tools(text, tool_calls));
    }

    /// Add a tool result message (proper format for all providers)
    pub fn add_tool_result(&mut self, tool_call_id: &str, result: &str, is_error: bool) {
        self.messages
            .push(AgentMessage::tool_result(tool_call_id, result, is_error));
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

/// Agent manager for handling multiple sessions and providers
pub struct AgentManager {
    /// Available providers
    providers: RwLock<std::collections::HashMap<ProviderType, Arc<dyn AIProvider>>>,
    /// Active sessions
    sessions: RwLock<std::collections::HashMap<String, AgentSession>>,
    /// Credential manager
    credentials: Arc<CredentialManager>,
    /// Active provider type
    active_provider: RwLock<ProviderType>,
    /// Tool registry
    tool_registry: Arc<RwLock<ToolRegistry>>,
    /// Middleware chain for request/response processing
    middleware: Arc<RwLock<MiddlewareChain>>,
    /// Telemetry collector
    telemetry: Arc<TelemetryCollector>,
    /// AI telemetry helper
    ai_telemetry: Arc<AITelemetry>,
}

impl AgentManager {
    /// Create a new agent manager
    pub fn new(credentials: Arc<CredentialManager>) -> Self {
        let telemetry = Arc::new(TelemetryCollector::new(1000));
        let ai_telemetry = Arc::new(AITelemetry::new(telemetry.clone()));

        Self {
            providers: RwLock::new(std::collections::HashMap::new()),
            sessions: RwLock::new(std::collections::HashMap::new()),
            credentials,
            active_provider: RwLock::new(ProviderType::Anthropic),
            tool_registry: Arc::new(RwLock::new(create_default_registry())),
            middleware: Arc::new(RwLock::new(create_default_middleware_chain())),
            telemetry,
            ai_telemetry,
        }
    }

    /// Get the tool registry
    pub fn tool_registry(&self) -> Arc<RwLock<ToolRegistry>> {
        self.tool_registry.clone()
    }

    /// Get the telemetry collector
    pub fn telemetry(&self) -> Arc<TelemetryCollector> {
        self.telemetry.clone()
    }

    /// Get telemetry summary
    pub async fn get_telemetry_summary(&self) -> TelemetrySummary {
        self.ai_telemetry.get_summary().await
    }

    /// Get all tool definitions
    pub async fn get_tool_definitions(&self) -> Vec<ToolDefinition> {
        self.tool_registry.read().await.definitions()
    }

    /// Execute a tool call.
    /// Acquires RwLock briefly to clone the Arc<ToolRegistry>, then releases
    /// the lock before awaiting tool execution.
    pub async fn execute_tool(&self, tool_call: &AgentToolCall) -> ToolResult {
        let start = std::time::Instant::now();

        // Clone the registry Arc, then drop the lock before await
        let registry = self.tool_registry.read().await;
        let result = registry.execute(tool_call).await;
        drop(registry);

        // Record telemetry
        let duration_ms = start.elapsed().as_millis() as u64;
        self.ai_telemetry
            .record_tool_call(
                "global",
                &tool_call.name,
                duration_ms,
                result.success,
            )
            .await;

        result
    }

    /// Check if a tool requires approval
    pub async fn tool_requires_approval(&self, tool_name: &str) -> bool {
        self.tool_registry.read().await.requires_approval(tool_name)
    }

    /// Approve a pending tool call
    pub async fn approve_tool_call(&self, tool_call_id: &str) -> Result<ToolCallWithStatus, ToolError> {
        self.tool_registry.read().await.approve(tool_call_id).await
    }

    /// Reject a pending tool call
    pub async fn reject_tool_call(&self, tool_call_id: &str) -> Result<ToolCallWithStatus, ToolError> {
        self.tool_registry.read().await.reject(tool_call_id).await
    }

    /// Initialize a provider with credentials and register tools from the registry
    pub async fn initialize_provider(&self, provider_type: ProviderType) -> ProviderResult<()> {
        let credential_info = self
            .credentials
            .get_credentials_with_source(provider_type)
            .await?
            .ok_or_else(|| ProviderError::CredentialsNotFound(provider_type))?;

        // Get tool definitions from registry to set on the provider
        let tools = self.tool_registry.read().await.definitions();

        let mut provider: Box<dyn AIProvider> = match provider_type {
            ProviderType::Anthropic => {
                match credential_info.source {
                    // OAuth tokens (Claude Code or Solo) CANNOT be used for direct API calls
                    // with x-api-key header. They must go through the CLI which handles
                    // subscription billing and proper Bearer auth.
                    CredentialSource::ClaudeOAuth
                    | CredentialSource::ClaudeOAuthFile
                    | CredentialSource::SoloOAuth => {
                        // Check if CLI is available
                        if !claude_cli::is_cli_available().await {
                            return Err(ProviderError::AuthError(
                                "OAuth token detected but CLI not installed. \
                                 Either install Claude CLI (`npm i -g @anthropic-ai/claude-code`) \
                                 or add an Anthropic API key."
                                    .to_string(),
                            ));
                        }
                        Box::new(ClaudeCliProvider::new())
                    }
                    // Only API keys (from keychain or env) can use direct API with x-api-key
                    CredentialSource::Keychain | CredentialSource::Environment => {
                        Box::new(AnthropicProvider::new(credential_info.api_key))
                    }
                }
            }
            ProviderType::OpenAI => {
                Box::new(OpenAIProvider::new_with_oauth(
                    credential_info.api_key,
                    credential_info.account_id,
                ))
            }
            ProviderType::Gemini => Box::new(GeminiProvider::new(credential_info.api_key)),
        };

        // Set tools before wrapping in Arc (since set_tools requires &mut self)
        provider.set_tools(tools);

        let provider: Arc<dyn AIProvider> = Arc::from(provider);
        self.providers.write().await.insert(provider_type, provider);
        Ok(())
    }

    /// Get the active provider
    pub async fn get_active_provider(&self) -> ProviderType {
        *self.active_provider.read().await
    }

    /// Check if a provider is initialized
    pub async fn is_provider_initialized(&self, provider_type: ProviderType) -> bool {
        self.providers.read().await.contains_key(&provider_type)
    }

    /// Re-initialize a provider, clearing the cached instance first.
    ///
    /// This is necessary when credentials change (e.g., user runs `claude login`)
    /// and we need to pick the correct provider type (CLI vs Direct API) based
    /// on the new credential source.
    pub async fn reinitialize_provider(&self, provider_type: ProviderType) -> ProviderResult<()> {
        // Remove cached provider
        self.providers.write().await.remove(&provider_type);
        // Re-initialize with fresh credentials
        self.initialize_provider(provider_type).await
    }

    /// Set the active provider
    pub async fn set_active_provider(&self, provider_type: ProviderType) -> ProviderResult<()> {
        // Ensure provider is initialized
        if !self.providers.read().await.contains_key(&provider_type) {
            self.initialize_provider(provider_type).await?;
        }
        *self.active_provider.write().await = provider_type;
        Ok(())
    }

    /// Create a new session
    pub async fn create_session(&self, session_id: String, model: Option<String>) -> ProviderResult<()> {
        let provider_type = self.get_active_provider().await;
        let providers = self.providers.read().await;

        let provider = providers
            .get(&provider_type)
            .ok_or_else(|| ProviderError::ProviderNotInitialized(provider_type))?
            .clone();

        let model = model.unwrap_or_else(|| {
            models::get_default_model(provider_type).id.to_string()
        });

        let session = AgentSession::new(provider, session_id.clone(), model);
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

    /// Get a session by ID
    pub async fn get_session(&self, session_id: &str) -> Option<tokio::sync::RwLockReadGuard<'_, std::collections::HashMap<String, AgentSession>>> {
        let sessions = self.sessions.read().await;
        if sessions.contains_key(session_id) {
            Some(sessions)
        } else {
            None
        }
    }

    /// Add a message to a session's history (used by the agentic loop)
    pub async fn add_message_to_session(
        &self,
        session_id: &str,
        message: AgentMessage,
    ) -> ProviderResult<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| ProviderError::SessionNotFound(session_id.to_string()))?;
        session.add_message(message);
        Ok(())
    }

    /// Continue a session by re-sending history to the LLM (no new user message)
    pub async fn continue_session(
        &self,
        session_id: &str,
        system_prompt: Option<String>,
    ) -> ProviderResult<tokio::sync::mpsc::Receiver<BackendEvent>> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| ProviderError::SessionNotFound(session_id.to_string()))?;
        session.continue_conversation(system_prompt).await
    }

    /// Send a message in a session, running middleware before/after
    pub async fn send_message(
        &self,
        session_id: &str,
        content: String,
        system_prompt: Option<String>,
    ) -> ProviderResult<tokio::sync::mpsc::Receiver<BackendEvent>> {
        // Build middleware context
        let messages = vec![AgentMessage::text("user", &content)];
        let model = {
            let sessions = self.sessions.read().await;
            sessions
                .get(session_id)
                .map(|s| s.model.clone())
                .unwrap_or_default()
        };

        let mut ctx = MiddlewareContext::new(
            session_id.to_string(),
            model.clone(),
            messages,
            system_prompt.clone(),
        );

        // Run before_request middleware
        let middleware = self.middleware.read().await;
        if let Some(short_circuit_events) = middleware.before_request(&mut ctx).await? {
            // Middleware handled the request (e.g., rate limit exceeded)
            let (tx, rx) = tokio::sync::mpsc::channel(short_circuit_events.len() + 1);
            for event in short_circuit_events {
                let _ = tx.send(event).await;
            }
            return Ok(rx);
        }
        drop(middleware);

        // Start telemetry span
        let mut tracker = self.ai_telemetry.start_request(session_id, &model);

        // Actually send the message
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| ProviderError::SessionNotFound(session_id.to_string()))?;

        let result = session.send_message(content, system_prompt).await;

        match &result {
            Ok(_) => {
                tracker.set_attribute("success", true);
            }
            Err(e) => {
                tracker.set_attribute("success", false);
                tracker.set_attribute("error", e.to_string());
                // Notify middleware of error
                let middleware = self.middleware.read().await;
                let _ = middleware.on_error(&ctx, &e.to_string()).await;
            }
        }

        tracker.end().await;

        result
    }

    /// Add an assistant message to a session's conversation history.
    /// Must be called after streaming completes so subsequent turns
    /// include the assistant's response in the context.
    pub async fn add_assistant_message(
        &self,
        session_id: &str,
        content: &str,
        tool_calls: &[AgentToolCall],
    ) -> ProviderResult<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| ProviderError::SessionNotFound(session_id.to_string()))?;
        session.add_assistant_message(content, tool_calls);
        Ok(())
    }

    /// Check if a provider has credentials
    pub async fn has_credentials(&self, provider_type: ProviderType) -> bool {
        self.credentials
            .get_credentials(provider_type)
            .await
            .map(|c| c.is_some())
            .unwrap_or(false)
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
