//! Claude CLI provider implementation
//!
//! This module implements the AIProvider trait by spawning the Claude Code CLI
//! (`claude --print`) for inference. This allows users with Claude Pro/Max
//! subscriptions to use their subscription billing instead of API credits.
//!
//! Claude Code OAuth tokens CANNOT be used for direct API calls - they must go
//! through the CLI which handles the subscription billing translation internally.
//!
//! ## Permission Bridge (Native Control Protocol)
//!
//! When `loop_approvals` is provided to `stream_cli_response`, the CLI is spawned
//! with `--permission-prompt-tool stdio`, which enables a bidirectional control
//! message protocol over stdin/stdout:
//!
//! 1. CLI sends `control_request` on stdout when a tool needs permission
//! 2. Solo emits `AgentToolApprovalNeeded` to the frontend and creates a oneshot
//!    in the shared `loop_approvals` map
//! 3. The user approves/denies via the `approve_tool_call`/`reject_tool_call`
//!    Tauri commands, which resolve the oneshot
//! 4. Solo writes a `control_response` back to the CLI's stdin
//!
//! This replaces the previous MCP server + Unix socket approach with a simpler,
//! more reliable native protocol.

use async_trait::async_trait;
use serde::Deserialize;
use solo_protocol::{AgentMessage, AgentToolCall, BackendEvent, ToolCallStatus, ToolCallWithStatus};
use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, watch, RwLock};
use tracing::{debug, error, info, trace, warn};

use crate::models::ANTHROPIC_MODELS;
use crate::provider::{AIProvider, ProviderError, ProviderResult, ProviderType, ToolDefinition};

/// Environment variables to remove when spawning the Claude CLI.
/// CLAUDECODE is set by Claude Code sessions — if present, the CLI
/// refuses to start ("cannot be launched inside another Claude Code session").
const ENVS_TO_REMOVE: &[&str] = &["CLAUDECODE"];

/// Timeout for waiting on a permission approval decision (5 minutes).
const PERMISSION_TIMEOUT_SECS: u64 = 300;

/// Shared approval map for CLI permission prompts.
///
/// Maps `request_id` (from `control_request`) to `(tool_call, oneshot_sender)`.
/// The streaming task inserts entries when it encounters `control_request` events;
/// the `approve_tool_call`/`reject_tool_call` Tauri commands resolve them.
pub type ApprovalMap = Arc<RwLock<HashMap<String, (AgentToolCall, oneshot::Sender<bool>)>>>;

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
///
/// **Important:** The CLI has its own built-in tools (Read, Edit, Write, Bash,
/// Glob, Grep) and runs its own agentic loop. We do NOT embed Solo's tool
/// definitions — instead we use `--append-system-prompt` for workspace context
/// and `--allowedTools` to auto-approve safe tools.
///
/// When called through the `AIProvider` trait (`send_message`), all tools are
/// auto-approved. For interactive permission prompts, call `stream_cli_response`
/// directly with a `loop_approvals` map.
pub struct ClaudeCliProvider;

impl ClaudeCliProvider {
    pub fn new() -> Self {
        Self
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

/// Event types from the CLI's stream-json output.
///
/// Includes the native `control_request` variant used by
/// `--permission-prompt-tool stdio` for interactive tool approval.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
enum CliEvent {
    System(CliSystemEvent),
    Assistant(CliAssistantEvent),
    User(CliUserEvent),
    Result(CliResultEvent),
    /// Native permission prompt: the CLI asks whether a tool may run.
    /// Solo must respond with a `control_response` on stdin.
    ControlRequest {
        request_id: String,
        request: ControlRequestBody,
    },
    /// Streaming event wrapper emitted when using `--input-format stream-json`.
    /// Contains Anthropic API-style events (content_block_delta, etc.).
    StreamEvent {
        event: StreamEventInner,
    },
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

/// User events contain tool results — one `tool_result` block per tool call.
#[derive(Debug, Deserialize)]
struct CliUserEvent {
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
    ToolResult { tool_use_id: String, #[serde(default)] content: serde_json::Value },
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

/// Body of a `control_request` from the CLI.
///
/// When `subtype` is `"can_use_tool"`, the CLI is asking for permission to
/// execute a specific tool. `tool_name` and `input` describe the tool call.
#[derive(Debug, Deserialize)]
struct ControlRequestBody {
    subtype: String,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    input: Option<serde_json::Value>,
}

/// Inner event from a `stream_event` wrapper (Anthropic API streaming format).
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct StreamEventInner {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    delta: Option<StreamDelta>,
    #[serde(default)]
    index: Option<u32>,
    #[serde(default)]
    content_block: Option<StreamContentBlock>,
}

/// Delta within a `content_block_delta` stream event.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct StreamDelta {
    #[serde(default)]
    text: Option<String>,
    #[serde(rename = "type")]
    #[serde(default)]
    delta_type: Option<String>,
    #[serde(default)]
    partial_json: Option<String>,
}

/// Content block from `content_block_start` stream events.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct StreamContentBlock {
    #[serde(rename = "type")]
    #[serde(default)]
    block_type: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    text: Option<String>,
}

// =============================================================================
// AIProvider Implementation
// =============================================================================

#[async_trait]
impl AIProvider for ClaudeCliProvider {
    fn provider_type(&self) -> ProviderType {
        ProviderType::Anthropic
    }

    /// Send a message through the CLI with all tools auto-approved.
    ///
    /// For interactive permission prompts, use `stream_cli_response` directly
    /// with a `loop_approvals` map instead.
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

        // Pass system prompt through unchanged — no tool embedding needed.
        // The CLI has its own built-in tools; we only provide workspace context.
        let full_system = system_prompt.map(String::from);

        let model = model.to_string();

        tokio::spawn(async move {
            let result = stream_cli_response(
                model,
                prompt,
                full_system,
                conversation_id.clone(),
                tx.clone(),
                None, // No permission bridge — auto-approve all tools
                None, // No abort signal from trait interface
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

    fn set_tools(&mut self, _tools: Vec<ToolDefinition>) {
        // No-op: CLI has its own built-in tools (Read, Edit, Write, Bash, Glob, Grep).
        // Solo's tool definitions are not used in CLI mode.
    }

    fn get_tools(&self) -> &[ToolDefinition] {
        // CLI manages its own tools internally
        &[]
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

/// Stream response from the Claude CLI.
///
/// When `loop_approvals` is `Some`, the CLI is spawned with the native
/// `--permission-prompt-tool stdio` protocol. Tools not in `--allowedTools`
/// trigger `control_request` events on stdout; Solo responds with
/// `control_response` on stdin after the user approves or denies.
///
/// When `loop_approvals` is `None`, all built-in tools are auto-approved
/// (legacy behavior for `send_message` trait calls).
pub async fn stream_cli_response(
    model: String,
    prompt: String,
    system_prompt: Option<String>,
    conversation_id: String,
    tx: mpsc::Sender<BackendEvent>,
    loop_approvals: Option<ApprovalMap>,
    abort_rx: Option<watch::Receiver<bool>>,
) -> ProviderResult<()> {
    let has_permission_bridge = loop_approvals.is_some();

    info!(
        conversation_id = %conversation_id,
        model = %model,
        has_permission_bridge = has_permission_bridge,
        "Spawning Claude CLI"
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

    if has_permission_bridge {
        // Bidirectional streaming: prompt goes via stdin as JSON, control
        // messages (permission prompts) also flow through stdin/stdout.
        // --input-format stream-json tells the CLI to read the initial prompt
        // from stdin as a JSON user message instead of a positional arg.
        args.extend([
            "--input-format".to_string(),
            "stream-json".to_string(),
        ]);

        // Native control protocol for permission decisions
        args.extend([
            "--permission-prompt-tool".to_string(),
            "stdio".to_string(),
        ]);

        // Ephemeral sessions — no disk storage
        args.push("--no-session-persistence".to_string());

        // Only auto-approve safe, read-only tools (comma-separated).
        // Everything else goes through the permission prompt.
        args.extend([
            "--allowedTools".to_string(),
            "Read,Glob,Grep".to_string(),
        ]);

        // IMPORTANT: Do NOT push the prompt to args — it goes via stdin
        info!(
            conversation_id = %conversation_id,
            "Permission bridge configured (bidirectional stream-json)"
        );
    } else {
        // No permission bridge — auto-approve all built-in tools (legacy behavior).
        // The CLI subprocess can't show interactive prompts without the bridge.
        args.push("--no-session-persistence".to_string());
        args.extend([
            "--allowedTools".to_string(),
            "Bash(command:*),Read,Edit,Write,Glob,Grep".to_string(),
        ]);

        // Prompt is the last positional argument (non-bridge path only)
        args.push(prompt.clone());
    }

    // APPEND to the CLI's default system prompt instead of replacing it.
    // The CLI's default prompt knows about its own tools — replacing it with
    // --system-prompt would strip that knowledge.
    if let Some(ref sp) = system_prompt {
        args.push("--append-system-prompt".to_string());
        args.push(sp.clone());
    }

    debug!(conversation_id = %conversation_id, args = ?args, "Spawning Claude CLI");

    let mut cmd = Command::new("claude");
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Pipe stdin when using the native control protocol
    if has_permission_bridge {
        cmd.stdin(Stdio::piped());
    }

    // Remove env vars that prevent the CLI from launching
    for var in ENVS_TO_REMOVE {
        cmd.env_remove(var);
    }

    let mut child = cmd.spawn().map_err(|e| {
        error!(error = %e, "Failed to spawn Claude CLI");
        ProviderError::ApiError(format!("Failed to spawn Claude CLI: {}", e))
    })?;

    let pid = child.id().unwrap_or(0);
    info!(
        conversation_id = %conversation_id,
        pid = pid,
        "CLI spawned. Manual test: claude {}",
        args.iter()
            .map(|a| if a.contains(' ') || a.contains('"') { format!("'{}'", a) } else { a.clone() })
            .collect::<Vec<_>>()
            .join(" ")
    );

    // Take stdin for writing control responses and sending the prompt
    let mut stdin = child.stdin.take();

    // If using bidirectional streaming, send the prompt as a JSON user message via stdin
    if has_permission_bridge {
        if let Some(ref mut si) = stdin {
            let user_message = serde_json::json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": prompt
                }
            });
            let line = format!("{}\n", user_message);
            si.write_all(line.as_bytes()).await.map_err(|e| {
                ProviderError::ApiError(format!("Failed to write prompt to CLI stdin: {}", e))
            })?;
            si.flush().await.map_err(|e| {
                ProviderError::ApiError(format!("Failed to flush CLI stdin: {}", e))
            })?;
            info!(conversation_id = %conversation_id, "Sent prompt to CLI via stdin (stream-json)");
        }
    }

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
                info!(conversation_id = %cid, stderr = %line, "Claude CLI stderr");
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
    let mut aborted = false;

    while let Ok(Some(line)) = lines.next_line().await {
        // Check abort signal between lines
        if let Some(ref rx) = abort_rx {
            if *rx.borrow() {
                info!(conversation_id = %conversation_id, "Abort signal received, terminating CLI");
                aborted = true;
                break;
            }
        }

        if line.is_empty() {
            continue;
        }

        trace!(conversation_id = %conversation_id, json_line = %line, "Raw CLI event");
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
                                        debug!(
                                            conversation_id = %conversation_id,
                                            chunk_size = new_content.len(),
                                            total_size = accumulated_text.len(),
                                            "CLI text chunk"
                                        );
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
                                        info!(
                                            conversation_id = %conversation_id,
                                            tool_name = %name,
                                            tool_id = %id,
                                            input_size = input.to_string().len(),
                                            "CLI tool invocation"
                                        );
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
                                CliContentBlock::ToolResult { tool_use_id, content } => {
                                    // Extract text from the tool result content
                                    let result_text = match &content {
                                        serde_json::Value::String(s) => s.clone(),
                                        serde_json::Value::Array(arr) => {
                                            // Content may be an array of {type: "text", text: "..."} blocks
                                            arr.iter()
                                                .filter_map(|v| v.get("text").and_then(|t| t.as_str()))
                                                .collect::<Vec<_>>()
                                                .join("\n")
                                        }
                                        other => other.to_string(),
                                    };

                                    info!(
                                        conversation_id = %conversation_id,
                                        tool_use_id = %tool_use_id,
                                        result_len = result_text.len(),
                                        "CLI tool result"
                                    );

                                    let _ = tx
                                        .send(BackendEvent::AgentToolEnd {
                                            conversation_id: conversation_id.clone(),
                                            tool_call_id: tool_use_id,
                                            result: result_text,
                                        })
                                        .await;
                                }
                                CliContentBlock::Unknown => {}
                            }
                        }
                    }
                    CliEvent::User(user) => {
                        for block in user.message.content {
                            if let CliContentBlock::ToolResult { tool_use_id, content } = block {
                                let result_text = match &content {
                                    serde_json::Value::String(s) => s.clone(),
                                    serde_json::Value::Array(arr) => {
                                        arr.iter()
                                            .filter_map(|v| v.get("text").and_then(|t| t.as_str()))
                                            .collect::<Vec<_>>()
                                            .join("\n")
                                    }
                                    other => other.to_string(),
                                };

                                info!(
                                    conversation_id = %conversation_id,
                                    tool_use_id = %tool_use_id,
                                    result_len = result_text.len(),
                                    "CLI tool result (user event)"
                                );

                                let _ = tx
                                    .send(BackendEvent::AgentToolEnd {
                                        conversation_id: conversation_id.clone(),
                                        tool_call_id: tool_use_id,
                                        result: result_text,
                                    })
                                    .await;
                            }
                        }
                    }

                    // ── Native permission prompt (control protocol) ──────────
                    CliEvent::ControlRequest { request_id, request } => {
                        if request.subtype == "can_use_tool" {
                            let tool_name = request.tool_name.unwrap_or_else(|| "unknown".to_string());
                            let tool_input = request.input.unwrap_or(serde_json::Value::Object(Default::default()));

                            info!(
                                conversation_id = %conversation_id,
                                request_id = %request_id,
                                tool_name = %tool_name,
                                "CLI permission request (native control protocol)"
                            );

                            let approved = if let Some(ref approvals) = loop_approvals {
                                // Create a oneshot for the approve/reject commands to resolve
                                let (otx, orx) = oneshot::channel();
                                let tool_call = AgentToolCall {
                                    id: request_id.clone(),
                                    name: tool_name.clone(),
                                    arguments: serde_json::to_string(&tool_input).unwrap_or_default(),
                                };

                                // Store in shared approval map — reuses existing
                                // approve_tool_call/reject_tool_call infrastructure
                                approvals.write().await.insert(
                                    request_id.clone(),
                                    (tool_call.clone(), otx),
                                );

                                // Emit to frontend (existing ToolApprovalDialog handles this)
                                let _ = tx.send(BackendEvent::AgentToolApprovalNeeded {
                                    conversation_id: conversation_id.clone(),
                                    tool_call: ToolCallWithStatus {
                                        tool_call,
                                        status: ToolCallStatus::PendingApproval,
                                        result: None,
                                        error: None,
                                        needs_approval: true,
                                    },
                                }).await;

                                // Wait for the user's decision (with timeout)
                                match tokio::time::timeout(
                                    Duration::from_secs(PERMISSION_TIMEOUT_SECS),
                                    orx,
                                ).await {
                                    Ok(Ok(decision)) => decision,
                                    Ok(Err(_)) => {
                                        // Sender dropped (session aborted)
                                        warn!(request_id = %request_id, "Permission approval channel dropped");
                                        false
                                    }
                                    Err(_) => {
                                        // Timeout
                                        warn!(request_id = %request_id, "Permission approval timed out");
                                        approvals.write().await.remove(&request_id);
                                        false
                                    }
                                }
                            } else {
                                // No approval map — auto-approve (shouldn't happen
                                // because permission bridge isn't configured, but
                                // handle gracefully)
                                true
                            };

                            // Write control_response back to CLI stdin
                            let behavior = if approved {
                                serde_json::json!({"behavior": "allow"})
                            } else {
                                serde_json::json!({"behavior": "deny", "message": "User denied in Solo IDE"})
                            };

                            let control_response = serde_json::json!({
                                "type": "control_response",
                                "request_id": request_id,
                                "response": {
                                    "subtype": "success",
                                    "response": behavior
                                }
                            });

                            if let Some(ref mut si) = stdin {
                                let line = format!("{}\n", control_response);
                                if let Err(e) = si.write_all(line.as_bytes()).await {
                                    error!(
                                        request_id = %request_id,
                                        error = %e,
                                        "Failed to write control_response to CLI stdin"
                                    );
                                }
                                let _ = si.flush().await;
                            } else {
                                error!(
                                    request_id = %request_id,
                                    "No stdin pipe available for control_response"
                                );
                            }

                            info!(
                                request_id = %request_id,
                                approved = approved,
                                "Permission decision sent to CLI"
                            );
                        } else {
                            debug!(
                                conversation_id = %conversation_id,
                                subtype = %request.subtype,
                                "Unhandled control request subtype"
                            );
                        }
                    }

                    // ── Stream events (bidirectional streaming mode) ─────────
                    CliEvent::StreamEvent { event } => {
                        match event.event_type.as_str() {
                            "content_block_delta" => {
                                if let Some(delta) = event.delta {
                                    if let Some(text) = delta.text {
                                        accumulated_text.push_str(&text);
                                        let _ = tx
                                            .send(BackendEvent::AgentChunk {
                                                conversation_id: conversation_id.clone(),
                                                content: text,
                                            })
                                            .await;
                                        last_emitted_text_len = accumulated_text.len();
                                    }
                                    // partial_json for tool_use deltas — accumulate for
                                    // tool input but don't emit as text
                                    if let Some(_partial) = delta.partial_json {
                                        trace!(
                                            conversation_id = %conversation_id,
                                            "Stream partial_json delta (tool input)"
                                        );
                                    }
                                }
                            }
                            "content_block_start" => {
                                if let Some(cb) = event.content_block {
                                    if cb.block_type.as_deref() == Some("tool_use") {
                                        let tool_id = cb.id.unwrap_or_default();
                                        let tool_name = cb.name.unwrap_or_else(|| "unknown".to_string());
                                        if emitted_tool_ids.insert(tool_id.clone()) {
                                            info!(
                                                conversation_id = %conversation_id,
                                                tool_name = %tool_name,
                                                tool_id = %tool_id,
                                                "Stream tool_use start"
                                            );
                                            let tool_call = AgentToolCall {
                                                id: tool_id,
                                                name: tool_name,
                                                arguments: String::new(),
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
                            "message_stop" | "message_delta" => {
                                debug!(
                                    conversation_id = %conversation_id,
                                    event_type = %event.event_type,
                                    "Stream lifecycle event"
                                );
                            }
                            _ => {
                                trace!(
                                    conversation_id = %conversation_id,
                                    event_type = %event.event_type,
                                    "Unhandled stream event type"
                                );
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
                        // Extract the "type" field from the raw JSON for diagnostics
                        if let Ok(raw) = serde_json::from_str::<serde_json::Value>(&line) {
                            let event_type = raw.get("type").and_then(|t| t.as_str()).unwrap_or("?");
                            debug!(conversation_id = %conversation_id, event_type = %event_type, "Unhandled CLI event type");
                        } else {
                            debug!(conversation_id = %conversation_id, "Unknown CLI event type");
                        }
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

    // Drop stdin to signal EOF — unblocks the CLI if it's waiting for input.
    // This is critical: without this, the CLI hangs and child.wait() never returns.
    drop(stdin);

    // If aborted, kill the process immediately
    if aborted {
        let _ = child.kill().await;
        info!(conversation_id = %conversation_id, "CLI process killed after abort");
    }

    // Send completion if we haven't yet (e.g., abort or unexpected EOF)
    if !completion_sent && !accumulated_text.is_empty() {
        let _ = tx
            .send(BackendEvent::AgentComplete {
                conversation_id: conversation_id.clone(),
                message: AgentMessage::text("assistant", &accumulated_text),
            })
            .await;
    }

    // Wait for CLI to exit
    let status = child.wait().await.map_err(|e| {
        ProviderError::ApiError(format!("Failed to wait for Claude CLI: {}", e))
    })?;

    if !aborted && !status.success() {
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
        aborted = aborted,
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
