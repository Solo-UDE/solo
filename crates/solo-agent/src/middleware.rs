//! Middleware system for AI agent
//!
//! Provides a composable middleware system for processing AI requests and responses.
//! Middleware can be used for logging, caching, rate limiting, guardrails, and more.

use async_trait::async_trait;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{debug, info, warn, error, instrument, span, Level};

use crate::provider::ProviderResult;
use solo_protocol::{AgentMessage, BackendEvent};

// =============================================================================
// Middleware Trait
// =============================================================================

/// Context passed through the middleware chain
#[derive(Debug, Clone)]
pub struct MiddlewareContext {
    /// Conversation ID
    pub conversation_id: String,
    /// Model being used
    pub model: String,
    /// Request messages
    pub messages: Vec<AgentMessage>,
    /// System prompt
    pub system_prompt: Option<String>,
    /// Request start time
    pub start_time: Instant,
    /// Custom metadata
    pub metadata: std::collections::HashMap<String, String>,
}

impl MiddlewareContext {
    pub fn new(
        conversation_id: String,
        model: String,
        messages: Vec<AgentMessage>,
        system_prompt: Option<String>,
    ) -> Self {
        Self {
            conversation_id,
            model,
            messages,
            system_prompt,
            start_time: Instant::now(),
            metadata: std::collections::HashMap::new(),
        }
    }

    /// Get elapsed time since request start
    pub fn elapsed(&self) -> Duration {
        self.start_time.elapsed()
    }

    /// Get message count
    pub fn message_count(&self) -> usize {
        self.messages.len()
    }

    /// Get total content length
    pub fn total_content_length(&self) -> usize {
        self.messages.iter().map(|m| m.content.len()).sum()
    }
}

/// Result of a middleware response
pub struct MiddlewareResponse {
    /// Backend events to stream
    pub events: Vec<BackendEvent>,
    /// Whether the middleware handled the request (skip further processing)
    pub handled: bool,
}

impl MiddlewareResponse {
    pub fn pass_through() -> Self {
        Self {
            events: Vec::new(),
            handled: false,
        }
    }

    pub fn handled(events: Vec<BackendEvent>) -> Self {
        Self {
            events,
            handled: true,
        }
    }
}

/// Trait for middleware that processes requests before sending to the provider
#[async_trait]
pub trait Middleware: Send + Sync {
    /// Process a request before it's sent to the provider
    /// Return `Ok(None)` to continue processing, or `Ok(Some(events))` to short-circuit
    async fn before_request(&self, ctx: &mut MiddlewareContext) -> ProviderResult<MiddlewareResponse> {
        let _ = ctx;
        Ok(MiddlewareResponse::pass_through())
    }

    /// Process response events after receiving from the provider
    async fn after_response(&self, ctx: &MiddlewareContext, events: &[BackendEvent]) -> ProviderResult<()> {
        let _ = (ctx, events);
        Ok(())
    }

    /// Called when an error occurs
    async fn on_error(&self, ctx: &MiddlewareContext, error: &str) -> ProviderResult<()> {
        let _ = (ctx, error);
        Ok(())
    }

    /// Get middleware name for logging
    fn name(&self) -> &'static str;
}

// =============================================================================
// Middleware Chain
// =============================================================================

/// A chain of middleware to process requests
pub struct MiddlewareChain {
    middlewares: Vec<Arc<dyn Middleware>>,
}

impl MiddlewareChain {
    pub fn new() -> Self {
        Self {
            middlewares: Vec::new(),
        }
    }

    /// Add a middleware to the chain
    pub fn add<M: Middleware + 'static>(&mut self, middleware: M) {
        self.middlewares.push(Arc::new(middleware));
    }

    /// Process a request through all middleware
    pub async fn before_request(&self, ctx: &mut MiddlewareContext) -> ProviderResult<Option<Vec<BackendEvent>>> {
        for middleware in &self.middlewares {
            let response = middleware.before_request(ctx).await?;
            if response.handled {
                return Ok(Some(response.events));
            }
        }
        Ok(None)
    }

    /// Process response events through all middleware
    pub async fn after_response(&self, ctx: &MiddlewareContext, events: &[BackendEvent]) -> ProviderResult<()> {
        for middleware in &self.middlewares {
            middleware.after_response(ctx, events).await?;
        }
        Ok(())
    }

    /// Notify all middleware of an error
    pub async fn on_error(&self, ctx: &MiddlewareContext, error: &str) -> ProviderResult<()> {
        for middleware in &self.middlewares {
            middleware.on_error(ctx, error).await?;
        }
        Ok(())
    }
}

impl Default for MiddlewareChain {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Logging Middleware
// =============================================================================

/// Middleware that logs all requests and responses
pub struct LoggingMiddleware {
    /// Log level for requests
    log_requests: bool,
    /// Log level for responses
    log_responses: bool,
    /// Log content (may contain sensitive data)
    log_content: bool,
}

impl LoggingMiddleware {
    pub fn new() -> Self {
        Self {
            log_requests: true,
            log_responses: true,
            log_content: false,
        }
    }

    pub fn with_content_logging(mut self) -> Self {
        self.log_content = true;
        self
    }
}

impl Default for LoggingMiddleware {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Middleware for LoggingMiddleware {
    async fn before_request(&self, ctx: &mut MiddlewareContext) -> ProviderResult<MiddlewareResponse> {
        if self.log_requests {
            let span = span!(
                Level::INFO,
                "ai_request",
                conversation_id = %ctx.conversation_id,
                model = %ctx.model,
                message_count = ctx.message_count(),
                content_length = ctx.total_content_length(),
            );
            let _enter = span.enter();

            info!(
                conversation_id = %ctx.conversation_id,
                model = %ctx.model,
                message_count = ctx.message_count(),
                "AI request started"
            );

            if self.log_content {
                for (i, msg) in ctx.messages.iter().enumerate() {
                    debug!(
                        role = %msg.role,
                        index = i,
                        content_len = msg.content.len(),
                        "Message content"
                    );
                }
            }
        }

        Ok(MiddlewareResponse::pass_through())
    }

    async fn after_response(&self, ctx: &MiddlewareContext, events: &[BackendEvent]) -> ProviderResult<()> {
        if self.log_responses {
            let elapsed = ctx.elapsed();
            let event_count = events.len();

            // Count token chunks
            let chunk_count = events
                .iter()
                .filter(|e| matches!(e, BackendEvent::AgentChunk { .. }))
                .count();

            info!(
                conversation_id = %ctx.conversation_id,
                model = %ctx.model,
                elapsed_ms = elapsed.as_millis(),
                event_count = event_count,
                chunk_count = chunk_count,
                "AI request completed"
            );
        }

        Ok(())
    }

    async fn on_error(&self, ctx: &MiddlewareContext, error: &str) -> ProviderResult<()> {
        let elapsed = ctx.elapsed();

        error!(
            conversation_id = %ctx.conversation_id,
            model = %ctx.model,
            elapsed_ms = elapsed.as_millis(),
            error = %error,
            "AI request failed"
        );

        Ok(())
    }

    fn name(&self) -> &'static str {
        "logging"
    }
}

// =============================================================================
// Rate Limiting Middleware
// =============================================================================

/// Simple token bucket rate limiter
pub struct RateLimitMiddleware {
    /// Maximum requests per minute
    max_rpm: u32,
    /// Request timestamps
    requests: Arc<RwLock<Vec<Instant>>>,
}

impl RateLimitMiddleware {
    pub fn new(max_rpm: u32) -> Self {
        Self {
            max_rpm,
            requests: Arc::new(RwLock::new(Vec::new())),
        }
    }

    async fn check_rate_limit(&self) -> bool {
        let mut requests = self.requests.write().await;
        let now = Instant::now();
        let one_minute_ago = now - Duration::from_secs(60);

        // Remove old requests
        requests.retain(|&t| t > one_minute_ago);

        if requests.len() >= self.max_rpm as usize {
            warn!(
                current = requests.len(),
                max = self.max_rpm,
                "Rate limit exceeded"
            );
            return false;
        }

        requests.push(now);
        true
    }
}

#[async_trait]
impl Middleware for RateLimitMiddleware {
    async fn before_request(&self, ctx: &mut MiddlewareContext) -> ProviderResult<MiddlewareResponse> {
        if !self.check_rate_limit().await {
            let error_event = BackendEvent::AgentError {
                conversation_id: ctx.conversation_id.clone(),
                error: format!("Rate limit exceeded: {} requests per minute", self.max_rpm),
            };
            return Ok(MiddlewareResponse::handled(vec![error_event]));
        }

        Ok(MiddlewareResponse::pass_through())
    }

    fn name(&self) -> &'static str {
        "rate_limit"
    }
}

// =============================================================================
// Guardrails Middleware
// =============================================================================

/// Middleware for content safety and guardrails
pub struct GuardrailsMiddleware {
    /// Maximum message length
    max_message_length: usize,
    /// Maximum total content length
    max_total_length: usize,
    /// Blocked patterns (simple substring matching)
    blocked_patterns: Vec<String>,
}

impl GuardrailsMiddleware {
    pub fn new() -> Self {
        Self {
            max_message_length: 100_000,
            max_total_length: 500_000,
            blocked_patterns: Vec::new(),
        }
    }

    pub fn with_max_message_length(mut self, length: usize) -> Self {
        self.max_message_length = length;
        self
    }

    pub fn with_max_total_length(mut self, length: usize) -> Self {
        self.max_total_length = length;
        self
    }

    pub fn with_blocked_patterns(mut self, patterns: Vec<String>) -> Self {
        self.blocked_patterns = patterns;
        self
    }
}

impl Default for GuardrailsMiddleware {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Middleware for GuardrailsMiddleware {
    async fn before_request(&self, ctx: &mut MiddlewareContext) -> ProviderResult<MiddlewareResponse> {
        // Check message length
        for (i, msg) in ctx.messages.iter().enumerate() {
            if msg.content.len() > self.max_message_length {
                let error_event = BackendEvent::AgentError {
                    conversation_id: ctx.conversation_id.clone(),
                    error: format!(
                        "Message {} exceeds maximum length ({} > {})",
                        i,
                        msg.content.len(),
                        self.max_message_length
                    ),
                };
                return Ok(MiddlewareResponse::handled(vec![error_event]));
            }
        }

        // Check total length
        let total_length = ctx.total_content_length();
        if total_length > self.max_total_length {
            let error_event = BackendEvent::AgentError {
                conversation_id: ctx.conversation_id.clone(),
                error: format!(
                    "Total content length exceeds maximum ({} > {})",
                    total_length, self.max_total_length
                ),
            };
            return Ok(MiddlewareResponse::handled(vec![error_event]));
        }

        // Check blocked patterns
        for msg in &ctx.messages {
            let content_lower = msg.content.to_lowercase();
            for pattern in &self.blocked_patterns {
                if content_lower.contains(&pattern.to_lowercase()) {
                    warn!(
                        conversation_id = %ctx.conversation_id,
                        pattern = %pattern,
                        "Blocked pattern detected"
                    );
                    let error_event = BackendEvent::AgentError {
                        conversation_id: ctx.conversation_id.clone(),
                        error: "Request contains blocked content".to_string(),
                    };
                    return Ok(MiddlewareResponse::handled(vec![error_event]));
                }
            }
        }

        Ok(MiddlewareResponse::pass_through())
    }

    fn name(&self) -> &'static str {
        "guardrails"
    }
}

// =============================================================================
// Metrics Middleware
// =============================================================================

/// Middleware that collects metrics about AI usage
pub struct MetricsMiddleware {
    /// Total requests
    total_requests: Arc<RwLock<u64>>,
    /// Successful requests
    successful_requests: Arc<RwLock<u64>>,
    /// Failed requests
    failed_requests: Arc<RwLock<u64>>,
    /// Total latency (ms)
    total_latency_ms: Arc<RwLock<u64>>,
}

impl MetricsMiddleware {
    pub fn new() -> Self {
        Self {
            total_requests: Arc::new(RwLock::new(0)),
            successful_requests: Arc::new(RwLock::new(0)),
            failed_requests: Arc::new(RwLock::new(0)),
            total_latency_ms: Arc::new(RwLock::new(0)),
        }
    }

    /// Get current metrics
    pub async fn get_metrics(&self) -> MiddlewareMetrics {
        MiddlewareMetrics {
            total_requests: *self.total_requests.read().await,
            successful_requests: *self.successful_requests.read().await,
            failed_requests: *self.failed_requests.read().await,
            total_latency_ms: *self.total_latency_ms.read().await,
        }
    }
}

impl Default for MetricsMiddleware {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MiddlewareMetrics {
    pub total_requests: u64,
    pub successful_requests: u64,
    pub failed_requests: u64,
    pub total_latency_ms: u64,
}

impl MiddlewareMetrics {
    pub fn average_latency_ms(&self) -> f64 {
        if self.successful_requests == 0 {
            0.0
        } else {
            self.total_latency_ms as f64 / self.successful_requests as f64
        }
    }

    pub fn success_rate(&self) -> f64 {
        if self.total_requests == 0 {
            1.0
        } else {
            self.successful_requests as f64 / self.total_requests as f64
        }
    }
}

#[async_trait]
impl Middleware for MetricsMiddleware {
    async fn before_request(&self, _ctx: &mut MiddlewareContext) -> ProviderResult<MiddlewareResponse> {
        *self.total_requests.write().await += 1;
        Ok(MiddlewareResponse::pass_through())
    }

    async fn after_response(&self, ctx: &MiddlewareContext, _events: &[BackendEvent]) -> ProviderResult<()> {
        *self.successful_requests.write().await += 1;
        *self.total_latency_ms.write().await += ctx.elapsed().as_millis() as u64;
        Ok(())
    }

    async fn on_error(&self, _ctx: &MiddlewareContext, _error: &str) -> ProviderResult<()> {
        *self.failed_requests.write().await += 1;
        Ok(())
    }

    fn name(&self) -> &'static str {
        "metrics"
    }
}

// =============================================================================
// Default Middleware Chain
// =============================================================================

/// Create a default middleware chain with common middleware
pub fn create_default_middleware_chain() -> MiddlewareChain {
    let mut chain = MiddlewareChain::new();
    chain.add(LoggingMiddleware::new());
    chain.add(GuardrailsMiddleware::new());
    chain
}

/// Create a production middleware chain with all features
pub fn create_production_middleware_chain(max_rpm: u32) -> MiddlewareChain {
    let mut chain = MiddlewareChain::new();
    chain.add(LoggingMiddleware::new());
    chain.add(MetricsMiddleware::new());
    chain.add(RateLimitMiddleware::new(max_rpm));
    chain.add(GuardrailsMiddleware::new());
    chain
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_middleware_context() {
        let ctx = MiddlewareContext::new(
            "test-conv".to_string(),
            "gpt-4".to_string(),
            vec![AgentMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
                tool_calls: None,
            }],
            None,
        );

        assert_eq!(ctx.message_count(), 1);
        assert_eq!(ctx.total_content_length(), 5);
    }

    #[test]
    fn test_metrics() {
        let metrics = MiddlewareMetrics {
            total_requests: 100,
            successful_requests: 95,
            failed_requests: 5,
            total_latency_ms: 9500,
        };

        assert_eq!(metrics.average_latency_ms(), 100.0);
        assert_eq!(metrics.success_rate(), 0.95);
    }
}
