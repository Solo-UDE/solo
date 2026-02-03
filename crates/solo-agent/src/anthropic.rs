//! Anthropic (Claude) provider implementation

use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use solo_protocol::{AgentMessage, AgentToolCall, BackendEvent};
use tokio::sync::mpsc;
use tracing::{debug, info, error};

use std::time::Duration;

use crate::models::{ANTHROPIC_MODELS, find_model};
use crate::provider::{AIProvider, ProviderError, ProviderResult, ProviderType, ToolDefinition};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Maximum number of retry attempts for transient errors
const MAX_RETRIES: u32 = 4;
/// Initial backoff delay in milliseconds
const INITIAL_BACKOFF_MS: u64 = 1000;
/// Maximum backoff delay in milliseconds
const MAX_BACKOFF_MS: u64 = 30_000;

/// Anthropic provider implementation
pub struct AnthropicProvider {
    api_key: String,
    client: Client,
    tools: Vec<ToolDefinition>,
}

impl AnthropicProvider {
    /// Create a new Anthropic provider
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: Client::new(),
            tools: Vec::new(),
        }
    }

    /// Convert AgentMessage to Anthropic format
    fn convert_messages(messages: &[AgentMessage]) -> Vec<AnthropicMessage> {
        messages
            .iter()
            .map(|m| AnthropicMessage {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect()
    }

    /// Convert tool definitions to Anthropic format
    fn convert_tools(&self) -> Vec<serde_json::Value> {
        self.tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema
                })
            })
            .collect()
    }
}

#[derive(Debug, Clone, Serialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<serde_json::Value>,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    index: Option<usize>,
    #[serde(default)]
    delta: Option<AnthropicDelta>,
    #[serde(default)]
    content_block: Option<AnthropicContentBlock>,
    #[serde(default)]
    message: Option<AnthropicResponseMessage>,
    #[serde(default)]
    error: Option<AnthropicError>,
}

#[derive(Debug, Deserialize)]
struct AnthropicDelta {
    #[serde(rename = "type")]
    delta_type: Option<String>,
    text: Option<String>,
    partial_json: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    input: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponseMessage {
    id: String,
    role: String,
    content: Vec<AnthropicContentBlock>,
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicError {
    #[serde(rename = "type")]
    error_type: String,
    message: String,
}

#[async_trait]
impl AIProvider for AnthropicProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Anthropic
    }

    async fn send_message(
        &self,
        conversation_id: &str,
        model: &str,
        messages: &[AgentMessage],
        system_prompt: Option<&str>,
    ) -> ProviderResult<mpsc::Receiver<BackendEvent>> {
        let (tx, rx) = mpsc::channel(100);
        let conversation_id = conversation_id.to_string();

        let max_tokens = find_model(model)
            .map(|m| m.capabilities.max_output_tokens)
            .unwrap_or(4096);

        let request = AnthropicRequest {
            model: model.to_string(),
            max_tokens,
            messages: Self::convert_messages(messages),
            system: system_prompt.map(|s| s.to_string()),
            tools: self.convert_tools(),
            stream: true,
        };

        let api_key = self.api_key.clone();
        let client = self.client.clone();

        tokio::spawn(async move {
            let result = stream_anthropic_response(client, api_key, request, conversation_id.clone(), tx.clone()).await;

            if let Err(e) = result {
                let _ = tx
                    .send(BackendEvent::AgentError {
                        conversation_id,
                        error: e.to_string(),
                    })
                    .await;
            }
        });

        Ok(rx)
    }

    fn available_models(&self) -> Vec<String> {
        ANTHROPIC_MODELS.iter().map(|m| m.id.clone()).collect()
    }

    async fn validate_credentials(&self) -> ProviderResult<bool> {
        // Send a minimal request to validate the API key
        let response = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&serde_json::json!({
                "model": ANTHROPIC_MODELS.iter()
                    .find(|m| m.alias == "haiku")
                    .map(|m| m.id.as_str())
                    .unwrap_or("claude-haiku-4-5-20251001"),
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "test"}]
            }))
            .send()
            .await?;

        match response.status().as_u16() {
            200 | 201 => Ok(true),
            401 => Err(ProviderError::AuthError("Invalid API key".to_string())),
            429 => Err(ProviderError::RateLimited(60)),
            _ => {
                let error_text = response.text().await.unwrap_or_default();
                Err(ProviderError::ApiError(error_text))
            }
        }
    }

    fn set_tools(&mut self, tools: Vec<ToolDefinition>) {
        self.tools = tools;
    }

    fn get_tools(&self) -> &[ToolDefinition] {
        &self.tools
    }
}

/// Compute backoff duration with jitter for a given attempt (0-indexed).
fn compute_backoff(attempt: u32) -> Duration {
    let base = INITIAL_BACKOFF_MS.saturating_mul(1u64 << attempt.min(10));
    let capped = base.min(MAX_BACKOFF_MS);

    // Add +/- 25% jitter using getrandom
    let mut buf = [0u8; 2];
    let _ = getrandom::getrandom(&mut buf);
    let jitter_factor = (u16::from_le_bytes(buf) as f64) / (u16::MAX as f64);
    let jitter_range = capped as f64 * 0.5;
    let jitter = (jitter_factor * jitter_range) - (jitter_range / 2.0);
    let final_ms = ((capped as f64) + jitter).max(100.0) as u64;

    Duration::from_millis(final_ms)
}

/// Check if an HTTP status code is retryable
fn is_retryable_status(status: u16) -> bool {
    matches!(status, 429 | 529 | 500 | 502 | 503)
}

/// Extract retry-after header value as a Duration, if present
fn parse_retry_after(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_secs)
}

async fn stream_anthropic_response(
    client: Client,
    api_key: String,
    request: AnthropicRequest,
    conversation_id: String,
    tx: mpsc::Sender<BackendEvent>,
) -> ProviderResult<()> {
    info!(conversation_id = %conversation_id, model = %request.model, "Starting Anthropic streaming request");

    let mut last_error: Option<ProviderError> = None;

    for attempt in 0..=MAX_RETRIES {
        let response = match client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                tracing::warn!(
                    conversation_id = %conversation_id,
                    attempt = attempt,
                    error = %e,
                    "Network error on Anthropic request"
                );
                last_error = Some(ProviderError::from(e));
                if attempt < MAX_RETRIES {
                    let backoff = compute_backoff(attempt);
                    tracing::warn!(conversation_id = %conversation_id, backoff_ms = backoff.as_millis() as u64, "Retrying after network error");
                    tokio::time::sleep(backoff).await;
                }
                continue;
            }
        };

        info!(conversation_id = %conversation_id, status = %response.status(), attempt = attempt, "Got Anthropic response");

        let status = response.status();
        if !status.is_success() {
            let status_code = status.as_u16();

            if is_retryable_status(status_code) && attempt < MAX_RETRIES {
                let retry_after = parse_retry_after(&response);
                let error_text = response.text().await.unwrap_or_default();

                tracing::warn!(
                    conversation_id = %conversation_id,
                    status = status_code,
                    attempt = attempt,
                    error = %error_text,
                    "Retryable Anthropic API error"
                );

                let backoff = if let Some(retry_dur) = retry_after {
                    retry_dur.min(Duration::from_secs(60))
                } else {
                    compute_backoff(attempt)
                };
                tokio::time::sleep(backoff).await;

                last_error = Some(ProviderError::ApiError(format!("HTTP {}: {}", status_code, error_text)));
                continue;
            }

            // Non-retryable error or retries exhausted
            let error_text = response.text().await.unwrap_or_default();
            error!(conversation_id = %conversation_id, status = %status, error = %error_text, "Anthropic API error");
            return Err(ProviderError::ApiError(format!("HTTP {}: {}", status, error_text)));
        }

        // Success — stream SSE events
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut accumulated_text = String::new();
        let mut current_tool_call: Option<(String, String, String)> = None; // (id, name, input_json)
        let mut chunk_count = 0u32;
        let mut should_retry = false;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            chunk_count += 1;
            let chunk_str = String::from_utf8_lossy(&chunk);
            debug!(conversation_id = %conversation_id, chunk_count = chunk_count, chunk_len = chunk_str.len(), "Received SSE chunk");
            buffer.push_str(&chunk_str);

            // Process SSE events
            while let Some(event_end) = buffer.find("\n\n") {
                let event_data = buffer[..event_end].to_string();
                buffer = buffer[event_end + 2..].to_string();

                // Parse SSE event
                for line in event_data.lines() {
                    if let Some(data) = line.strip_prefix("data: ") {
                        if data == "[DONE]" {
                            continue;
                        }

                        if let Ok(event) = serde_json::from_str::<AnthropicStreamEvent>(data) {
                            match event.event_type.as_str() {
                                "content_block_start" => {
                                    if let Some(block) = event.content_block {
                                        if block.block_type == "tool_use" {
                                            if let (Some(id), Some(name)) = (block.id, block.name) {
                                                current_tool_call = Some((id, name, String::new()));
                                            }
                                        }
                                    }
                                }
                                "content_block_delta" => {
                                    if let Some(delta) = event.delta {
                                        // Text delta
                                        if let Some(text) = delta.text {
                                            accumulated_text.push_str(&text);
                                            debug!(conversation_id = %conversation_id, text_len = text.len(), "Sending AgentChunk");
                                            let _ = tx
                                                .send(BackendEvent::AgentChunk {
                                                    conversation_id: conversation_id.clone(),
                                                    content: text,
                                                })
                                                .await;
                                        }
                                        // Tool input delta
                                        if let Some(partial) = delta.partial_json {
                                            if let Some((_, _, ref mut input)) = current_tool_call {
                                                input.push_str(&partial);
                                            }
                                        }
                                    }
                                }
                                "content_block_stop" => {
                                    // If we have a tool call, emit it
                                    if let Some((id, name, input_json)) = current_tool_call.take() {
                                        let tool_call = AgentToolCall {
                                            id: id.clone(),
                                            name: name.clone(),
                                            arguments: input_json,
                                        };
                                        let _ = tx
                                            .send(BackendEvent::AgentToolStart {
                                                conversation_id: conversation_id.clone(),
                                                tool_call,
                                            })
                                            .await;
                                    }
                                }
                                "message_stop" => {
                                    // Message complete
                                    info!(conversation_id = %conversation_id, content_len = accumulated_text.len(), "Sending AgentComplete");
                                    let _ = tx
                                        .send(BackendEvent::AgentComplete {
                                            conversation_id: conversation_id.clone(),
                                            message: AgentMessage {
                                                role: "assistant".to_string(),
                                                content: accumulated_text.clone(),
                                                tool_calls: None, // Tool calls are sent separately
                                            },
                                        })
                                        .await;
                                }
                                "error" => {
                                    if let Some(ref error) = event.error {
                                        let is_retryable_sse = matches!(
                                            error.error_type.as_str(),
                                            "overloaded_error" | "rate_limit_error" | "api_error"
                                        );
                                        let no_content_sent = accumulated_text.is_empty() && current_tool_call.is_none();

                                        if is_retryable_sse && no_content_sent && attempt < MAX_RETRIES {
                                            tracing::warn!(
                                                conversation_id = %conversation_id,
                                                error_type = %error.error_type,
                                                attempt = attempt,
                                                "Retryable SSE error before any content was streamed"
                                            );
                                            last_error = Some(ProviderError::ApiError(
                                                format!("{}: {}", error.error_type, error.message),
                                            ));
                                            should_retry = true;
                                        } else {
                                            error!(conversation_id = %conversation_id, error_type = %error.error_type, message = %error.message, "Anthropic API returned error during stream");
                                            let _ = tx
                                                .send(BackendEvent::AgentError {
                                                    conversation_id: conversation_id.clone(),
                                                    error: format!("{}: {}", error.error_type, error.message),
                                                })
                                                .await;
                                        }
                                    }
                                }
                                _ => {
                                    debug!(conversation_id = %conversation_id, event_type = %event.event_type, "Unhandled event type");
                                }
                            }
                        }
                    }
                }
            }

            if should_retry {
                break;
            }
        }

        if should_retry {
            let backoff = compute_backoff(attempt);
            tracing::warn!(conversation_id = %conversation_id, backoff_ms = backoff.as_millis() as u64, "Retrying after SSE overloaded error");
            tokio::time::sleep(backoff).await;
            continue;
        }

        info!(conversation_id = %conversation_id, total_chunks = chunk_count, accumulated_len = accumulated_text.len(), "Streaming complete");
        return Ok(());
    }

    // All retries exhausted
    error!(conversation_id = %conversation_id, max_retries = MAX_RETRIES, "All retry attempts exhausted");
    Err(last_error.unwrap_or_else(|| ProviderError::ApiError("All retry attempts exhausted".to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_messages() {
        let messages = vec![AgentMessage {
            role: "user".to_string(),
            content: "Hello".to_string(),
            tool_calls: None,
        }];

        let converted = AnthropicProvider::convert_messages(&messages);
        assert_eq!(converted.len(), 1);
        assert_eq!(converted[0].role, "user");
        assert_eq!(converted[0].content, "Hello");
    }
}
