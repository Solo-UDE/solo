//! OpenTelemetry Telemetry Integration
//!
//! Provides OpenTelemetry integration for distributed tracing and metrics.
//! This module is only available when the `telemetry` feature is enabled.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

// =============================================================================
// Telemetry Types
// =============================================================================

/// Telemetry event representing an AI operation
#[derive(Debug, Clone)]
pub struct TelemetryEvent {
    /// Event name
    pub name: String,
    /// Event timestamp (Unix milliseconds)
    pub timestamp: u64,
    /// Duration in milliseconds
    pub duration_ms: Option<u64>,
    /// Event attributes
    pub attributes: HashMap<String, TelemetryValue>,
}

/// Value types for telemetry attributes
#[derive(Debug, Clone)]
pub enum TelemetryValue {
    String(String),
    Int(i64),
    Float(f64),
    Bool(bool),
}

impl TelemetryValue {
    pub fn as_string(&self) -> String {
        match self {
            TelemetryValue::String(s) => s.clone(),
            TelemetryValue::Int(i) => i.to_string(),
            TelemetryValue::Float(f) => f.to_string(),
            TelemetryValue::Bool(b) => b.to_string(),
        }
    }
}

impl From<&str> for TelemetryValue {
    fn from(s: &str) -> Self {
        TelemetryValue::String(s.to_string())
    }
}

impl From<String> for TelemetryValue {
    fn from(s: String) -> Self {
        TelemetryValue::String(s)
    }
}

impl From<i64> for TelemetryValue {
    fn from(i: i64) -> Self {
        TelemetryValue::Int(i)
    }
}

impl From<f64> for TelemetryValue {
    fn from(f: f64) -> Self {
        TelemetryValue::Float(f)
    }
}

impl From<bool> for TelemetryValue {
    fn from(b: bool) -> Self {
        TelemetryValue::Bool(b)
    }
}

// =============================================================================
// Telemetry Collector
// =============================================================================

/// Telemetry collector that stores events in memory
pub struct TelemetryCollector {
    /// Collected events
    events: Arc<RwLock<Vec<TelemetryEvent>>>,
    /// Maximum events to store
    max_events: usize,
    /// Whether telemetry is enabled
    enabled: bool,
}

impl TelemetryCollector {
    /// Create a new telemetry collector
    pub fn new(max_events: usize) -> Self {
        Self {
            events: Arc::new(RwLock::new(Vec::new())),
            max_events,
            enabled: true,
        }
    }

    /// Create a disabled collector (no-op)
    pub fn disabled() -> Self {
        Self {
            events: Arc::new(RwLock::new(Vec::new())),
            max_events: 0,
            enabled: false,
        }
    }

    /// Record an event
    pub async fn record(&self, event: TelemetryEvent) {
        if !self.enabled {
            return;
        }

        let mut events = self.events.write().await;
        events.push(event);

        // Trim old events if needed
        if events.len() > self.max_events {
            let excess = events.len() - self.max_events;
            events.drain(0..excess);
        }
    }

    /// Get all collected events
    pub async fn get_events(&self) -> Vec<TelemetryEvent> {
        self.events.read().await.clone()
    }

    /// Clear all events
    pub async fn clear(&self) {
        self.events.write().await.clear();
    }

    /// Get event count
    pub async fn event_count(&self) -> usize {
        self.events.read().await.len()
    }
}

impl Default for TelemetryCollector {
    fn default() -> Self {
        Self::new(1000)
    }
}

// =============================================================================
// Span Helpers
// =============================================================================

/// A span tracker for timing operations
pub struct SpanTracker {
    name: String,
    start: Instant,
    attributes: HashMap<String, TelemetryValue>,
    collector: Option<Arc<TelemetryCollector>>,
}

impl SpanTracker {
    /// Create a new span tracker
    pub fn new(name: impl Into<String>, collector: Option<Arc<TelemetryCollector>>) -> Self {
        Self {
            name: name.into(),
            start: Instant::now(),
            attributes: HashMap::new(),
            collector,
        }
    }

    /// Add an attribute
    pub fn set_attribute(&mut self, key: impl Into<String>, value: impl Into<TelemetryValue>) {
        self.attributes.insert(key.into(), value.into());
    }

    /// End the span and record it
    pub async fn end(self) {
        let duration = self.start.elapsed();

        if let Some(collector) = self.collector {
            let event = TelemetryEvent {
                name: self.name,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
                duration_ms: Some(duration.as_millis() as u64),
                attributes: self.attributes,
            };

            collector.record(event).await;
        }
    }
}

// =============================================================================
// AI-Specific Telemetry
// =============================================================================

/// AI operation telemetry
pub struct AITelemetry {
    collector: Arc<TelemetryCollector>,
}

impl AITelemetry {
    /// Create new AI telemetry
    pub fn new(collector: Arc<TelemetryCollector>) -> Self {
        Self { collector }
    }

    /// Start tracking an AI request
    pub fn start_request(&self, conversation_id: &str, model: &str) -> SpanTracker {
        let mut tracker = SpanTracker::new("ai.request", Some(self.collector.clone()));
        tracker.set_attribute("conversation_id", conversation_id.to_string());
        tracker.set_attribute("model", model.to_string());
        tracker
    }

    /// Record a completion event
    pub async fn record_completion(
        &self,
        conversation_id: &str,
        model: &str,
        duration_ms: u64,
        tokens_used: Option<u64>,
        success: bool,
    ) {
        let mut attrs = HashMap::new();
        attrs.insert("conversation_id".to_string(), TelemetryValue::String(conversation_id.to_string()));
        attrs.insert("model".to_string(), TelemetryValue::String(model.to_string()));
        attrs.insert("success".to_string(), TelemetryValue::Bool(success));

        if let Some(tokens) = tokens_used {
            attrs.insert("tokens_used".to_string(), TelemetryValue::Int(tokens as i64));
        }

        let event = TelemetryEvent {
            name: "ai.completion".to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            duration_ms: Some(duration_ms),
            attributes: attrs,
        };

        self.collector.record(event).await;
    }

    /// Record a tool call event
    pub async fn record_tool_call(
        &self,
        conversation_id: &str,
        tool_name: &str,
        duration_ms: u64,
        success: bool,
    ) {
        let mut attrs = HashMap::new();
        attrs.insert("conversation_id".to_string(), TelemetryValue::String(conversation_id.to_string()));
        attrs.insert("tool_name".to_string(), TelemetryValue::String(tool_name.to_string()));
        attrs.insert("success".to_string(), TelemetryValue::Bool(success));

        let event = TelemetryEvent {
            name: "ai.tool_call".to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            duration_ms: Some(duration_ms),
            attributes: attrs,
        };

        self.collector.record(event).await;
    }

    /// Record an embedding event
    pub async fn record_embedding(
        &self,
        text_count: usize,
        dimensions: usize,
        duration_ms: u64,
    ) {
        let mut attrs = HashMap::new();
        attrs.insert("text_count".to_string(), TelemetryValue::Int(text_count as i64));
        attrs.insert("dimensions".to_string(), TelemetryValue::Int(dimensions as i64));

        let event = TelemetryEvent {
            name: "ai.embedding".to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            duration_ms: Some(duration_ms),
            attributes: attrs,
        };

        self.collector.record(event).await;
    }

    /// Get telemetry summary
    pub async fn get_summary(&self) -> TelemetrySummary {
        let events = self.collector.get_events().await;

        let mut summary = TelemetrySummary::default();

        for event in events {
            match event.name.as_str() {
                "ai.request" | "ai.completion" => {
                    summary.total_requests += 1;
                    if let Some(duration) = event.duration_ms {
                        summary.total_duration_ms += duration;
                    }
                    if let Some(TelemetryValue::Bool(true)) = event.attributes.get("success") {
                        summary.successful_requests += 1;
                    }
                    if let Some(TelemetryValue::Int(tokens)) = event.attributes.get("tokens_used") {
                        summary.total_tokens += *tokens as u64;
                    }
                }
                "ai.tool_call" => {
                    summary.total_tool_calls += 1;
                }
                "ai.embedding" => {
                    summary.total_embeddings += 1;
                }
                _ => {}
            }
        }

        summary
    }
}

/// Telemetry summary statistics
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct TelemetrySummary {
    pub total_requests: u64,
    pub successful_requests: u64,
    pub total_duration_ms: u64,
    pub total_tokens: u64,
    pub total_tool_calls: u64,
    pub total_embeddings: u64,
}

impl TelemetrySummary {
    pub fn average_duration_ms(&self) -> f64 {
        if self.total_requests == 0 {
            0.0
        } else {
            self.total_duration_ms as f64 / self.total_requests as f64
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

// =============================================================================
// OpenTelemetry Integration (feature-gated)
// =============================================================================

#[cfg(feature = "telemetry")]
pub mod otel {
    use super::*;
    use opentelemetry::trace::{Tracer, TracerProvider};
    use opentelemetry_sdk::trace::SdkTracerProvider;
    use tracing_opentelemetry::OpenTelemetryLayer;
    use tracing_subscriber::{layer::SubscriberExt, Registry};

    /// Initialize OpenTelemetry with stdout exporter
    pub fn init_stdout_telemetry() -> Result<(), Box<dyn std::error::Error>> {
        let exporter = opentelemetry_stdout::SpanExporter::default();

        let provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter)
            .build();

        let tracer = provider.tracer("solo-agent");
        let telemetry_layer = OpenTelemetryLayer::new(tracer);

        let subscriber = Registry::default()
            .with(telemetry_layer)
            .with(tracing_subscriber::fmt::layer());

        tracing::subscriber::set_global_default(subscriber)?;

        info!("OpenTelemetry initialized with stdout exporter");
        Ok(())
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_telemetry_collector() {
        let collector = TelemetryCollector::new(10);

        let event = TelemetryEvent {
            name: "test".to_string(),
            timestamp: 12345,
            duration_ms: Some(100),
            attributes: HashMap::new(),
        };

        collector.record(event).await;
        assert_eq!(collector.event_count().await, 1);
    }

    #[tokio::test]
    async fn test_span_tracker() {
        let collector = Arc::new(TelemetryCollector::new(10));

        let mut tracker = SpanTracker::new("test.span", Some(collector.clone()));
        tracker.set_attribute("key", "value");
        tracker.end().await;

        assert_eq!(collector.event_count().await, 1);
    }

    #[tokio::test]
    async fn test_ai_telemetry() {
        let collector = Arc::new(TelemetryCollector::new(100));
        let telemetry = AITelemetry::new(collector);

        telemetry.record_completion("conv-1", "gpt-4", 1000, Some(100), true).await;
        telemetry.record_tool_call("conv-1", "read_file", 50, true).await;

        let summary = telemetry.get_summary().await;
        assert_eq!(summary.total_requests, 1);
        assert_eq!(summary.total_tool_calls, 1);
    }
}
