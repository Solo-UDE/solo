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
    AgentPermissionMode, BackendEvent, ExecutionLocation, RunOutcome, TaskStatus,
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
    let prompt = format!(
        "TASK: {title}\n\n{description}\n\n[Run this task. Report progress concisely.]",
        title = task.title,
        description = if task.description.is_empty() {
            "(no description)"
        } else {
            &task.description
        },
    );

    // Create the agent session (UUID)
    let session_id = uuid::Uuid::new_v4().to_string();

    // Build session config — set cwd to worktree path when available
    let session_config = if let Some(ref path) = worktree_path {
        Some(SessionConfig {
            cwd: Some(path.clone()),
            ..Default::default()
        })
    } else {
        None
    };

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
            let Some(run) = map__.get(&session_id).await else { return };

            match message_type.as_str() {
                "assistant" | "tool_use" | "tool_result" => {
                    let summary = truncate(&message.to_string(), 200);
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
