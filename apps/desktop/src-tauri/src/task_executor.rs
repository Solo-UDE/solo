//! Task executor — Phase 2: main-workspace agent runs.
//!
//! Spawns an agent session for an `executor=Agent` task, tracks the
//! session→(task, run) mapping, and mutates the task store as session
//! events arrive. Worktree isolation + bypass mode land in Phase 3.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use solo_protocol::{BackendEvent, RunOutcome, TaskStatus};
use solo_tasks::TaskStore;
use tauri::{AppHandle, Emitter as _, Listener as _};
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use crate::agent::SessionManager;

/// Maps active agent sessions to the task run they power.
#[derive(Default)]
pub struct ExecutorMap {
    inner: RwLock<HashMap<String, ActiveRun>>, // session_id → run info
}

#[derive(Clone)]
struct ActiveRun {
    task_id: String,
    run_id: String,
}

impl ExecutorMap {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub async fn insert(&self, session_id: String, task_id: String, run_id: String) {
        self.inner.write().await.insert(session_id, ActiveRun { task_id, run_id });
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

    // Build the prompt for the agent
    let prompt = format!(
        "TASK: {title}\n\n{description}\n\n[Run this task. Report progress concisely.]",
        title = task.title,
        description = if task.description.is_empty() { "(no description)" } else { &task.description },
    );

    // Create the agent session (UUID) and send the first prompt
    let session_id = uuid::Uuid::new_v4().to_string();
    session_manager
        .create_session(&session_id, None)
        .map_err(|e| format!("agent create_session failed: {e}"))?;
    session_manager
        .send_message(&session_id, &prompt, None)
        .map_err(|e| format!("agent send_message failed: {e}"))?;

    // Record the run row
    let run_id = store.create_run(&task_id).map_err(|e| e.to_string())?;

    // Flip task to Running
    store
        .update(&task_id, solo_protocol::TaskPatch {
            status: Some(TaskStatus::Running),
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;

    // Register the mapping
    executor_map.insert(session_id.clone(), task_id.clone(), run_id.clone()).await;

    // Emit events to the frontend
    let _ = app.emit("backend-event", BackendEvent::TaskRunStarted {
        task_id: task_id.clone(),
        run_id: run_id.clone(),
    });
    let _ = app.emit("backend-event", BackendEvent::TasksChanged {
        task_ids: vec![task_id],
    });

    info!(session_id, run_id, "agent task run started");
    Ok(session_id)
}

/// Install global listeners on the app that intercept `agent:message` events
/// and convert them into task run state transitions. Called once at app
/// startup.
pub fn install_agent_listeners(
    app: &AppHandle,
    store: Arc<TaskStore>,
    executor_map: Arc<ExecutorMap>,
) {
    let app_ = app.clone();
    let store_ = store.clone();
    let map_ = executor_map.clone();

    // agent:message carries all turn events. We care about `result` and `error`.
    app.listen("agent:message", move |event| {
        // Non-blocking: clone state into an async task
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
                    // Progress — derive a short summary string
                    let summary = truncate(&message.to_string(), 200);
                    let _ = store__.update_run_summary(&run.run_id, &summary);
                    let _ = app__.emit("backend-event", BackendEvent::TaskRunProgress {
                        task_id: run.task_id.clone(),
                        run_id: run.run_id.clone(),
                        summary,
                    });
                }
                "result" => {
                    let fs = final_summary(&message);
                    finalize_run(&app__, &store__, &map__, &session_id, RunOutcome::Succeeded, Some(&fs)).await;
                }
                "error" => {
                    let msg = message.get("message").and_then(|v| v.as_str()).map(ToString::to_string);
                    finalize_run(&app__, &store__, &map__, &session_id, RunOutcome::Failed, msg.as_deref()).await;
                }
                _ => {}
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

    // Flip task status based on outcome. Phase 2 simply goes Done / Failed.
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

    let _ = app.emit("backend-event", BackendEvent::TaskRunEnded {
        task_id: run.task_id.clone(),
        run_id: run.run_id.clone(),
        outcome,
        summary: summary.map(ToString::to_string),
    });
    let _ = app.emit("backend-event", BackendEvent::TasksChanged {
        task_ids: vec![run.task_id],
    });

    info!(session_id, outcome = ?outcome, "task run finalized");
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max { s.to_string() } else { format!("{}…", &s[..max]) }
}

fn final_summary(message: &Value) -> String {
    // Try to pull the last assistant content text
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
    finalize_run(app, &store, &executor_map, &session_id, RunOutcome::Cancelled, Some("cancelled by user")).await;
    Ok(())
}
