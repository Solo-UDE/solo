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
pub mod tools;
pub mod middleware;
pub mod telemetry;
pub mod oauth;

// Re-export main types
pub use provider::{AIProvider, ProviderType, ProviderConfig, ProviderError, ProviderResult, ToolDefinition};
pub use models::{AIModel, ModelCapabilities, MODEL_REGISTRY};
pub use credentials::{CredentialManager, CredentialSource};
pub use anthropic::AnthropicProvider;
pub use openai::OpenAIProvider;
pub use tools::{ToolRegistry, ToolExecutor, ToolError, ToolContext, create_default_registry};
pub use middleware::{
    Middleware, MiddlewareChain, MiddlewareContext, MiddlewareResponse,
    LoggingMiddleware, RateLimitMiddleware, GuardrailsMiddleware, MetricsMiddleware,
    MiddlewareMetrics, create_default_middleware_chain, create_production_middleware_chain,
};
pub use telemetry::{
    TelemetryCollector, TelemetryEvent, TelemetryValue, SpanTracker,
    AITelemetry, TelemetrySummary,
};

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
        self.messages.push(AgentMessage {
            role: "user".to_string(),
            content: content.clone(),
            tool_calls: None,
        });

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

    /// Add an assistant message (called after streaming completes)
    pub fn add_assistant_message(&mut self, content: String, tool_calls: Option<Vec<AgentToolCall>>) {
        self.messages.push(AgentMessage {
            role: "assistant".to_string(),
            content,
            tool_calls,
        });
    }

    /// Add a tool result message
    pub fn add_tool_result(&mut self, tool_call_id: &str, result: &str) {
        // For Anthropic, tool results are user messages with special content
        self.messages.push(AgentMessage {
            role: "user".to_string(),
            content: format!("[Tool Result for {}]: {}", tool_call_id, result),
            tool_calls: None,
        });
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

    /// Initialize a provider with credentials
    pub async fn initialize_provider(&self, provider_type: ProviderType) -> ProviderResult<()> {
        let api_key = self
            .credentials
            .get_credentials(provider_type)
            .await?
            .ok_or_else(|| ProviderError::CredentialsNotFound(provider_type))?;

        let provider: Arc<dyn AIProvider> = match provider_type {
            ProviderType::Anthropic => Arc::new(AnthropicProvider::new(api_key)),
            ProviderType::OpenAI => Arc::new(OpenAIProvider::new(api_key)),
        };

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

    /// Get a session by ID
    pub async fn get_session(&self, session_id: &str) -> Option<tokio::sync::RwLockReadGuard<'_, std::collections::HashMap<String, AgentSession>>> {
        let sessions = self.sessions.read().await;
        if sessions.contains_key(session_id) {
            Some(sessions)
        } else {
            None
        }
    }

    /// Send a message in a session, running middleware before/after
    pub async fn send_message(
        &self,
        session_id: &str,
        content: String,
        system_prompt: Option<String>,
    ) -> ProviderResult<tokio::sync::mpsc::Receiver<BackendEvent>> {
        // Build middleware context
        let messages = vec![AgentMessage {
            role: "user".to_string(),
            content: content.clone(),
            tool_calls: None,
        }];
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
