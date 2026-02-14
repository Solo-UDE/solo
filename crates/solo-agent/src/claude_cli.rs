//! Claude CLI provider implementation
//!
//! This module implements the AIProvider trait by spawning the Claude Code CLI
//! (`claude --print`) for inference. This allows users with Claude Pro/Max
//! subscriptions to use their subscription billing instead of API credits.
//!
//! Claude Code OAuth tokens CANNOT be used for direct API calls - they must go
//! through the CLI which handles the subscription billing translation internally.

use async_trait::async_trait;
use serde::Deserialize;
use solo_protocol::{AgentMessage, AgentToolCall, BackendEvent};
use std::collections::HashSet;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::models::ANTHROPIC_MODELS;
use crate::provider::{AIProvider, ProviderError, ProviderResult, ProviderType, ToolDefinition};

/// Environment variables to remove when spawning the Claude CLI.
/// CLAUDECODE is set by Claude Code sessions — if present, the CLI
/// refuses to start ("cannot be launched inside another Claude Code session").
const ENVS_TO_REMOVE: &[&str] = &["CLAUDECODE"];

/// Check if the Claude CLI is installed and accessible
pub async fn is_cli_available() -> bool {
    match Command::new("which").arg("claude").output().await {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

/// Get the path to the Claude CLI if available
pub async fn get_cli_path() -> Option<String> {
    match Command::new("which").arg("claude").output().await {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if path.is_empty() {
                None
            } else {
                Some(path)
            }
        }
        _ => None,
    }
}

/// Claude CLI provider that spawns the CLI for inference
///
/// This provider uses the Claude CLI's `--print` mode to get streaming JSON
/// output without interactive features. The CLI handles OAuth token management
/// and subscription billing internally.
pub struct ClaudeCliProvider {
    tools: Vec<ToolDefinition>,
}

impl ClaudeCliProvider {
    /// Create a new Claude CLI provider
    pub fn new() -> Self {
        Self { tools: Vec::new() }
    }

    /// Build the system prompt with tool definitions for the CLI
    fn build_system_with_tools(&self, system_prompt: Option<&str>) -> Option<String> {
        if self.tools.is_empty() {
            return system_prompt.map(String::from);
        }

        // Build tools JSON for the system prompt
        let tools_json: Vec<serde_json::Value> = self
            .tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema
                })
            })
            .collect();

        let tools_section = format!(
            "\n\n# Available Tools\n\nYou have access to the following tools:\n\n```json\n{}\n```\n\nWhen you want to use a tool, output a tool_use block with the tool name and input.",
            serde_json::to_string_pretty(&tools_json).unwrap_or_default()
        );

        Some(match system_prompt {
            Some(sp) => format!("{}{}", sp, tools_section),
            None => tools_section,
        })
    }
}

impl Default for ClaudeCliProvider {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// CLI Output Parsing
// =============================================================================

/// Event types from the CLI's stream-json output
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
enum CliEvent {
    System(CliSystemEvent),
    Assistant(CliAssistantEvent),
    Result(CliResultEvent),
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Deserialize)]
struct CliSystemEvent {
    #[serde(default)]
    subtype: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CliAssistantEvent {
    message: CliMessage,
}

#[derive(Debug, Deserialize)]
struct CliMessage {
    #[serde(default)]
    content: Vec<CliContentBlock>,
    #[serde(default)]
    role: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
enum CliContentBlock {
    Text { text: String },
    ToolUse { id: String, name: String, input: serde_json::Value },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Deserialize)]
struct CliResultEvent {
    #[serde(default)]
    subtype: Option<String>,
    #[serde(default)]
    duration_ms: Option<u64>,
    #[serde(default)]
    total_cost_usd: Option<f64>,
}

// =============================================================================
// AIProvider Implementation
// =============================================================================

#[async_trait]
impl AIProvider for ClaudeCliProvider {
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

        // Build the prompt from messages
        let prompt = build_prompt_from_messages(messages);

        // Build system prompt with tools if any
        let full_system = self.build_system_with_tools(system_prompt);

        let model = model.to_string();

        tokio::spawn(async move {
            let result =
                stream_cli_response(model, prompt, full_system, conversation_id.clone(), tx.clone())
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
        ANTHROPIC_MODELS.iter().map(|m| m.id.clone()).collect()
    }

    async fn validate_credentials(&self) -> ProviderResult<bool> {
        // For CLI provider, we just check if the CLI is available and logged in
        if !is_cli_available().await {
            return Err(ProviderError::AuthError(
                "Claude CLI not installed. Run: npm i -g @anthropic-ai/claude-code".to_string(),
            ));
        }

        // Try a minimal CLI call to verify login
        let mut cmd = Command::new("claude");
        cmd.args(["--version"]);
        for var in ENVS_TO_REMOVE {
            cmd.env_remove(var);
        }
        let output = cmd
            .output()
            .await
            .map_err(|e| ProviderError::ApiError(format!("Failed to run claude CLI: {}", e)))?;

        if output.status.success() {
            Ok(true)
        } else {
            Err(ProviderError::AuthError(
                "Claude CLI not configured. Run: claude login".to_string(),
            ))
        }
    }

    fn set_tools(&mut self, tools: Vec<ToolDefinition>) {
        self.tools = tools;
    }

    fn get_tools(&self) -> &[ToolDefinition] {
        &self.tools
    }
}

// =============================================================================
// CLI Streaming
// =============================================================================

/// Build a prompt string from conversation messages
fn build_prompt_from_messages(messages: &[AgentMessage]) -> String {
    // For the CLI, we need to flatten the conversation into a single prompt
    // The most recent user message is the main prompt
    // Previous context is included as conversation history

    let mut prompt_parts: Vec<String> = Vec::new();

    for msg in messages {
        let role = msg.role.as_str();
        let text = msg.display_text();

        if !text.is_empty() {
            match role {
                "user" => prompt_parts.push(format!("User: {}", text)),
                "assistant" => prompt_parts.push(format!("Assistant: {}", text)),
                _ => {}
            }
        }
    }

    // If there's history, wrap it as context
    if prompt_parts.len() > 1 {
        let last = prompt_parts.pop().unwrap_or_default();
        let history = prompt_parts.join("\n\n");
        format!(
            "<conversation_history>\n{}\n</conversation_history>\n\nNow respond to:\n{}",
            history,
            last.strip_prefix("User: ").unwrap_or(&last)
        )
    } else {
        prompt_parts
            .pop()
            .map(|s| s.strip_prefix("User: ").unwrap_or(&s).to_string())
            .unwrap_or_default()
    }
}

/// Stream response from the Claude CLI
async fn stream_cli_response(
    model: String,
    prompt: String,
    system_prompt: Option<String>,
    conversation_id: String,
    tx: mpsc::Sender<BackendEvent>,
) -> ProviderResult<()> {
    info!(
        conversation_id = %conversation_id,
        model = %model,
        "Starting Claude CLI streaming request"
    );

    // Build CLI arguments
    // --verbose is required when using --output-format stream-json with --print
    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--model".to_string(),
        model.clone(),
    ];

    // Add system prompt if provided
    if let Some(ref sp) = system_prompt {
        args.push("--system-prompt".to_string());
        args.push(sp.clone());
    }

    // The prompt is passed as the last argument
    args.push(prompt);

    debug!(conversation_id = %conversation_id, args = ?args, "Spawning Claude CLI");

    let mut cmd = Command::new("claude");
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Remove env vars that prevent the CLI from launching
    for var in ENVS_TO_REMOVE {
        cmd.env_remove(var);
    }

    let mut child = cmd.spawn().map_err(|e| {
        error!(error = %e, "Failed to spawn Claude CLI");
        ProviderError::ApiError(format!("Failed to spawn Claude CLI: {}", e))
    })?;

    let stdout = child.stdout.take().ok_or_else(|| {
        ProviderError::ApiError("Failed to capture Claude CLI stdout".to_string())
    })?;

    let stderr = child.stderr.take();

    // Spawn a task to collect stderr for error reporting
    let stderr_lines: Arc<tokio::sync::Mutex<Vec<String>>> =
        Arc::new(tokio::sync::Mutex::new(Vec::new()));
    if let Some(stderr) = stderr {
        let cid = conversation_id.clone();
        let stderr_capture = stderr_lines.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                warn!(conversation_id = %cid, stderr = %line, "Claude CLI stderr");
                stderr_capture.lock().await.push(line);
            }
        });
    }

    // Read and parse NDJSON output
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut accumulated_text = String::new();
    let mut last_emitted_text_len = 0;
    let mut emitted_tool_ids: HashSet<String> = HashSet::new();
    let mut completion_sent = false;

    while let Ok(Some(line)) = lines.next_line().await {
        if line.is_empty() {
            continue;
        }

        debug!(conversation_id = %conversation_id, line_len = line.len(), "CLI output line");

        match serde_json::from_str::<CliEvent>(&line) {
            Ok(event) => {
                match event {
                    CliEvent::System(sys) => {
                        debug!(
                            conversation_id = %conversation_id,
                            subtype = ?sys.subtype,
                            session_id = ?sys.session_id,
                            model = ?sys.model,
                            "CLI system event"
                        );
                    }
                    CliEvent::Assistant(assistant) => {
                        for block in assistant.message.content {
                            match block {
                                CliContentBlock::Text { text } => {
                                    accumulated_text.push_str(&text);

                                    // Emit incremental chunks
                                    if accumulated_text.len() > last_emitted_text_len {
                                        let new_content =
                                            &accumulated_text[last_emitted_text_len..];
                                        let _ = tx
                                            .send(BackendEvent::AgentChunk {
                                                conversation_id: conversation_id.clone(),
                                                content: new_content.to_string(),
                                            })
                                            .await;
                                        last_emitted_text_len = accumulated_text.len();
                                    }
                                }
                                CliContentBlock::ToolUse { id, name, input } => {
                                    // Only emit if not already sent (dedup repeated tool blocks)
                                    if emitted_tool_ids.insert(id.clone()) {
                                        let tool_call = AgentToolCall {
                                            id: id.clone(),
                                            name: name.clone(),
                                            arguments: serde_json::to_string(&input)
                                                .unwrap_or_default(),
                                        };
                                        let _ = tx
                                            .send(BackendEvent::AgentToolStart {
                                                conversation_id: conversation_id.clone(),
                                                tool_call,
                                            })
                                            .await;
                                    }
                                }
                                CliContentBlock::Unknown => {}
                            }
                        }
                    }
                    CliEvent::Result(result) => {
                        debug!(
                            conversation_id = %conversation_id,
                            subtype = ?result.subtype,
                            duration_ms = ?result.duration_ms,
                            cost_usd = ?result.total_cost_usd,
                            "CLI result event"
                        );

                        // Send completion only once (CLI may emit multiple result events)
                        if !completion_sent {
                            completion_sent = true;
                            let _ = tx
                                .send(BackendEvent::AgentComplete {
                                    conversation_id: conversation_id.clone(),
                                    message: AgentMessage::text("assistant", &accumulated_text),
                                })
                                .await;
                        }
                    }
                    CliEvent::Unknown => {
                        debug!(conversation_id = %conversation_id, "Unknown CLI event type");
                    }
                }
            }
            Err(e) => {
                warn!(
                    conversation_id = %conversation_id,
                    error = %e,
                    line = %line,
                    "Failed to parse CLI JSON output"
                );
            }
        }
    }

    // Wait for CLI to exit
    let status = child.wait().await.map_err(|e| {
        ProviderError::ApiError(format!("Failed to wait for Claude CLI: {}", e))
    })?;

    if !status.success() {
        let exit_code = status.code().unwrap_or(-1);
        let captured_stderr = stderr_lines.lock().await.join("\n");

        error!(
            conversation_id = %conversation_id,
            exit_code = exit_code,
            stderr = %captured_stderr,
            "Claude CLI exited with error"
        );

        // Check stderr for specific error patterns
        let stderr_lower = captured_stderr.to_lowercase();
        if stderr_lower.contains("authentication")
            || stderr_lower.contains("not logged in")
            || stderr_lower.contains("login")
            || stderr_lower.contains("unauthorized")
        {
            return Err(ProviderError::AuthError(format!(
                "Claude CLI authentication failed: {}",
                if captured_stderr.is_empty() { "Run: claude login".to_string() } else { captured_stderr }
            )));
        }

        return Err(ProviderError::ApiError(format!(
            "Claude CLI exited with code {}: {}",
            exit_code,
            if captured_stderr.is_empty() { "no stderr output".to_string() } else { captured_stderr }
        )));
    }

    info!(
        conversation_id = %conversation_id,
        text_len = accumulated_text.len(),
        "CLI streaming complete"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_prompt_single_message() {
        let messages = vec![AgentMessage::text("user", "Hello, Claude!")];
        let prompt = build_prompt_from_messages(&messages);
        assert_eq!(prompt, "Hello, Claude!");
    }

    #[test]
    fn test_build_prompt_with_history() {
        let messages = vec![
            AgentMessage::text("user", "What is 2+2?"),
            AgentMessage::text("assistant", "2+2 equals 4."),
            AgentMessage::text("user", "And what about 3+3?"),
        ];
        let prompt = build_prompt_from_messages(&messages);
        assert!(prompt.contains("<conversation_history>"));
        assert!(prompt.contains("User: What is 2+2?"));
        assert!(prompt.contains("Assistant: 2+2 equals 4."));
        assert!(prompt.contains("And what about 3+3?"));
    }

    #[tokio::test]
    async fn test_cli_provider_creation() {
        let provider = ClaudeCliProvider::new();
        assert_eq!(provider.provider_type(), ProviderType::Anthropic);
        assert!(!provider.available_models().is_empty());
    }
}
