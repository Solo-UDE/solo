//! Anthropic (Claude) provider implementation

use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use solo_protocol::{AgentMessage, AgentToolCall, BackendEvent};
use tokio::sync::mpsc;
use tracing::{debug, info, error};

use crate::models::ANTHROPIC_MODELS;
use crate::provider::{AIProvider, ProviderError, ProviderResult, ProviderType, ToolDefinition};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

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

#[derive(Debug, Serialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
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

        let request = AnthropicRequest {
            model: model.to_string(),
            max_tokens: 8192,
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
                "model": "claude-3-5-haiku-latest",
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

async fn stream_anthropic_response(
    client: Client,
    api_key: String,
    request: AnthropicRequest,
    conversation_id: String,
    tx: mpsc::Sender<BackendEvent>,
) -> ProviderResult<()> {
    info!(conversation_id = %conversation_id, model = %request.model, "Starting Anthropic streaming request");

    let response = client
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", &api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&request)
        .send()
        .await?;

    info!(conversation_id = %conversation_id, status = %response.status(), "Got Anthropic response");

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        error!(conversation_id = %conversation_id, status = %status, error = %error_text, "Anthropic API error");
        return Err(ProviderError::ApiError(format!(
            "HTTP {}: {}",
            status, error_text
        )));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut accumulated_text = String::new();
    let mut current_tool_call: Option<(String, String, String)> = None; // (id, name, input_json)
    let mut chunk_count = 0u32;

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
                                if let Some(error) = event.error {
                                    error!(conversation_id = %conversation_id, error_type = %error.error_type, message = %error.message, "Anthropic API returned error");
                                    let _ = tx
                                        .send(BackendEvent::AgentError {
                                            conversation_id: conversation_id.clone(),
                                            error: format!("{}: {}", error.error_type, error.message),
                                        })
                                        .await;
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
    }

    info!(conversation_id = %conversation_id, total_chunks = chunk_count, accumulated_len = accumulated_text.len(), "Streaming complete");
    Ok(())
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
