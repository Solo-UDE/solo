//! Task executor — Phase 3: worktree isolation + deny-list + review routing.
//!
//! Spawns an agent session for an `executor=Agent` task. When the task's
//! `agent_config.execution_location` is `Worktree`, a git worktree is created
//! before the session starts and the agent's cwd is scoped to it.
//!
//! Deny-list enforcement: every `agent:permission_request` is evaluated against
//! the global DEFAULT_DENY_LIST merged with per-task deny patterns. Matching
//! commands are responded to with `PermissionDecision::Deny` via the existing
//! SessionManager API (enforcing, not advisory).
//!
//! Review routing: when a worktree-mode run succeeds, `TaskReviewReady` is
//! emitted and the task status is set to `NeedsReview`. Diff summary is a
//! placeholder string; full git2 stats land in a follow-up.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use solo_protocol::{
    AgentPermissionMode, BackendEvent, ExecutionLocation, RunOutcome, Task, TaskStatus,
};
use solo_tasks::TaskStore;
use tauri::{AppHandle, Emitter as _, Listener as _, Manager as _};
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use crate::agent::{PermissionDecision, PermissionResponse, SessionConfig, SessionManager};

/// Maps active agent sessions to the task run they power.
#[derive(Default)]
pub struct ExecutorMap {
    inner: RwLock<HashMap<String, ActiveRun>>, // session_id → run info
}

#[derive(Clone)]
struct ActiveRun {
    task_id: String,
    run_id: String,
    /// Git worktree ID for this run (None = main workspace).
    worktree_id: Option<String>,
    /// Merged deny-list patterns (global + per-task).
    deny_patterns: Vec<String>,
}

impl ExecutorMap {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub async fn insert(
        &self,
        session_id: String,
        task_id: String,
        run_id: String,
        worktree_id: Option<String>,
        deny_patterns: Vec<String>,
    ) {
        self.inner.write().await.insert(
            session_id,
            ActiveRun { task_id, run_id, worktree_id, deny_patterns },
        );
    }

    pub async fn remove(&self, session_id: &str) -> Option<ActiveRun> {
        self.inner.write().await.remove(session_id)
    }

    pub async fn get(&self, session_id: &str) -> Option<ActiveRun> {
        self.inner.read().await.get(session_id).cloned()
    }

    pub async fn session_for_task(&self, task_id: &str) -> Option<String> {
        self.inner
            .read()
            .await
            .iter()
            .find(|(_, a)| a.task_id == task_id)
            .map(|(sid, _)| sid.clone())
    }
}

/// Create an isolated git worktree for a task run.
/// Branch pattern: `solo/task-<8 chars of task_id>-<8 chars of run_id>`
async fn create_worktree_for_run(
    app: &AppHandle,
    task_id: &str,
    run_id: &str,
) -> Result<(String, String), String> {
    let short = |s: &str| s.chars().take(8).collect::<String>();
    let branch = format!("solo/task-{}-{}", short(task_id), short(run_id));

    let wt_state = app.state::<crate::worktree_commands::WorktreeState>();
    let fs_state = app.state::<crate::fs_commands::FsState>();
    let stats = app.state::<crate::stats_commands::StatsState>();

    let request = solo_protocol::CreateWorktreeRequest {
        branch: branch.clone(),
        path: None,
        create_branch: true,
        base: None,
    };

    let info = crate::worktree_commands::worktree_create(
        request,
        app.clone(),
        wt_state,
        fs_state,
        stats,
    )
    .await?;

    // Return (worktree_id, worktree_path)
    Ok((info.id, info.path))
}

/// Extract the shell command string from a permission request's tool input,
/// for tools that run shell commands.
/// Build the first-message prompt sent to the agent when running a task.
/// Appends a markdown checklist when the task has subtasks, so the agent works
/// through them in order. Already-completed subtasks render as `[x]` so a
/// partial re-run does not redo them. The user still ticks subtasks manually
/// from the drawer; we do NOT auto-parse agent responses for completion claims.
fn build_agent_prompt(task: &Task) -> String {
    let description = if task.description.is_empty() {
        "(no description)"
    } else {
        task.description.as_str()
    };
    let mut prompt = format!(
        "TASK: {title}\n\n{description}\n",
        title = task.title,
        description = description,
    );
    if !task.subtasks.is_empty() {
        prompt.push_str(
            "\n## Checklist\n\
             Work through these subtasks in order.\n\n",
        );
        for s in &task.subtasks {
            let mark = if s.completed { "x" } else { " " };
            prompt.push_str(&format!(
                "- [{mark}] (id={id}) {title}\n",
                id = s.id,
                title = s.title,
            ));
        }
        prompt.push_str(
            "\n**Marking a subtask complete.** When you finish a subtask, output \
             this marker on its own line, substituting the subtask id from the \
             list above:\n\
             \n\
             `<subtask-done id=\"<id>\" />`\n\
             \n\
             Emit the marker immediately after you finish a subtask. You may \
             emit multiple markers in the same response if you finish several. \
             Markers referencing unknown ids are silently ignored, so only use \
             the ids shown above.\n\
             \n\
             Do NOT skip subtasks. Do NOT add new ones.\n",
        );
    }
    prompt.push_str("\n[Run this task. Report progress concisely.]");
    prompt
}

/// Extract subtask ids from `<subtask-done id="..." />` markers in a
/// serialized agent message. Tolerant of surrounding whitespace, quotes,
/// attribute ordering, and JSON-escaped strings (the listener feeds in
/// `message.to_string()`, so quotes may be `\"`).
fn parse_subtask_markers(serialized: &str) -> Vec<String> {
    let mut out = Vec::new();
    let pattern = "<subtask-done";
    let bytes = serialized.as_bytes();
    let mut i = 0;
    while let Some(rel) = serialized[i..].find(pattern) {
        let start = i + rel + pattern.len();
        // Find the closing `>` of this tag.
        let Some(end_rel) = serialized[start..].find('>') else { break; };
        let tag_inner = &serialized[start..start + end_rel];
        i = start + end_rel + 1;
        // Extract id="..." — accept both raw " and JSON-escaped \".
        if let Some(id) = extract_id_attr(tag_inner) {
            if !id.is_empty() {
                out.push(id);
            }
        }
        if i >= bytes.len() { break; }
    }
    out
}

fn extract_id_attr(tag_inner: &str) -> Option<String> {
    // Case-insensitive search for `id=` then read a quoted value (either
    // `"..."` or `\"...\"`). Simple state machine keeps us off a regex dep.
    let lower = tag_inner.to_ascii_lowercase();
    let at = lower.find("id=")?;
    let rest = &tag_inner[at + 3..];
    let bytes = rest.as_bytes();
    let mut idx = 0;
    // Optional backslash before the opening quote (JSON-escaped form).
    if idx < bytes.len() && bytes[idx] == b'\\' { idx += 1; }
    if idx >= bytes.len() || bytes[idx] != b'"' { return None; }
    idx += 1;
    let start = idx;
    while idx < bytes.len() {
        let b = bytes[idx];
        if b == b'\\' && idx + 1 < bytes.len() && bytes[idx + 1] == b'"' {
            // End of a JSON-escaped value.
            return Some(rest[start..idx].to_string());
        }
        if b == b'"' {
            return Some(rest[start..idx].to_string());
        }
        idx += 1;
    }
    None
}

fn extract_command(tool_name: &str, tool_input: &Value) -> Option<String> {
    match tool_name {
        "Bash" | "bash" | "shell" | "Shell" => {
            tool_input
                .get("command")
                .and_then(|v| v.as_str())
                .map(ToString::to_string)
        }
        _ => None,
    }
}

/// Spawn an agent session for a task. Returns the session_id.
///
/// Does NOT await completion — callers use the event stream to observe lifecycle.
pub async fn spawn_agent_for_task(
    app: &AppHandle,
    store: Arc<TaskStore>,
    executor_map: Arc<ExecutorMap>,
    session_manager: Arc<SessionManager>,
    task_id: String,
) -> Result<String, String> {
    // Load the task
    let task = store.get(&task_id).map_err(|e| e.to_string())?;

    // Resolve agent config
    let cfg = task.agent_config.clone().unwrap_or_default();

    // Enforce bypass-requires-worktree constraint
    if cfg.permission_mode == AgentPermissionMode::Bypass
        && cfg.execution_location != ExecutionLocation::Worktree
    {
        return Err(
            "bypass permission mode requires execution_location = worktree".into(),
        );
    }

    // Create a run row first so we have the run_id for the worktree branch name
    let run_id = store.create_run(&task_id).map_err(|e| e.to_string())?;

    // Create worktree if requested
    let (worktree_id, worktree_path) =
        if cfg.execution_location == ExecutionLocation::Worktree {
            let (id, path) = create_worktree_for_run(app, &task.id, &run_id).await?;
            // Record worktree on the run row
            if let Err(e) = store.record_worktree_for_run(&run_id, &id) {
                warn!(error = %e, "record_worktree_for_run failed (non-fatal)");
            }
            (Some(id), Some(path))
        } else {
            (None, None)
        };

    // Build the prompt for the agent
    let prompt = build_agent_prompt(&task);

    // Create the agent session (UUID)
    let session_id = uuid::Uuid::new_v4().to_string();

    // Build session config — thread the task's AgentConfig through to the
    // bridge so the LLM actually honors per-ticket model/provider/skills/
    // permission-mode preferences. Without this, the bridge uses global
    // defaults regardless of what the ticket asked for.
    let session_config = Some(SessionConfig {
        cwd: worktree_path.clone(),
        provider: cfg.provider.clone(),
        model: cfg.model.clone(),
        // Skill allow-list → bridge's allowed_tools.
        allowed_tools: cfg.skills.clone(),
        // Permission-mode hints: accept_enabled for AcceptEdits/Bypass,
        // plan_enabled for Plan. Bypass also implies accept-all; deny-list
        // enforcement happens in the listener regardless.
        accept_enabled: Some(matches!(
            cfg.permission_mode,
            AgentPermissionMode::AcceptEdits | AgentPermissionMode::Bypass
        )),
        plan_enabled: Some(cfg.permission_mode == AgentPermissionMode::Plan),
        ..Default::default()
    });

    session_manager
        .create_session(&session_id, session_config)
        .map_err(|e| format!("agent create_session failed: {e}"))?;
    session_manager
        .send_message(&session_id, &prompt, None)
        .map_err(|e| format!("agent send_message failed: {e}"))?;

    // Flip task to Running
    store
        .update(
            &task_id,
            solo_protocol::TaskPatch {
                status: Some(TaskStatus::Running),
                ..Default::default()
            },
        )
        .map_err(|e| e.to_string())?;

    // Merge deny-lists: global defaults + per-task patterns
    let all_deny: Vec<String> = solo_tasks::DEFAULT_DENY_LIST
        .iter()
        .map(|s| (*s).to_string())
        .chain(cfg.deny_list.iter().cloned())
        .collect();

    // Register the mapping
    executor_map
        .insert(
            session_id.clone(),
            task_id.clone(),
            run_id.clone(),
            worktree_id.clone(),
            all_deny,
        )
        .await;

    // Emit events to the frontend
    let _ = app.emit(
        "backend-event",
        BackendEvent::TaskRunStarted {
            task_id: task_id.clone(),
            run_id: run_id.clone(),
        },
    );
    let _ = app.emit(
        "backend-event",
        BackendEvent::TasksChanged { task_ids: vec![task_id] },
    );

    info!(session_id, run_id, worktree = ?worktree_id, "agent task run started");
    Ok(session_id)
}

/// Install global listeners on the app that intercept `agent:message` and
/// `agent:permission_request` events. Called once at app startup.
pub fn install_agent_listeners(
    app: &AppHandle,
    store: Arc<TaskStore>,
    executor_map: Arc<ExecutorMap>,
    session_manager: Arc<SessionManager>,
) {
    let app_ = app.clone();
    let store_ = store.clone();
    let map_ = executor_map.clone();

    // -------------------------------------------------------------------------
    // agent:message — lifecycle events (result, error, progress)
    // -------------------------------------------------------------------------
    app.listen("agent:message", move |event| {
        let payload: Value = match serde_json::from_str(event.payload()) {
            Ok(v) => v,
            Err(e) => {
                debug!(error = %e, "agent:message non-JSON payload");
                return;
            }
        };
        let session_id = match payload.get("sessionId").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => return,
        };
        let message = match payload.get("message") {
            Some(m) => m.clone(),
            None => return,
        };
        let message_type = message
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let app__ = app_.clone();
        let store__ = store_.clone();
        let map__ = map_.clone();

        tauri::async_runtime::spawn(async move {
            if let Some(run) = map__.get(&session_id).await {
                // Task-owned session — existing lifecycle handling.
                match message_type.as_str() {
                    "assistant" | "tool_use" | "tool_result" => {
                        let serialized = message.to_string();
                        // Scan for `<subtask-done id="..." />` markers and
                        // auto-tick. Unknown ids silently fail at the store
                        // boundary — safe default.
                        let marker_ids = parse_subtask_markers(&serialized);
                        if !marker_ids.is_empty() {
                            let mut changed = false;
                            for sid in &marker_ids {
                                match store__.subtask_toggle(&run.task_id, sid, true) {
                                    Ok(_) => { changed = true; }
                                    Err(e) => debug!(
                                        subtask_id = %sid,
                                        error = %e,
                                        "subtask marker ignored"
                                    ),
                                }
                            }
                            if changed {
                                let _ = app__.emit(
                                    "backend-event",
                                    BackendEvent::TasksChanged {
                                        task_ids: vec![run.task_id.clone()],
                                    },
                                );
                            }
                        }

                        let summary = truncate(&serialized, 200);
                        let _ = store__.update_run_summary(&run.run_id, &summary);
                        let _ = app__.emit(
                            "backend-event",
                            BackendEvent::TaskRunProgress {
                                task_id: run.task_id.clone(),
                                run_id: run.run_id.clone(),
                                summary,
                            },
                        );
                    }
                    "result" => {
                        let fs = final_summary(&message);
                        finalize_run(
                            &app__,
                            &store__,
                            &map__,
                            &session_id,
                            RunOutcome::Succeeded,
                            Some(&fs),
                        )
                        .await;
                    }
                    "error" => {
                        let msg = message
                            .get("message")
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string);
                        finalize_run(
                            &app__,
                            &store__,
                            &map__,
                            &session_id,
                            RunOutcome::Failed,
                            msg.as_deref(),
                        )
                        .await;
                    }
                    _ => {}
                }
            } else if message_type == "result" {
                // Non-task session ended — check proactive gate and maybe fire planner.
                let gate = app__
                    .state::<std::sync::Arc<crate::task_planner::ProactiveGate>>()
                    .inner()
                    .clone();
                if gate.try_fire().await {
                    tracing::info!(session_id, "proactive planner: firing after non-task session-end");
                    let _ = app__.emit(
                        "backend-event",
                        serde_json::json!({"type": "planner:proactive_triggered"}),
                    );
                    let app_cloned = app__.clone();
                    tauri::async_runtime::spawn(async move {
                        match crate::task_commands::get_store_for_setup(&app_cloned).await {
                            Ok(store) => {
                                let sess_mgr = app_cloned
                                    .state::<std::sync::Arc<crate::agent::SessionManager>>()
                                    .inner()
                                    .clone();
                                let _ = crate::task_planner::plan_from_goal(
                                    &app_cloned,
                                    store,
                                    sess_mgr,
                                    "Suggest 3 follow-up tasks based on my recent work."
                                        .to_string(),
                                    vec![],
                                )
                                .await;
                            }
                            Err(e) => {
                                tracing::warn!(error = %e, "proactive planner: could not open task store");
                            }
                        }
                    });
                } else {
                    tracing::debug!(session_id, "proactive planner: rate-limited");
                }
            }
        });
    });

    // -------------------------------------------------------------------------
    // agent:permission_request — deny-list enforcement
    // -------------------------------------------------------------------------
    let app_p = app.clone();
    let map_p = executor_map.clone();
    let sm_p = session_manager.clone();

    app.listen("agent:permission_request", move |event| {
        let Ok(payload): Result<Value, _> = serde_json::from_str(event.payload()) else {
            return;
        };
        let Some(session_id) = payload
            .get("sessionId")
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
        else {
            return;
        };
        let request_id = payload
            .get("requestId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let tool_name = payload
            .get("toolName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let tool_input = payload.get("toolInput").cloned().unwrap_or(Value::Null);

        let app__ = app_p.clone();
        let map__ = map_p.clone();
        let sm__ = sm_p.clone();

        tauri::async_runtime::spawn(async move {
            let Some(run) = map__.get(&session_id).await else {
                return;
            };

            // Only evaluate shell-like tools
            let Some(cmd) = extract_command(&tool_name, &tool_input) else {
                return;
            };

            let patterns: Vec<&str> =
                run.deny_patterns.iter().map(String::as_str).collect();

            if let Some(matched) = solo_tasks::is_denied(&cmd, &patterns) {
                warn!(
                    cmd = %cmd,
                    matched = %matched,
                    task_id = %run.task_id,
                    "deny-list blocked command — sending Deny response"
                );

                let response = PermissionResponse {
                    request_id: request_id.clone(),
                    decision: PermissionDecision::Deny,
                    always: false,
                    answers: None,
                };

                if let Err(e) = sm__.respond_to_permission(response) {
                    warn!(error = %e, "failed to send deny permission response");
                    // Emit advisory signal so the frontend can surface it
                    let _ = app__.emit(
                        "task:permission_deny",
                        serde_json::json!({
                            "session_id": session_id,
                            "request_id": request_id,
                            "reason": format!("blocked by deny-list: {matched}"),
                        }),
                    );
                }
            }
        });
    });
}

async fn finalize_run(
    app: &AppHandle,
    store: &Arc<TaskStore>,
    map: &Arc<ExecutorMap>,
    session_id: &str,
    outcome: RunOutcome,
    summary: Option<&str>,
) {
    let Some(run) = map.remove(session_id).await else {
        warn!(session_id, "finalize_run called but no active mapping");
        return;
    };

    if let Err(e) = store.end_run(&run.run_id, outcome, summary) {
        error!(error = %e, "end_run failed");
    }

    // Worktree-mode successful runs → emit TaskReviewReady + set NeedsReview.
    // Diff summary is a placeholder; full git2 stats land in a follow-up.
    if run.worktree_id.is_some() && outcome == RunOutcome::Succeeded {
        let wid = run.worktree_id.as_deref().unwrap_or("").to_string();

        let _ = app.emit(
            "backend-event",
            BackendEvent::TaskReviewReady {
                task_id: run.task_id.clone(),
                run_id: run.run_id.clone(),
                worktree_id: wid,
                diff_summary: "(computing…)".into(),
            },
        );

        let patch = solo_protocol::TaskPatch {
            status: Some(TaskStatus::NeedsReview),
            ..Default::default()
        };
        if let Err(e) = store.update(&run.task_id, patch) {
            error!(error = %e, "task status → NeedsReview failed");
        }

        let _ = app.emit(
            "backend-event",
            BackendEvent::TasksChanged { task_ids: vec![run.task_id.clone()] },
        );

        info!(session_id, "task run routed to NeedsReview (worktree mode)");
        return; // Skip normal outcome→status mapping
    }

    // Normal (non-worktree) path: Done / Failed
    let new_status = match outcome {
        RunOutcome::Succeeded => TaskStatus::Done,
        RunOutcome::Failed | RunOutcome::Cancelled => TaskStatus::Failed,
        RunOutcome::Running => TaskStatus::Running,
    };
    let patch = solo_protocol::TaskPatch {
        status: Some(new_status),
        ..Default::default()
    };
    if let Err(e) = store.update(&run.task_id, patch) {
        error!(error = %e, "task status update failed");
    }

    let _ = app.emit(
        "backend-event",
        BackendEvent::TaskRunEnded {
            task_id: run.task_id.clone(),
            run_id: run.run_id.clone(),
            outcome,
            summary: summary.map(ToString::to_string),
        },
    );
    let _ = app.emit(
        "backend-event",
        BackendEvent::TasksChanged { task_ids: vec![run.task_id] },
    );

    info!(session_id, outcome = ?outcome, "task run finalized");
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

fn final_summary(message: &Value) -> String {
    message
        .get("result")
        .and_then(|v| v.as_str())
        .map(|s| truncate(s, 500))
        .unwrap_or_else(|| "(no summary)".into())
}

/// Cancel a running task — end the agent session and mark the run cancelled.
pub async fn cancel_task(
    app: &AppHandle,
    store: Arc<TaskStore>,
    executor_map: Arc<ExecutorMap>,
    session_manager: Arc<SessionManager>,
    task_id: String,
) -> Result<(), String> {
    let Some(session_id) = executor_map.session_for_task(&task_id).await else {
        return Err("task is not running".into());
    };
    // Best-effort session shutdown
    if let Err(e) = session_manager.delete_session(&session_id) {
        warn!(error = %e, session_id, "delete_session failed on cancel");
    }
    // Finalize locally
    finalize_run(
        app,
        &store,
        &executor_map,
        &session_id,
        RunOutcome::Cancelled,
        Some("cancelled by user"),
    )
    .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_marker_plain() {
        let ids = parse_subtask_markers("text before <subtask-done id=\"abc-123\" /> text after");
        assert_eq!(ids, vec!["abc-123"]);
    }

    #[test]
    fn parse_marker_json_escaped() {
        // Message stringified via serde_json::Value::to_string() will use \" inside string fields.
        let s = r#"{"text":"I did it. <subtask-done id=\"uid-42\" />"}"#;
        let ids = parse_subtask_markers(s);
        assert_eq!(ids, vec!["uid-42"]);
    }

    #[test]
    fn parse_marker_multiple() {
        let s = "<subtask-done id=\"a\" /> middle <subtask-done id=\"b\" />";
        let ids = parse_subtask_markers(s);
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn parse_marker_missing_id_returns_empty() {
        let ids = parse_subtask_markers("<subtask-done />");
        assert!(ids.is_empty());
    }

    #[test]
    fn parse_marker_no_marker_returns_empty() {
        let ids = parse_subtask_markers("just some text");
        assert!(ids.is_empty());
    }

    #[test]
    fn parse_marker_case_insensitive_attr() {
        let ids = parse_subtask_markers("<subtask-done ID=\"upper\" />");
        assert_eq!(ids, vec!["upper"]);
    }

    #[test]
    fn build_prompt_includes_marker_instruction_when_subtasks_present() {
        let task = solo_protocol::Task {
            id: "t1".into(),
            title: "do stuff".into(),
            description: "d".into(),
            status: solo_protocol::TaskStatus::Queued,
            executor: solo_protocol::Executor::Agent,
            priority: solo_protocol::TaskPriority::Medium,
            created_at: 0,
            updated_at: 0,
            agent_config: None,
            schedule: None,
            context_anchors: Vec::new(),
            runs: Vec::new(),
            last_error: None,
            catch_up_on_launch: false,
            origin: solo_protocol::TaskOrigin::Manual,
            subtasks: vec![solo_protocol::Subtask {
                id: "sub-1".into(),
                title: "first".into(),
                completed: false,
                created_at: 0,
                completed_at: None,
            }],
            label_ids: Vec::new(),
            project_id: None,
            cycle_id: None,
        };
        let prompt = build_agent_prompt(&task);
        assert!(prompt.contains("## Checklist"));
        assert!(prompt.contains("(id=sub-1)"));
        assert!(prompt.contains("<subtask-done"));
    }

    #[test]
    fn build_prompt_references_marker_ids_in_checklist() {
        // Regression: ensure each checklist line contains the subtask id so
        // the agent can cite it back in <subtask-done id="..." /> markers.
        let task = solo_protocol::Task {
            id: "t1".into(),
            title: "multi".into(),
            description: "d".into(),
            status: solo_protocol::TaskStatus::Queued,
            executor: solo_protocol::Executor::Agent,
            priority: solo_protocol::TaskPriority::Medium,
            created_at: 0, updated_at: 0,
            agent_config: None, schedule: None,
            context_anchors: Vec::new(), runs: Vec::new(),
            last_error: None, catch_up_on_launch: false,
            origin: solo_protocol::TaskOrigin::Manual,
            subtasks: vec![
                solo_protocol::Subtask {
                    id: "alpha".into(), title: "a".into(), completed: true,
                    created_at: 0, completed_at: Some(1),
                },
                solo_protocol::Subtask {
                    id: "beta".into(), title: "b".into(), completed: false,
                    created_at: 0, completed_at: None,
                },
            ],
            label_ids: Vec::new(), project_id: None, cycle_id: None,
        };
        let prompt = build_agent_prompt(&task);
        assert!(prompt.contains("(id=alpha)"));
        assert!(prompt.contains("(id=beta)"));
        assert!(prompt.contains("- [x]"), "completed subtask renders with [x]");
        assert!(prompt.contains("- [ ]"), "incomplete subtask renders with [ ]");
    }

    #[test]
    fn build_prompt_skips_checklist_when_no_subtasks() {
        let task = solo_protocol::Task {
            id: "t1".into(),
            title: "do stuff".into(),
            description: "d".into(),
            status: solo_protocol::TaskStatus::Queued,
            executor: solo_protocol::Executor::Agent,
            priority: solo_protocol::TaskPriority::Medium,
            created_at: 0,
            updated_at: 0,
            agent_config: None,
            schedule: None,
            context_anchors: Vec::new(),
            runs: Vec::new(),
            last_error: None,
            catch_up_on_launch: false,
            origin: solo_protocol::TaskOrigin::Manual,
            subtasks: Vec::new(),
            label_ids: Vec::new(),
            project_id: None,
            cycle_id: None,
        };
        let prompt = build_agent_prompt(&task);
        assert!(!prompt.contains("## Checklist"));
        assert!(!prompt.contains("<subtask-done"));
    }
}
