//! OpenAI provider implementation using the Responses API

use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use solo_protocol::{AgentMessage, AgentToolCall, BackendEvent, ContentBlock};
use tokio::sync::mpsc;

use crate::models::OPENAI_MODELS;
use crate::provider::{AIProvider, ProviderError, ProviderResult, ProviderType, ToolDefinition};

const OPENAI_API_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_CHAT_URL: &str = "https://api.openai.com/v1/chat/completions";

/// OpenAI provider implementation
pub struct OpenAIProvider {
    api_key: String,
    client: Client,
    tools: Vec<ToolDefinition>,
    /// Previous response ID for multi-turn conversations
    previous_response_id: Option<String>,
    /// ChatGPT account ID (set when using OAuth, None for API key auth)
    account_id: Option<String>,
}

impl OpenAIProvider {
    /// Create a new OpenAI provider with an API key (no OAuth metadata)
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: Client::new(),
            tools: Vec::new(),
            previous_response_id: None,
            account_id: None,
        }
    }

    /// Create a new OpenAI provider with OAuth metadata
    pub fn new_with_oauth(api_key: String, account_id: Option<String>) -> Self {
        Self {
            api_key,
            client: Client::new(),
            tools: Vec::new(),
            previous_response_id: None,
            account_id,
        }
    }

    /// Convert messages to OpenAI chat format
    /// OpenAI expects:
    /// - Text: { role: "user"|"assistant", content: "text" }
    /// - Assistant with tools: { role: "assistant", content: "text", tool_calls: [...] }
    /// - Tool results: { role: "tool", tool_call_id: "...", content: "..." }
    fn convert_to_chat_messages(
        messages: &[AgentMessage],
        system_prompt: Option<&str>,
    ) -> Vec<OpenAIChatMessage> {
        let mut result = Vec::new();

        // Add system message if provided
        if let Some(system) = system_prompt {
            result.push(OpenAIChatMessage {
                role: "system".to_string(),
                content: Some(system.to_string()),
                tool_calls: None,
                tool_call_id: None,
            });
        }

        for msg in messages {
            // Check if this message has tool result blocks
            let tool_results: Vec<&ContentBlock> = msg
                .content
                .iter()
                .filter(|b| matches!(b, ContentBlock::ToolResult { .. }))
                .collect();

            if !tool_results.is_empty() {
                // Each tool result becomes a separate "tool" role message for OpenAI
                for block in tool_results {
                    if let ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                        ..
                    } = block
                    {
                        result.push(OpenAIChatMessage {
                            role: "tool".to_string(),
                            content: Some(content.clone()),
                            tool_calls: None,
                            tool_call_id: Some(tool_use_id.clone()),
                        });
                    }
                }
                continue;
            }

            // Check if this message has tool use blocks (assistant with tool calls)
            let tool_uses: Vec<OpenAIToolCall> = msg
                .content
                .iter()
                .filter_map(|b| match b {
                    ContentBlock::ToolUse {
                        id,
                        name,
                        arguments,
                    } => Some(OpenAIToolCall {
                        id: id.clone(),
                        r#type: "function".to_string(),
                        function: OpenAIFunctionCall {
                            name: name.clone(),
                            arguments: arguments.clone(),
                        },
                    }),
                    _ => None,
                })
                .collect();

            let text = msg.display_text();
            result.push(OpenAIChatMessage {
                role: msg.role.clone(),
                content: if text.is_empty() { None } else { Some(text) },
                tool_calls: if tool_uses.is_empty() {
                    None
                } else {
                    Some(tool_uses)
                },
                tool_call_id: None,
            });
        }

        result
    }

    /// Convert tool definitions to OpenAI format
    fn convert_tools(&self) -> Vec<serde_json::Value> {
        self.tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.input_schema
                    }
                })
            })
            .collect()
    }
}

#[derive(Debug, Serialize)]
struct OpenAIChatMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OpenAIToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIToolCall {
    id: String,
    r#type: String,
    function: OpenAIFunctionCall,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Debug, Serialize)]
struct OpenAIChatRequest {
    model: String,
    messages: Vec<OpenAIChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<serde_json::Value>,
    stream: bool,
    /// When using OAuth auth, set to false to prevent conversation storage
    #[serde(skip_serializing_if = "Option::is_none")]
    store: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct OpenAIStreamChunk {
    id: String,
    choices: Vec<OpenAIStreamChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAIStreamChoice {
    index: usize,
    delta: OpenAIDelta,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAIDelta {
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<OpenAIToolCallDelta>>,
}

#[derive(Debug, Deserialize)]
struct OpenAIToolCallDelta {
    index: usize,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    function: Option<OpenAIFunctionDelta>,
}

#[derive(Debug, Deserialize)]
struct OpenAIFunctionDelta {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

#[async_trait]
impl AIProvider for OpenAIProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::OpenAI
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

        let chat_messages = Self::convert_to_chat_messages(messages, system_prompt);
        let tools = self.convert_tools();

        // When using OAuth (account_id present), set store: false to prevent
        // conversation storage on OpenAI's side
        let store = if self.account_id.is_some() {
            Some(false)
        } else {
            None
        };

        let request = OpenAIChatRequest {
            model: model.to_string(),
            messages: chat_messages,
            max_tokens: Some(8192),
            tools,
            stream: true,
            store,
        };

        let api_key = self.api_key.clone();
        let client = self.client.clone();
        let account_id = self.account_id.clone();

        tokio::spawn(async move {
            let result = stream_openai_response(client, api_key, account_id, request, conversation_id.clone(), tx.clone()).await;

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
        OPENAI_MODELS.iter().map(|m| m.id.clone()).collect()
    }

    async fn validate_credentials(&self) -> ProviderResult<bool> {
        // Send a minimal request to validate the API key
        let response = self
            .client
            .get("https://api.openai.com/v1/models")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .send()
            .await?;

        match response.status().as_u16() {
            200 => Ok(true),
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

async fn stream_openai_response(
    client: Client,
    api_key: String,
    account_id: Option<String>,
    request: OpenAIChatRequest,
    conversation_id: String,
    tx: mpsc::Sender<BackendEvent>,
) -> ProviderResult<()> {
    let mut request_builder = client
        .post(OPENAI_CHAT_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json");

    // Add ChatGPT-Account-ID header when using OAuth auth
    if let Some(ref account_id) = account_id {
        request_builder = request_builder.header("ChatGPT-Account-ID", account_id);
    }

    let response = request_builder
        .json(&request)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(ProviderError::ApiError(format!(
            "HTTP {}: {}",
            status, error_text
        )));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut accumulated_text = String::new();

    // Track tool calls being built
    let mut tool_calls: std::collections::HashMap<usize, (String, String, String)> =
        std::collections::HashMap::new(); // index -> (id, name, arguments)

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process SSE events
        while let Some(event_end) = buffer.find("\n\n") {
            let event_data = buffer[..event_end].to_string();
            buffer = buffer[event_end + 2..].to_string();

            // Parse SSE event
            for line in event_data.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        // Stream complete - emit final message
                        let final_tool_calls: Vec<AgentToolCall> = tool_calls
                            .values()
                            .map(|(id, name, args)| AgentToolCall {
                                id: id.clone(),
                                name: name.clone(),
                                arguments: args.clone(),
                            })
                            .collect();

                        let message = if final_tool_calls.is_empty() {
                            AgentMessage::text("assistant", &accumulated_text)
                        } else {
                            AgentMessage::assistant_with_tools(&accumulated_text, &final_tool_calls)
                        };

                        let _ = tx
                            .send(BackendEvent::AgentComplete {
                                conversation_id: conversation_id.clone(),
                                message,
                            })
                            .await;
                        continue;
                    }

                    if let Ok(chunk) = serde_json::from_str::<OpenAIStreamChunk>(data) {
                        for choice in chunk.choices {
                            // Handle content delta
                            if let Some(content) = choice.delta.content {
                                accumulated_text.push_str(&content);
                                let _ = tx
                                    .send(BackendEvent::AgentChunk {
                                        conversation_id: conversation_id.clone(),
                                        content,
                                    })
                                    .await;
                            }

                            // Handle tool call deltas
                            if let Some(tc_deltas) = choice.delta.tool_calls {
                                for tc_delta in tc_deltas {
                                    let entry = tool_calls
                                        .entry(tc_delta.index)
                                        .or_insert_with(|| (String::new(), String::new(), String::new()));

                                    if let Some(id) = tc_delta.id {
                                        entry.0 = id;
                                    }
                                    if let Some(func) = tc_delta.function {
                                        if let Some(name) = func.name {
                                            entry.1 = name;
                                        }
                                        if let Some(args) = func.arguments {
                                            entry.2.push_str(&args);
                                        }
                                    }
                                }
                            }

                            // Check for tool call finish
                            if choice.finish_reason == Some("tool_calls".to_string()) {
                                // Emit tool call events
                                for (_, (id, name, arguments)) in &tool_calls {
                                    let _ = tx
                                        .send(BackendEvent::AgentToolStart {
                                            conversation_id: conversation_id.clone(),
                                            tool_call: AgentToolCall {
                                                id: id.clone(),
                                                name: name.clone(),
                                                arguments: arguments.clone(),
                                            },
                                        })
                                        .await;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_messages() {
        let messages = vec![AgentMessage::text("user", "Hello")];

        let converted = OpenAIProvider::convert_to_chat_messages(&messages, Some("You are helpful"));
        assert_eq!(converted.len(), 2);
        assert_eq!(converted[0].role, "system");
        assert_eq!(converted[1].role, "user");
    }

    #[test]
    fn test_convert_tool_result_messages() {
        let messages = vec![
            AgentMessage::text("user", "Read test.txt"),
            AgentMessage::assistant_with_tools("", &[AgentToolCall {
                id: "tc-1".to_string(),
                name: "read_file".to_string(),
                arguments: r#"{"path":"/tmp/test.txt"}"#.to_string(),
            }]),
            AgentMessage::tool_result("tc-1", "file contents", false),
        ];

        let converted = OpenAIProvider::convert_to_chat_messages(&messages, None);
        assert_eq!(converted.len(), 3);
        // Tool result should become role: "tool"
        assert_eq!(converted[2].role, "tool");
        assert_eq!(converted[2].tool_call_id, Some("tc-1".to_string()));
    }
}
