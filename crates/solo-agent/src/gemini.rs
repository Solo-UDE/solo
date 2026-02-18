//! Google Gemini provider implementation
//!
//! Uses the Gemini REST API with streaming (SSE).
//! Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent`

use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use solo_protocol::{AgentMessage, AgentToolCall, BackendEvent, ContentBlock};
use std::collections::HashMap;
use tokio::sync::mpsc;
use tracing::{error, info};

use crate::models::GEMINI_MODELS;
use crate::provider::{AIProvider, ProviderError, ProviderResult, ProviderType, ToolDefinition};

const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

/// Gemini provider implementation
pub struct GeminiProvider {
    api_key: String,
    client: Client,
    tools: Vec<ToolDefinition>,
}

impl GeminiProvider {
    /// Create a new Gemini provider
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: Client::new(),
            tools: Vec::new(),
        }
    }

    /// Convert AgentMessage history to Gemini `contents` format.
    /// Gemini requires alternating `user` / `model` roles.
    /// Consecutive same-role messages are merged into a single message with combined parts.
    fn convert_messages(messages: &[AgentMessage]) -> Vec<serde_json::Value> {
        let mut contents: Vec<serde_json::Value> = Vec::new();

        // Build a lookup from tool_use_id -> function name so ToolResult can
        // reference the correct name (Gemini requires the actual function name
        // in functionResponse, not an opaque ID).
        let mut tool_id_to_name: HashMap<String, String> = HashMap::new();
        for msg in messages {
            for block in &msg.content {
                if let ContentBlock::ToolUse { id, name, .. } = block {
                    tool_id_to_name.insert(id.clone(), name.clone());
                }
            }
        }

        for msg in messages {
            if msg.role == "system" {
                continue; // system handled via systemInstruction
            }

            let gemini_role = match msg.role.as_str() {
                "assistant" => "model",
                _ => "user",
            };

            let mut parts: Vec<serde_json::Value> = Vec::new();
            for block in &msg.content {
                match block {
                    ContentBlock::Text { text } => {
                        if !text.is_empty() {
                            parts.push(serde_json::json!({ "text": text }));
                        }
                    }
                    ContentBlock::ToolUse {
                        id,
                        name,
                        arguments,
                    } => {
                        let args: serde_json::Value = serde_json::from_str(arguments)
                            .unwrap_or_else(|_| serde_json::json!({}));
                        parts.push(serde_json::json!({
                            "functionCall": {
                                "name": name,
                                "args": args
                            }
                        }));
                        let _ = id; // Gemini doesn't have native tool call IDs
                    }
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                        ..
                    } => {
                        // Resolve the actual function name from our lookup
                        let function_name = tool_id_to_name
                            .get(tool_use_id)
                            .cloned()
                            .unwrap_or_else(|| tool_use_id.clone());
                        parts.push(serde_json::json!({
                            "functionResponse": {
                                "name": function_name,
                                "response": {
                                    "content": content
                                }
                            }
                        }));
                    }
                }
            }

            if parts.is_empty() {
                continue;
            }

            // Merge with previous message if same role (Gemini requires alternating)
            if let Some(last) = contents.last_mut() {
                if last.get("role").and_then(|r| r.as_str()) == Some(gemini_role) {
                    if let Some(existing_parts) =
                        last.get_mut("parts").and_then(|p| p.as_array_mut())
                    {
                        existing_parts.extend(parts);
                        continue;
                    }
                }
            }

            contents.push(serde_json::json!({
                "role": gemini_role,
                "parts": parts,
            }));
        }

        contents
    }

    /// Convert tool definitions to Gemini `tools` format
    fn convert_tools(&self) -> Vec<serde_json::Value> {
        if self.tools.is_empty() {
            return Vec::new();
        }

        let function_declarations: Vec<serde_json::Value> = self
            .tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.input_schema
                })
            })
            .collect();

        vec![serde_json::json!({
            "functionDeclarations": function_declarations
        })]
    }
}

#[async_trait]
impl AIProvider for GeminiProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Gemini
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

        let url = format!(
            "{}/models/{}:streamGenerateContent?alt=sse",
            GEMINI_API_BASE, model
        );

        let contents = Self::convert_messages(messages);
        let tools = self.convert_tools();

        let mut body = serde_json::json!({
            "contents": contents,
        });

        if let Some(sp) = system_prompt {
            body["systemInstruction"] = serde_json::json!({
                "parts": [{ "text": sp }]
            });
        }

        if !tools.is_empty() {
            body["tools"] = serde_json::Value::Array(tools);
        }

        let client = self.client.clone();
        let api_key = self.api_key.clone();

        tokio::spawn(async move {
            let result = stream_gemini_response(
                client,
                url,
                api_key,
                body,
                conversation_id.clone(),
                tx.clone(),
            )
            .await;

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
        GEMINI_MODELS.iter().map(|m| m.id.clone()).collect()
    }

    async fn validate_credentials(&self) -> ProviderResult<bool> {
        let url = format!(
            "{}/models/gemini-2.0-flash:generateContent",
            GEMINI_API_BASE
        );

        let response = self
            .client
            .post(&url)
            .header("content-type", "application/json")
            .header("x-goog-api-key", &self.api_key)
            .json(&serde_json::json!({
                "contents": [{"parts": [{"text": "test"}]}]
            }))
            .send()
            .await?;

        match response.status().as_u16() {
            200 | 201 => Ok(true),
            400 => {
                let error_text = response.text().await.unwrap_or_default();
                if error_text.contains("API_KEY_INVALID") {
                    Err(ProviderError::AuthError("Invalid API key".to_string()))
                } else {
                    Ok(true) // Other 400s might be valid key with bad request
                }
            }
            401 | 403 => Err(ProviderError::AuthError("Invalid API key".to_string())),
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

/// Gemini SSE streaming response chunk
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GeminiStreamChunk {
    candidates: Option<Vec<GeminiCandidate>>,
    #[serde(rename = "usageMetadata")]
    usage_metadata: Option<serde_json::Value>,
    error: Option<GeminiError>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
    #[serde(rename = "finishReason")]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
    role: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GeminiPart {
    text: Option<String>,
    #[serde(rename = "functionCall")]
    function_call: Option<GeminiFunctionCall>,
}

#[derive(Debug, Deserialize)]
struct GeminiFunctionCall {
    name: String,
    args: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GeminiError {
    message: String,
    code: Option<i32>,
}

async fn stream_gemini_response(
    client: Client,
    url: String,
    api_key: String,
    body: serde_json::Value,
    conversation_id: String,
    tx: mpsc::Sender<BackendEvent>,
) -> ProviderResult<()> {
    info!(conversation_id = %conversation_id, "Starting Gemini streaming request");

    let response = client
        .post(&url)
        .header("content-type", "application/json")
        .header("x-goog-api-key", &api_key)
        .json(&body)
        .send()
        .await?;

    info!(conversation_id = %conversation_id, status = %response.status(), "Got Gemini response");

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        error!(conversation_id = %conversation_id, status = %status, error = %error_text, "Gemini API error");
        return Err(ProviderError::ApiError(format!(
            "HTTP {}: {}",
            status, error_text
        )));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut accumulated_text = String::new();
    let mut tool_call_counter = 0u32;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // Process SSE events (data: ... \n\n)
        while let Some(event_end) = buffer.find("\n\n") {
            let event_data = buffer[..event_end].to_string();
            buffer = buffer[event_end + 2..].to_string();

            for line in event_data.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        continue;
                    }

                    if let Ok(chunk) = serde_json::from_str::<GeminiStreamChunk>(data) {
                        // Handle errors
                        if let Some(error) = chunk.error {
                            error!(conversation_id = %conversation_id, "Gemini error: {}", error.message);
                            let _ = tx
                                .send(BackendEvent::AgentError {
                                    conversation_id: conversation_id.clone(),
                                    error: error.message,
                                })
                                .await;
                            return Ok(());
                        }

                        // Process candidates
                        if let Some(candidates) = chunk.candidates {
                            for candidate in candidates {
                                if let Some(content) = candidate.content {
                                    for part in content.parts {
                                        // Text part
                                        if let Some(text) = part.text {
                                            accumulated_text.push_str(&text);
                                            let _ = tx
                                                .send(BackendEvent::AgentChunk {
                                                    conversation_id: conversation_id.clone(),
                                                    content: text,
                                                })
                                                .await;
                                        }

                                        // Function call part
                                        if let Some(fc) = part.function_call {
                                            tool_call_counter += 1;
                                            let tool_call_id =
                                                format!("gemini-tc-{}", tool_call_counter);
                                            let arguments = serde_json::to_string(&fc.args)
                                                .unwrap_or_else(|_| "{}".to_string());

                                            let tool_call = AgentToolCall {
                                                id: tool_call_id,
                                                name: fc.name,
                                                arguments,
                                            };

                                            let _ = tx
                                                .send(BackendEvent::AgentToolStart {
                                                    conversation_id: conversation_id.clone(),
                                                    tool_call,
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
        }
    }

    // Stream finished — emit complete
    info!(
        conversation_id = %conversation_id,
        text_len = accumulated_text.len(),
        "Gemini streaming complete"
    );
    let _ = tx
        .send(BackendEvent::AgentComplete {
            conversation_id,
            message: AgentMessage::text("assistant", &accumulated_text),
        })
        .await;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_messages() {
        let messages = vec![AgentMessage::text("user", "Hello")];
        let converted = GeminiProvider::convert_messages(&messages);
        assert_eq!(converted.len(), 1);
        assert_eq!(converted[0]["role"], "user");
        assert_eq!(converted[0]["parts"][0]["text"], "Hello");
    }

    #[test]
    fn test_convert_messages_merges_same_role() {
        let messages = vec![
            AgentMessage::text("user", "Hello"),
            AgentMessage::tool_result("tc-1", "result data", false),
        ];
        let converted = GeminiProvider::convert_messages(&messages);
        // Both are role "user" so they should be merged
        assert_eq!(converted.len(), 1);
        assert_eq!(converted[0]["role"], "user");
        let parts = converted[0]["parts"].as_array().unwrap();
        assert_eq!(parts.len(), 2);
    }

    #[test]
    fn test_convert_messages_alternating() {
        let messages = vec![
            AgentMessage::text("user", "Read the file"),
            AgentMessage::assistant_with_tools(
                "I'll read it.",
                &[AgentToolCall {
                    id: "tc-1".to_string(),
                    name: "read_file".to_string(),
                    arguments: r#"{"path":"/tmp/test"}"#.to_string(),
                }],
            ),
            AgentMessage::tool_result("tc-1", "file contents", false),
        ];
        let converted = GeminiProvider::convert_messages(&messages);
        assert_eq!(converted.len(), 3);
        assert_eq!(converted[0]["role"], "user");
        assert_eq!(converted[1]["role"], "model");
        assert_eq!(converted[2]["role"], "user");
    }

    #[test]
    fn test_convert_messages_tool_result_uses_function_name() {
        let messages = vec![
            AgentMessage::text("user", "Read the file"),
            AgentMessage::assistant_with_tools(
                "I'll read it.",
                &[AgentToolCall {
                    id: "gemini-tc-1".to_string(),
                    name: "read_file".to_string(),
                    arguments: r#"{"path":"/tmp/test"}"#.to_string(),
                }],
            ),
            AgentMessage::tool_result("gemini-tc-1", "file contents here", false),
        ];
        let converted = GeminiProvider::convert_messages(&messages);
        // The tool result message (index 2) should use "read_file" not "gemini-tc-1"
        let tool_result_parts = converted[2]["parts"].as_array().unwrap();
        let func_resp = &tool_result_parts[0]["functionResponse"];
        assert_eq!(func_resp["name"], "read_file");
    }

    #[test]
    fn test_convert_tools() {
        let mut provider = GeminiProvider::new("test-key".to_string());
        provider.set_tools(vec![ToolDefinition {
            name: "read_file".to_string(),
            description: "Read a file".to_string(),
            input_schema: serde_json::json!({"type": "object"}),
            needs_approval: false,
        }]);
        let tools = provider.convert_tools();
        assert_eq!(tools.len(), 1);
        let decls = tools[0]["functionDeclarations"].as_array().unwrap();
        assert_eq!(decls.len(), 1);
        assert_eq!(decls[0]["name"], "read_file");
    }
}
