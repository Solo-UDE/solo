//! Task planner — Tauri-side orchestrator.
//!
//! Gathers context fragments from available providers, renders a prompt,
//! drives an agent_create_session call with a JSON-mode-style prompt, parses
//! the response, and inserts Suggested tasks.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use solo_protocol::{Executor, TaskDraft, TaskPatch, TaskPriority, TaskStatus, VaultScope};
use solo_tasks::{ContextFragment, TaskStore, render_prompt, trim_to_budget, DEFAULT_TOKEN_BUDGET, DEFAULT_BUNDLE};
use tauri::{AppHandle, Manager as _};
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::agent::SessionManager;

/// Rate limiter for proactive planner runs. Token bucket with 1 token, refill every 10 min.
pub struct ProactiveGate {
    last_fire: Mutex<Option<Instant>>,
    min_interval: Duration,
}

impl ProactiveGate {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            last_fire: Mutex::new(None),
            min_interval: Duration::from_secs(10 * 60),
        })
    }

    /// Returns true if a fire is allowed; updates last_fire if so.
    pub async fn try_fire(&self) -> bool {
        let mut last = self.last_fire.lock().await;
        let now = Instant::now();
        if let Some(t) = *last {
            if now.duration_since(t) < self.min_interval {
                return false;
            }
        }
        *last = Some(now);
        true
    }
}

impl Default for ProactiveGate {
    fn default() -> Self {
        Self {
            last_fire: Mutex::new(None),
            min_interval: Duration::from_secs(10 * 60),
        }
    }
}

// --- Providers (all async, all return Option<ContextFragment>) ----------------

pub async fn collect_vault_fragment(app: &AppHandle) -> Option<ContextFragment> {
    let vault_state = app.state::<crate::vault_commands::VaultState>();
    let guard = vault_state.inner.read().await;
    let Some(vault) = guard.as_ref() else {
        return None;
    };

    let filters = solo_protocol::VaultListFilters::default();
    // Use Global scope to get cross-project entries as context.
    let entries = vault.list(&VaultScope::Global, &filters).ok()?;
    let top = entries.into_iter().take(10).collect::<Vec<_>>();
    if top.is_empty() {
        return None;
    }
    let body = top
        .iter()
        .map(|e| {
            // VaultEntry has no preview field; use content if available, otherwise just title.
            let snippet = e
                .content
                .as_deref()
                .map(|c| {
                    // Truncate to ~120 chars to keep fragment compact.
                    if c.len() > 120 {
                        format!("{}…", &c[..120])
                    } else {
                        c.to_string()
                    }
                })
                .unwrap_or_default();
            if snippet.is_empty() {
                format!("- {}", e.title)
            } else {
                format!("- {}: {}", e.title, snippet)
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    Some(ContextFragment::new("vault", body))
}

pub async fn collect_skills_fragment(app: &AppHandle) -> Option<ContextFragment> {
    // skills_list_available requires a cwd string. Pull it from FsState; if not
    // set yet, fall back to the user home dir so we at least get global skills.
    let cwd: String = {
        let fs_state = app.state::<crate::fs_commands::FsState>();
        let root = fs_state.workspace_root.read().await;
        match root.as_ref() {
            Some(p) => p.to_string_lossy().into_owned(),
            None => {
                warn!("skills fragment: no workspace root set, falling back to home dir");
                dirs::home_dir()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default()
            }
        }
    };

    if cwd.is_empty() {
        return None;
    }

    let skills = crate::skills_commands::skills_list_available(cwd)
        .await
        .ok()?;

    let body = skills
        .iter()
        .map(|s| {
            // SkillInfo::description is String, not Option<String>.
            if s.description.is_empty() {
                format!("- {}", s.name)
            } else {
                format!("- {}: {}", s.name, s.description)
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    if body.is_empty() {
        return None;
    }
    Some(ContextFragment::new("skills", body))
}

pub async fn collect_git_fragment(app: &AppHandle) -> Option<ContextFragment> {
    // Access workspace_root directly from FsState (no current_workspace_root() method).
    let fs_state = app.state::<crate::fs_commands::FsState>();
    let root = {
        let guard = fs_state.workspace_root.read().await;
        guard.clone()?
    };

    let repo = git2::Repository::open(&root).ok()?;
    let head = repo.head().ok()?;
    let branch = head.shorthand().unwrap_or("?").to_string();

    let mut revwalk = repo.revwalk().ok()?;
    revwalk.push_head().ok()?;
    let commits: Vec<String> = revwalk
        .take(5)
        .filter_map(|oid| {
            let oid = oid.ok()?;
            let commit = repo.find_commit(oid).ok()?;
            Some(format!(
                "{} {}",
                &oid.to_string()[..8],
                commit.summary().unwrap_or("")
            ))
        })
        .collect();

    let body = format!(
        "Current branch: {}\nRecent commits:\n{}",
        branch,
        commits.join("\n"),
    );
    Some(ContextFragment::new("git", body))
}

pub async fn collect_sessions_fragment(_app: &AppHandle) -> Option<ContextFragment> {
    // Phase 6 fallback: read recent session JSON files from ~/.solo/sessions/.
    let home = dirs::home_dir()?;
    let sess_dir = home.join(".solo").join("sessions");
    let mut entries: Vec<std::path::PathBuf> = std::fs::read_dir(&sess_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|ext| ext == "json").unwrap_or(false))
        .collect();
    entries.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    entries.reverse();
    entries.truncate(5);
    if entries.is_empty() {
        return None;
    }
    let body = entries
        .iter()
        .map(|p| {
            let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("?");
            format!("- {}", name)
        })
        .collect::<Vec<_>>()
        .join("\n");
    Some(ContextFragment::new("sessions", body))
}

pub async fn collect_notes_fragment(app: &AppHandle) -> Option<ContextFragment> {
    // Read the planner_notes field from user-scope settings.
    let notes = crate::settings_commands::settings_get_planner_notes()
        .await
        .ok()?;
    let notes = notes.trim().to_string();
    if notes.is_empty() {
        return None;
    }
    let _ = app; // app kept in signature for future use (e.g. project-scope notes)
    Some(ContextFragment::new("notes", notes))
}

pub async fn collect_tasks_fragment(store: &Arc<TaskStore>) -> Option<ContextFragment> {
    let existing = store
        .list(&solo_protocol::TaskListFilters::default())
        .ok()?;
    let open: Vec<_> = existing
        .into_iter()
        .filter(|t| !matches!(t.status, TaskStatus::Done | TaskStatus::Archived))
        .take(20)
        .collect();
    if open.is_empty() {
        return None;
    }
    let body = open
        .iter()
        .map(|t| format!("- [{:?}] {}", t.status, t.title))
        .collect::<Vec<_>>()
        .join("\n");
    Some(ContextFragment::new("existing_tasks", body))
}

// --- Planner entry point -----------------------------------------------------

/// Run the planner with the given goal and bundle. Inserts Suggested tasks
/// and returns their ids.
pub async fn plan_from_goal(
    app: &AppHandle,
    store: Arc<TaskStore>,
    session_manager: Arc<SessionManager>,
    goal: String,
    bundle: Vec<String>,
) -> Result<Vec<String>, String> {
    // Collect fragments from requested providers
    let mut fragments = Vec::new();
    let want: Vec<String> = if bundle.is_empty() {
        DEFAULT_BUNDLE.iter().map(|s| (*s).to_string()).collect()
    } else {
        bundle
    };

    for source in &want {
        let frag = match source.as_str() {
            "vault" => collect_vault_fragment(app).await,
            "skills" => collect_skills_fragment(app).await,
            "git" => collect_git_fragment(app).await,
            "tasks" | "existing_tasks" => collect_tasks_fragment(&store).await,
            "sessions" => collect_sessions_fragment(app).await,
            "notes" => collect_notes_fragment(app).await,
            _ => None,
        };
        if let Some(f) = frag {
            fragments.push(f);
        }
    }
    fragments = trim_to_budget(fragments, DEFAULT_TOKEN_BUDGET);

    info!(n_fragments = fragments.len(), "running planner");

    let prompt = render_prompt(&goal, &fragments);

    // Spawn a one-shot session to get the LLM response
    let session_id = uuid::Uuid::new_v4().to_string();
    session_manager
        .create_session(&session_id, None)
        .map_err(|e| format!("planner session: {e}"))?;
    session_manager
        .send_message(&session_id, &prompt, None)
        .map_err(|e| format!("planner prompt: {e}"))?;

    // Wait for the session to complete — we collect agent:message events and
    // look for a `result` message. For Phase 5 we use a simple timed poll.
    let raw = wait_for_result(app, &session_id, Duration::from_secs(60))
        .await
        .ok_or_else(|| "planner timed out".to_string())?;

    // Kill the session (it's one-shot)
    let _ = session_manager.delete_session(&session_id);

    // Parse drafts
    let drafts = parse_drafts(&raw)?;
    let mut ids = Vec::new();
    for d in drafts {
        let task = store
            .create(TaskDraft {
                title: d.title,
                description: d.description,
                executor: d.executor,
                priority: d.priority,
                subtasks: Vec::new(),
                label_ids: Vec::new(),
                project_id: None,
                cycle_id: None,
            })
            .map_err(|e| e.to_string())?;
        // Promote to Suggested status (create defaults to Queued)
        store
            .update(
                &task.id,
                TaskPatch {
                    status: Some(TaskStatus::Suggested),
                    ..Default::default()
                },
            )
            .map_err(|e| e.to_string())?;
        ids.push(task.id);
    }
    Ok(ids)
}

// Listen for agent:message events, accumulate assistant text, and return it
// when the session emits its terminal `result` message. The agent-bridge
// shape per `BridgeAgentMessage` is:
//   - { type: "text", content: "..." }          ← assistant chunks we concatenate
//   - { type: "tool_use" | "thinking" | ... }   ← ignored
//   - { type: "result" }                        ← terminal marker (no `result` field)
//   - { type: "error", content: "..." }         ← abort
async fn wait_for_result(
    app: &AppHandle,
    session_id: &str,
    timeout: Duration,
) -> Option<String> {
    use tauri::Listener as _;
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Arc::new(Mutex::new(Some(tx)));
    let buf = std::sync::Arc::new(Mutex::new(String::new()));
    let sid = session_id.to_string();

    let handle = app.listen("agent:message", move |event| {
        let tx_c = tx.clone();
        let buf_c = buf.clone();
        let sid_c = sid.clone();
        let payload = event.payload().to_string();
        tauri::async_runtime::spawn(async move {
            let Ok(v): Result<serde_json::Value, _> = serde_json::from_str(&payload) else {
                return;
            };
            let Some(msg_session) = v.get("sessionId").and_then(|x| x.as_str()) else {
                return;
            };
            if msg_session != sid_c {
                return;
            }
            let Some(msg) = v.get("message") else {
                return;
            };
            let msg_type = msg.get("type").and_then(|x| x.as_str()).unwrap_or("");

            match msg_type {
                "text" => {
                    if let Some(content) = msg.get("content").and_then(|x| x.as_str()) {
                        buf_c.lock().await.push_str(content);
                    }
                }
                "result" => {
                    let collected = buf_c.lock().await.clone();
                    if let Some(tx) = tx_c.lock().await.take() {
                        let _ = tx.send(collected);
                    }
                }
                "error" => {
                    let content = msg
                        .get("content")
                        .and_then(|x| x.as_str())
                        .unwrap_or("agent error")
                        .to_string();
                    // Send the error text as the "result" so parse_drafts can surface it
                    if let Some(tx) = tx_c.lock().await.take() {
                        let _ = tx.send(format!("ERROR: {content}"));
                    }
                }
                _ => {}
            }
        });
    });

    let result = tokio::time::timeout(timeout, rx).await.ok()?.ok()?;
    app.unlisten(handle);
    Some(result)
}

#[derive(Deserialize)]
struct RawDraft {
    title: String,
    description: String,
    executor: Executor,
    priority: TaskPriority,
}

fn parse_drafts(raw: &str) -> Result<Vec<RawDraft>, String> {
    // The LLM may wrap in ```json ... ``` fences; strip them.
    let cleaned = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    serde_json::from_str::<Vec<RawDraft>>(cleaned)
        .map_err(|e| format!("planner returned invalid JSON: {e} / raw: {cleaned}"))
}
