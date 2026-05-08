//! Agent commands for Claude Agent SDK integration
//!
//! These commands interact with the Node.js sidecar via IPC.
//! The bridge handles all agent logic (agentic loop, tool execution,
//! permissions, streaming) while Rust is a thin process manager.

use std::fmt::Display;
use std::fs;
use std::path::PathBuf;
use std::result;
use std::sync::Arc;

use tauri::{AppHandle, Emitter as _, State};

use crate::agent::{
    AttachmentContentBlock, PermissionDecision, PermissionResponse, SessionConfig,
    SessionCredentials, SessionManager, SessionMode, VaultAuthConfig,
};
use crate::fs_commands::FsState;
use crate::plugins_commands::PluginsState;
use crate::provider_commands::ProviderAuthState;
use git2::{DiffOptions, Repository};
use serde_json::{Map as JsonMap, Value as JsonValue};
use solo_auth::provider::ProviderType;
use solo_core::settings as settings_io;
use solo_plugins::{list_plugins, LoaderConfig, PluginRecord};

/// Result type for agent commands
type Result<T> = result::Result<T, String>;

/// Convert bridge error to string
fn to_error<E: Display>(e: E) -> String {
    e.to_string()
}

fn normalize_mcp_servers(value: JsonValue, source: &str) -> Result<JsonMap<String, JsonValue>> {
    if let Some(servers) = value.get("mcpServers").and_then(JsonValue::as_object) {
        return Ok(servers.clone());
    }

    if let Some(servers) = value.as_object() {
        return Ok(servers.clone());
    }

    Err(format!(
        "{source} must be a JSON object or contain a top-level mcpServers object"
    ))
}

fn prefixed_plugin_mcp_name(record: &PluginRecord, name: &str) -> String {
    format!(
        "plugin__{}__{}__{}",
        record.id.marketplace, record.id.name, name
    )
}

fn add_mcp_servers(
    target: &mut JsonMap<String, JsonValue>,
    servers: JsonMap<String, JsonValue>,
    conflict_prefix: impl Fn(&str) -> String,
) {
    for (name, config) in servers {
        if target.contains_key(&name) {
            target.insert(conflict_prefix(&name), config);
        } else {
            target.insert(name, config);
        }
    }
}

fn collect_enabled_plugin_mcp_servers(
    cwd: &str,
    plugins_state: &PluginsState,
) -> Result<Option<JsonValue>> {
    let workspace = PathBuf::from(cwd);
    let config = settings_io::load_plugins_config(&workspace).unwrap_or_default();
    let solo_home = plugins_state.solo_home();
    let claude_plugins_dir = {
        let dir = plugins_state.claude_plugins_dir();
        dir.exists().then_some(dir)
    };
    let codex_cache_dir = {
        let dir = plugins_state.codex_cache_dir();
        dir.exists().then_some(dir)
    };

    let outcome = list_plugins(LoaderConfig {
        solo_home: &solo_home,
        claude_plugins_dir,
        codex_cache_dir,
        adapter_claude_plugins: config.adapter_claude_plugins,
        adapter_codex_user: config.adapter_codex_user,
    });

    let mut merged = JsonMap::new();
    for record in outcome.plugins.into_iter().filter(|record| record.enabled) {
        let Some(mcp_path) = record
            .manifest
            .as_ref()
            .and_then(|manifest| manifest.paths.mcp_servers.as_ref())
        else {
            continue;
        };

        let source = format!(
            "plugin MCP config {} ({})",
            record.id.as_key(),
            mcp_path.as_path().display()
        );
        let raw = fs::read_to_string(mcp_path.as_path())
            .map_err(|err| format!("failed to read {source}: {err}"))?;
        let value: JsonValue =
            serde_json::from_str(&raw).map_err(|err| format!("failed to parse {source}: {err}"))?;
        let servers = normalize_mcp_servers(value, &source)?;
        add_mcp_servers(&mut merged, servers, |name| {
            prefixed_plugin_mcp_name(&record, name)
        });
    }

    Ok((!merged.is_empty()).then_some(JsonValue::Object(merged)))
}

fn merge_session_mcp_servers(
    plugin_servers: Option<JsonValue>,
    session_servers: Option<JsonValue>,
) -> Result<Option<JsonValue>> {
    let mut merged = JsonMap::new();

    if let Some(plugin_servers) = plugin_servers {
        add_mcp_servers(
            &mut merged,
            normalize_mcp_servers(plugin_servers, "plugin MCP servers")?,
            |name| format!("plugin__{name}"),
        );
    }

    if let Some(session_servers) = session_servers {
        let servers = normalize_mcp_servers(session_servers, "session mcpServers")?;
        for (name, config) in servers {
            merged.insert(name, config);
        }
    }

    Ok((!merged.is_empty()).then_some(JsonValue::Object(merged)))
}

async fn build_vault_auth_config(
    auth_state: &State<'_, crate::auth_commands::AuthState>,
    provider_auth: &State<'_, ProviderAuthState>,
) -> VaultAuthConfig {
    VaultAuthConfig {
        endpoint: Some(crate::desktop_config::vault_api_endpoint().to_string()),
        id_token: crate::auth_commands::fresh_id_token_snapshot(auth_state, provider_auth).await,
        retrieval_source: Some("hybrid".to_string()),
    }
}

// ============================================================================
// Session Management Commands
// ============================================================================

/// Create a new agent session.
///
/// Resolves the active provider + credentials from ProviderAuthState and
/// attaches them to the SessionConfig before forwarding to the sidecar.
/// Backward-compatible: if the caller passed provider/credentials in
/// `config` already, those take precedence.
/// Internal helper — create a session and send the first prompt.
///
/// Generates a fresh UUID for the session, registers it with the bridge,
/// and immediately sends `prompt` as the opening user message. Returns
/// the new session id so callers (e.g. the voice dispatch path) can store
/// it without depending on Tauri `State` extractors.
pub(crate) async fn create_session_internal(
    app: &AppHandle,
    _title: String,
    prompt: String,
) -> Result<String> {
    use tauri::Manager as _;
    let session_manager = app.state::<Arc<SessionManager>>();
    let plugins_state = app.state::<PluginsState>();
    let stats = app.state::<crate::stats_commands::StatsState>();

    let session_id = uuid::Uuid::new_v4().to_string();
    let cwd = std::env::current_dir()
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".to_string());
    let config = SessionConfig {
        provider: Some("anthropic".to_string()),
        cwd: Some(cwd.clone()),
        mcp_servers: collect_enabled_plugin_mcp_servers(&cwd, &plugins_state)?,
        ..Default::default()
    };
    session_manager
        .create_session(&session_id, Some(config))
        .map_err(to_error)?;
    stats.record(solo_stats::StatsEvent::SessionCreated).await;

    session_manager
        .send_message(&session_id, &prompt, None, None)
        .map_err(to_error)?;
    stats.record(solo_stats::StatsEvent::MessageSent).await;

    Ok(session_id)
}

/// Create a new agent session
#[tauri::command]
pub async fn agent_create_session(
    session_id: String,
    config: Option<SessionConfig>,
    state: State<'_, Arc<SessionManager>>,
    auth_state: State<'_, crate::auth_commands::AuthState>,
    provider_state: State<'_, ProviderAuthState>,
    plugins_state: State<'_, PluginsState>,
    stats: State<'_, crate::stats_commands::StatsState>,
) -> Result<()> {
    let mut config = config.unwrap_or_default();
    config.vault_auth = Some(build_vault_auth_config(&auth_state, &provider_state).await);

    // If the caller didn't specify a provider, use the currently-active one.
    if config.provider.is_none() {
        let active = provider_state.active_provider.read().await;
        config.provider = Some(active.as_str().to_string());
    }

    let provider_str_for_mode = config.provider.as_deref().unwrap_or("anthropic");
    let requested_agent_mode =
        config.session_mode.unwrap_or(SessionMode::Agent) == SessionMode::Agent;
    let provider_allows_agent_mode = config
        .provider_capabilities
        .as_ref()
        .map(|capabilities| capabilities.agent)
        .unwrap_or(provider_str_for_mode == "anthropic");
    if requested_agent_mode && !provider_allows_agent_mode {
        return Err(format!(
            "{provider_str_for_mode} does not support Solo agent mode with the selected model"
        ));
    }

    // Resolve credentials iff the caller didn't already pass them.
    if config.credentials.is_none() {
        let provider_str = config.provider.as_deref().unwrap_or("anthropic");
        let provider_type = ProviderType::from_str(provider_str)
            .ok_or_else(|| format!("unknown provider {:?}", provider_str))?;

        match provider_type {
            ProviderType::OpenAI | ProviderType::Gemini => {
                // OpenAI: prefer OAuth, fall back to API key/env.
                // Gemini: API key/env only.
                let resolved = provider_state
                    .credentials
                    .get_credentials_with_source(provider_type)
                    .await
                    .map_err(to_error)?;

                if let Some(info) = resolved {
                    use solo_auth::credentials::CredentialSource as CS;
                    config.credentials = Some(
                        if provider_type == ProviderType::OpenAI
                            && matches!(info.source, CS::SoloOAuth | CS::CodexOAuthFile)
                        {
                            let account_id = provider_state
                                .credentials
                                .get_openai_account_id()
                                .await
                                .map_err(to_error)?;
                            SessionCredentials::OAuth {
                                token: info.api_key,
                                account_id,
                            }
                        } else {
                            SessionCredentials::ApiKey {
                                token: info.api_key,
                            }
                        },
                    );
                } else {
                    return Err(format!(
                        "No credentials configured for {}",
                        provider_type.as_str()
                    ));
                }
            }
            ProviderType::Anthropic => {
                // For Anthropic we leave credentials unset — the sidecar
                // has its own ClaudeCredentials resolver (file, keychain,
                // env) that works well and we don't want to break it.
            }
        }
    }

    if provider_str_for_mode == "anthropic" {
        let cwd = config
            .cwd
            .clone()
            .or_else(|| {
                std::env::current_dir()
                    .ok()
                    .map(|path| path.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| ".".to_string());
        let plugin_mcp_servers = collect_enabled_plugin_mcp_servers(&cwd, &plugins_state)?;
        config.mcp_servers = merge_session_mcp_servers(plugin_mcp_servers, config.mcp_servers)?;
    }

    state
        .create_session(&session_id, Some(config))
        .map_err(to_error)?;
    stats.record(solo_stats::StatsEvent::SessionCreated).await;
    Ok(())
}

/// Delete an agent session
#[tauri::command]
pub async fn agent_delete_session(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state.delete_session(&session_id).map_err(to_error)
}

/// Send a message to an agent session
#[tauri::command]
pub async fn agent_send_message(
    session_id: String,
    message: String,
    attachments: Option<Vec<AttachmentContentBlock>>,
    state: State<'_, Arc<SessionManager>>,
    auth_state: State<'_, crate::auth_commands::AuthState>,
    provider_state: State<'_, ProviderAuthState>,
    stats: State<'_, crate::stats_commands::StatsState>,
) -> Result<()> {
    let vault_auth = Some(build_vault_auth_config(&auth_state, &provider_state).await);
    state
        .send_message(&session_id, &message, attachments, vault_auth)
        .map_err(to_error)?;
    stats.record(solo_stats::StatsEvent::MessageSent).await;
    Ok(())
}

/// Interrupt the current agent execution
#[tauri::command]
pub async fn agent_interrupt(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state.interrupt(&session_id).map_err(to_error)
}

/// Check if a session is ready
#[tauri::command]
pub async fn agent_is_session_ready(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<bool> {
    state.is_session_ready(&session_id).map_err(to_error)
}

/// Get the SDK session ID
#[tauri::command]
pub async fn agent_get_sdk_session_id(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<Option<String>> {
    state.get_sdk_session_id(&session_id).map_err(to_error)
}

// ============================================================================
// Permission Commands
// ============================================================================

/// Respond to a permission request
#[tauri::command]
pub async fn agent_respond_permission(
    request_id: String,
    decision: String,
    always: bool,
    answers: Option<hashbrown::HashMap<String, String>>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    let decision = match decision.as_str() {
        "approve" => PermissionDecision::Approve,
        "deny" => PermissionDecision::Deny,
        _ => return Err("Invalid decision: must be 'approve' or 'deny'".to_owned()),
    };

    let response = PermissionResponse {
        request_id,
        decision,
        always,
        answers,
    };

    state.respond_to_permission(response).map_err(to_error)
}

// ============================================================================
// Mode Commands
// ============================================================================

/// Set thinking mode for a session
#[tauri::command]
pub async fn agent_set_thinking_mode(
    session_id: String,
    enabled: bool,
    max_tokens: Option<u32>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state
        .set_thinking_mode(&session_id, enabled, max_tokens)
        .map_err(to_error)
}

/// Get thinking mode for a session
#[tauri::command]
pub async fn agent_get_thinking_mode(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<bool> {
    state.get_thinking_mode(&session_id).map_err(to_error)
}

/// Set model for a session
#[tauri::command]
pub async fn agent_set_model(
    session_id: String,
    model: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state.set_model(&session_id, model).map_err(to_error)
}

/// Set plan mode for a session
#[tauri::command]
pub async fn agent_set_plan_mode(
    session_id: String,
    enabled: bool,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state.set_plan_mode(&session_id, enabled).map_err(to_error)
}

/// Get plan mode for a session
#[tauri::command]
pub async fn agent_get_plan_mode(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<bool> {
    state.get_plan_mode(&session_id).map_err(to_error)
}

/// Set accept mode for a session
#[tauri::command]
pub async fn agent_set_accept_mode(
    session_id: String,
    enabled: bool,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state
        .set_accept_mode(&session_id, enabled)
        .map_err(to_error)
}

/// Get accept mode for a session
#[tauri::command]
pub async fn agent_get_accept_mode(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<bool> {
    state.get_accept_mode(&session_id).map_err(to_error)
}

/// Enable/disable Debug mode for a session. Turning on triggers goal capture
/// on the next user prompt and a `session:goal_captured` event.
#[tauri::command]
pub async fn agent_set_debug_mode(
    session_id: String,
    enabled: bool,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state.set_debug_mode(&session_id, enabled).map_err(to_error)
}

/// Get Debug mode for a session.
#[tauri::command]
pub async fn agent_get_debug_mode(
    session_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<bool> {
    state.get_debug_mode(&session_id).map_err(to_error)
}

/// Set tool permission policy for a session
#[tauri::command]
pub async fn agent_set_tool_policy(
    session_id: String,
    mode: String,
    is_worktree_session: bool,
    state: State<'_, Arc<SessionManager>>,
) -> Result<()> {
    state
        .set_tool_policy(&session_id, &mode, is_worktree_session)
        .map_err(to_error)
}

// ============================================================================
// Commit Message Generation
// ============================================================================

/// Generate an AI commit message from staged changes
#[tauri::command]
pub async fn agent_generate_commit_message(
    fs_state: State<'_, FsState>,
    session_manager: State<'_, Arc<SessionManager>>,
    provider_state: State<'_, ProviderAuthState>,
) -> Result<String> {
    // Resolve the Anthropic API key so the bridge doesn't need its own credential logic
    let api_key = provider_state
        .credentials
        .get_credentials(ProviderType::Anthropic)
        .await
        .map_err(|e| e.to_string())?;

    let workspace = fs_state
        .workspace_root
        .read()
        .await
        .clone()
        .ok_or("No workspace open")?;

    // Gather staged diff via git2 (spawn_blocking because Repository is !Send)
    let diff_text = tokio::task::spawn_blocking(move || -> result::Result<String, String> {
        let repo = Repository::open(&workspace).map_err(|e| e.to_string())?;
        let head_tree = repo.head().ok().and_then(|r| r.peel_to_tree().ok());
        let mut opts = DiffOptions::new();
        let diff = repo
            .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
            .map_err(|e| e.to_string())?;

        let mut text = String::new();
        diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
            // Cap at 50 KB to avoid huge payloads
            if text.len() < 50_000 {
                if let Ok(content) = std::str::from_utf8(line.content()) {
                    let prefix = match line.origin() {
                        '+' => "+",
                        '-' => "-",
                        ' ' => " ",
                        _ => "",
                    };
                    text.push_str(prefix);
                    text.push_str(content);
                }
            }
            true
        })
        .map_err(|e| e.to_string())?;

        if text.is_empty() {
            return Err("No staged changes to generate a commit message from".to_owned());
        }
        Ok(text)
    })
    .await
    .map_err(|e| e.to_string())??;

    session_manager
        .generate_commit_message(&diff_text, api_key)
        .map_err(to_error)
}

/// Refine a voice transcript using LLM
#[tauri::command]
pub async fn agent_refine_transcript(
    transcript: String,
    context: Option<String>,
    session_manager: State<'_, Arc<SessionManager>>,
    provider_state: State<'_, ProviderAuthState>,
) -> Result<String> {
    let api_key = provider_state
        .credentials
        .get_credentials(ProviderType::Anthropic)
        .await
        .map_err(|e| e.to_string())?;

    session_manager
        .refine_transcript(&transcript, context, api_key)
        .map_err(to_error)
}

// ============================================================================
// Log Formatting Helpers
// ============================================================================

/// Format key-value pairs as aligned columns for log output
fn fmt_kv(pairs: &[(&str, &str)]) -> String {
    let max_key = pairs.iter().map(|(k, _)| k.len()).max().unwrap_or(0);
    pairs
        .iter()
        .map(|(k, v)| format!("  {:<width$} : {}", k, v, width = max_key))
        .collect::<Vec<_>>()
        .join("\n")
}

#[tauri::command]
pub async fn agent_generate_session_title(
    user_message: String,
    assistant_message: String,
    session_manager: State<'_, Arc<SessionManager>>,
    provider_state: State<'_, ProviderAuthState>,
) -> Result<String> {
    let api_key = provider_state
        .credentials
        .get_credentials(ProviderType::Anthropic)
        .await
        .map_err(|e| e.to_string())?;

    session_manager
        .generate_session_title(&user_message, &assistant_message, api_key)
        .map_err(to_error)
}

// ============================================================================
// Event Wiring
// ============================================================================

/// Wire up event callbacks to emit Tauri events
pub fn setup_event_callbacks(app: &AppHandle, session_manager: &Arc<SessionManager>) {
    use crate::agent::protocol::BridgeEvent;

    let app_handle = app.clone();
    let session_mgr = Arc::clone(session_manager);

    session_manager.set_event_callback(Arc::new(move |event: BridgeEvent| match event {
        BridgeEvent::AgentMessage {
            session_id,
            message,
        } => {
            if tracing::enabled!(tracing::Level::DEBUG) {
                let type_str = format!("{:?}", message.message_type);
                let mut pairs: Vec<(&str, &str)> =
                    vec![("session", &session_id), ("type", &type_str)];
                let tool_name;
                let tool_id;
                let status_str;
                if let Some(ref meta) = message.metadata {
                    if let Some(ref name) = meta.tool_name {
                        tool_name = name.clone();
                        pairs.push(("tool", &tool_name));
                    }
                    if let Some(ref id) = meta.tool_id {
                        tool_id = id.clone();
                        pairs.push(("toolId", &tool_id));
                    }
                    if let Some(ref status) = meta.status {
                        status_str = format!("{:?}", status);
                        pairs.push(("status", &status_str));
                    }
                }
                tracing::debug!("[agent:emit] AgentMessage\n{}", fmt_kv(&pairs));
            }
            drop(app_handle.emit(
                "agent:message",
                serde_json::json!({
                    "sessionId": session_id,
                    "message": message,
                }),
            ));
        }
        BridgeEvent::PermissionRequest { request } => {
            if tracing::enabled!(tracing::Level::DEBUG) {
                tracing::debug!(
                    "[agent:emit] PermissionRequest\n{}",
                    fmt_kv(&[
                        ("session", &request.session_id),
                        ("tool", &request.tool_name),
                        ("requestId", &request.request_id),
                    ])
                );
            }
            drop(app_handle.emit(
                "agent:permission_request",
                serde_json::json!({
                    "sessionId": request.session_id,
                    "toolName": request.tool_name,
                    "toolInput": request.tool_input,
                    "requestId": request.request_id,
                }),
            ));
        }
        BridgeEvent::SessionInit { event: init_event } => {
            if tracing::enabled!(tracing::Level::DEBUG) {
                let resumed = init_event.is_resumed.to_string();
                let forked = init_event.is_forked.to_string();
                tracing::debug!(
                    "[agent:emit] SessionInit\n{}",
                    fmt_kv(&[
                        ("session", &init_event.session_id),
                        ("sdkSession", &init_event.sdk_session_id),
                        ("resumed", &resumed),
                        ("forked", &forked),
                    ])
                );
            }
            drop(app_handle.emit(
                "agent:session_init",
                serde_json::json!({
                    "sessionId": init_event.session_id,
                    "sdkSessionId": init_event.sdk_session_id,
                    "isResumed": init_event.is_resumed,
                    "isForked": init_event.is_forked,
                }),
            ));
        }
        BridgeEvent::PlanModeChanged {
            session_id,
            enabled,
        } => {
            if tracing::enabled!(tracing::Level::DEBUG) {
                let enabled_str = enabled.to_string();
                tracing::debug!(
                    "[agent:emit] PlanModeChanged\n{}",
                    fmt_kv(&[("session", &session_id), ("enabled", &enabled_str)])
                );
            }
            drop(app_handle.emit(
                "agent:plan_mode_changed",
                serde_json::json!({
                    "sessionId": session_id,
                    "enabled": enabled,
                }),
            ));
        }
        BridgeEvent::AcceptModeChanged {
            session_id,
            enabled,
        } => {
            if tracing::enabled!(tracing::Level::DEBUG) {
                let enabled_str = enabled.to_string();
                tracing::debug!(
                    "[agent:emit] AcceptModeChanged\n{}",
                    fmt_kv(&[("session", &session_id), ("enabled", &enabled_str)])
                );
            }
            drop(app_handle.emit(
                "agent:accept_mode_changed",
                serde_json::json!({
                    "sessionId": session_id,
                    "enabled": enabled,
                }),
            ));
        }
        BridgeEvent::DebugModeChanged {
            session_id,
            enabled,
        } => {
            if tracing::enabled!(tracing::Level::DEBUG) {
                let enabled_str = enabled.to_string();
                tracing::debug!(
                    "[agent:emit] DebugModeChanged\n{}",
                    fmt_kv(&[("session", &session_id), ("enabled", &enabled_str)])
                );
            }
            drop(app_handle.emit(
                "agent:debug_mode_changed",
                serde_json::json!({
                    "sessionId": session_id,
                    "enabled": enabled,
                }),
            ));
        }
        BridgeEvent::SessionGoalCaptured {
            session_id,
            goal,
            captured_at,
        } => {
            if tracing::enabled!(tracing::Level::DEBUG) {
                let captured_str = captured_at.to_string();
                tracing::debug!(
                    "[agent:emit] SessionGoalCaptured\n{}",
                    fmt_kv(&[("session", &session_id), ("capturedAt", &captured_str)])
                );
            }
            drop(app_handle.emit(
                "agent:session_goal_captured",
                serde_json::json!({
                    "sessionId": session_id,
                    "goal": goal,
                    "capturedAt": captured_at,
                }),
            ));
        }
        BridgeEvent::TurnStart {
            session_id,
            turn_number,
        } => {
            if tracing::enabled!(tracing::Level::DEBUG) {
                let turn_str = turn_number.to_string();
                tracing::debug!(
                    "[agent:emit] TurnStart\n{}",
                    fmt_kv(&[("session", &session_id), ("turn", &turn_str)])
                );
            }
            drop(app_handle.emit(
                "agent:turn_start",
                serde_json::json!({
                    "sessionId": session_id,
                    "turnNumber": turn_number,
                }),
            ));
        }
        BridgeEvent::ErrorEvent { error } => {
            tracing::debug!("[agent:emit] ErrorEvent\n  message : {}", error.message);

            // On sidecar crash, clear all tracked sessions — the bridge is dead
            if error.message.contains("exited unexpectedly") {
                session_mgr.clear_sessions_on_crash();
            }

            drop(app_handle.emit(
                "agent:error",
                serde_json::json!({
                    "message": error.message,
                    "stack": error.stack,
                }),
            ));
        }
        BridgeEvent::DebugEvent { session_id, event } => {
            if tracing::enabled!(tracing::Level::TRACE) {
                let data_str = serde_json::to_string_pretty(&event.data).unwrap_or_default();
                tracing::trace!(
                    "[agent:debug] {}::{}\n{}",
                    event.category,
                    event.name,
                    fmt_kv(&[("session", &session_id), ("data", &data_str),])
                );
            }
            drop(app_handle.emit(
                "agent:debug",
                serde_json::json!({
                    "sessionId": session_id,
                    "event": event,
                }),
            ));
        }
        BridgeEvent::Ready => {
            tracing::debug!("[agent:emit] ready");
            drop(app_handle.emit("agent:ready", ()));
        }
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_wrapped_mcp_servers() {
        let servers = normalize_mcp_servers(
            json!({
                "mcpServers": {
                    "github": { "command": "node", "args": ["server.js"] }
                }
            }),
            "test",
        )
        .unwrap();

        assert_eq!(servers["github"]["command"], "node");
    }

    #[test]
    fn session_mcp_servers_override_plugin_conflicts() {
        let plugin = json!({
            "github": { "command": "plugin" },
            "vault": { "command": "vault" }
        });
        let session = json!({
            "mcpServers": {
                "github": { "command": "session" }
            }
        });

        let merged = merge_session_mcp_servers(Some(plugin), Some(session)).unwrap();
        let merged = merged.unwrap();

        assert_eq!(merged["github"]["command"], "session");
        assert_eq!(merged["vault"]["command"], "vault");
    }

    #[test]
    fn invalid_mcp_config_is_rejected() {
        let err = normalize_mcp_servers(json!(["not", "an", "object"]), "bad").unwrap_err();
        assert!(err.contains("mcpServers"));
    }
}
