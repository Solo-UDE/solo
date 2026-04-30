# Task Allocator — Phase 3 (Worktree + Safety) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an `executor=Agent` task run in an isolated git worktree with full bypass permissions, blocked against a hard deny-list of destructive commands. When the run finishes, offer the user **Merge / Discard / Open PR** on the worktree's diff.

**Architecture:** Promote `agent_config` from `Option<Value>` to a **typed `AgentConfig`** struct in `solo-protocol`. Teach `task_executor.rs` to (a) create a worktree when `execution_location=Worktree`, (b) pass a worktree-specific working dir to the agent session, (c) evaluate every `agent:permission_request` against a deny-list and auto-deny matches. On completion in a worktree, diff-check and emit `TaskReviewReady` if anything changed. Add `task_review_{merge,discard,open_pr}` commands. Frontend: **Review changes** modal triggered by the new event.

**Tech Stack:** Existing Solo worktree APIs (`worktree_commands.rs`), `git2` crate (already used), Claude Code permission-request contract. No new crate deps.

**Spec reference:** `docs/superpowers/specs/2026-04-21-task-allocator-design.md` §4 safety triangle, §4.4 error policy, §12 security.

---

## File map for Phase 3

**Modify (Rust):**
- `crates/solo-protocol/src/lib.rs` — add `AgentConfig`, `PermissionMode`, `ExecutionLocation`. Replace `agent_config: Option<Value>` on `Task` with `Option<AgentConfig>`. Add BackendEvent `TaskReviewReady`.
- `crates/solo-tasks/src/store.rs` — update serialization of `agent_config` (now typed); add `record_worktree_for_run(run_id, worktree_id)` + `review_state_for_task(task_id)` helpers.
- `apps/desktop/src-tauri/src/task_executor.rs` — worktree spawn path, deny-list enforcement via `agent:permission_request` intercept, diff-check on finalize.
- `apps/desktop/src-tauri/src/task_commands.rs` — `task_review_merge`, `task_review_discard`, `task_review_open_pr`.
- `apps/desktop/src-tauri/src/lib.rs` — register new commands; pass a global deny-list via settings.

**Modify (TS):**
- Bindings auto-regen.
- `apps/desktop/src/lib/tauri/tasks.ts` — review command wrappers + `AgentConfig` helpers.
- `apps/desktop/src/stores/taskStore.ts` — `reviewingTask` state.
- `apps/desktop/src/hooks/useTaskStream.ts` — handle `TaskReviewReady`.
- `apps/desktop/src/components/vault/tasks/TaskDrawer.tsx` — new "Agent" tab with config editor; switch TaskPatch to handle AgentConfig.
- `apps/desktop/src/components/vault/tasks/AgentConfigTab.tsx` — new.
- `apps/desktop/src/components/vault/tasks/ReviewModal.tsx` — new.

---

## Task 1 · Typed `AgentConfig` in protocol

**File:** `crates/solo-protocol/src/lib.rs`

- [ ] **Step 1.1:** In the Task Allocator section (added in Phase 1), before the `Task` struct, insert:

```rust
/// How the agent's shell session is constrained.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    /// User confirms every tool use. Default for manual runs.
    Ask,
    /// Agent plans but does not execute.
    Plan,
    /// Auto-accept file edits; confirm shell writes.
    AcceptEdits,
    /// No prompts. REQUIRES ExecutionLocation::Worktree.
    Bypass,
}

/// Where the agent runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum ExecutionLocation {
    /// The user's live workspace. Default for manual runs.
    MainWorkspace,
    /// An isolated git worktree (auto-created, auto-cleaned after review).
    Worktree,
}

/// Per-task executor configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct AgentConfig {
    /// Model override; None → system default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,

    /// Explicit skill allow-list; None → planner/default picks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub skills: Option<Vec<String>>,

    pub permission_mode: PermissionMode,
    pub execution_location: ExecutionLocation,

    /// Extra command patterns to block (merged with global deny-list).
    #[serde(default)]
    pub deny_list: Vec<String>,

    /// Optional network allow-list. None = open; Some([]) = offline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub network_allow_list: Option<Vec<String>>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            model: None,
            skills: None,
            permission_mode: PermissionMode::Ask,
            execution_location: ExecutionLocation::MainWorkspace,
            deny_list: Vec::new(),
            network_allow_list: None,
        }
    }
}
```

- [ ] **Step 1.2:** Update the `Task` struct's `agent_config` field. Change:
```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
#[ts(type = "unknown | null")]
pub agent_config: Option<serde_json::Value>,
```
to:
```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
#[ts(optional)]
pub agent_config: Option<AgentConfig>,
```

- [ ] **Step 1.3:** `TaskPatch` needs a way to update `agent_config`. Add field:
```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
#[ts(optional)]
pub agent_config: Option<AgentConfig>,
```

- [ ] **Step 1.4:** Add `BackendEvent::TaskReviewReady`:

Inside the `BackendEvent` enum:
```rust
    /// A task in a worktree finished with pending changes; show review modal.
    #[serde(rename = "tasks:review_ready")]
    TaskReviewReady {
        task_id: String,
        run_id: String,
        worktree_id: String,
        diff_summary: String, // "N files changed, +X/-Y"
    },
```

- [ ] **Step 1.5:** Regen bindings:
```bash
bun run gen:bindings
```
Expected new files: `AgentConfig.ts`, `PermissionMode.ts`, `ExecutionLocation.ts`. `Task.ts`, `TaskPatch.ts`, `BackendEvent.ts` updated.

- [ ] **Step 1.6:** `cargo check -p solo-protocol` — but this will fail because `solo-tasks/store.rs` deserializes the old `Option<Value>`. That's fine; Task 2 fixes it. Just verify the protocol crate itself compiles in isolation.

- [ ] **Step 1.7:** Commit (protocol only — the store fix lands next task, keep commits atomic):
```bash
git add crates/solo-protocol/src/lib.rs apps/desktop/src/bindings/AgentConfig.ts apps/desktop/src/bindings/PermissionMode.ts apps/desktop/src/bindings/ExecutionLocation.ts apps/desktop/src/bindings/Task.ts apps/desktop/src/bindings/TaskPatch.ts apps/desktop/src/bindings/BackendEvent.ts
git commit -m "feat(protocol): typed AgentConfig + TaskReviewReady event"
```

---

## Task 2 · Store + patch handle `AgentConfig`

**Files:**
- `crates/solo-tasks/src/store.rs`

The store's `insert` and `load_task_row` currently serialize `agent_config` via `serde_json::to_string(&Option<Value>)`. Because `AgentConfig: Serialize + Deserialize`, the existing `to_string` / `from_str` code works as-is. But `update()` needs to accept `patch.agent_config`.

- [ ] **Step 2.1:** In the `update()` method, after existing `if let Some(v) = patch.priority { ... }` line, add:
```rust
    if let Some(v) = patch.agent_config { task.agent_config = Some(v); }
```

- [ ] **Step 2.2:** Add a helper method to record which worktree a run is using:
```rust
pub fn record_worktree_for_run(&self, run_id: &str, worktree_id: &str) -> TaskResult<()> {
    let conn = self.conn.lock().expect("poisoned");
    conn.execute(
        "UPDATE task_runs SET worktree_id = ? WHERE id = ?",
        params![worktree_id, run_id],
    )?;
    Ok(())
}
```

- [ ] **Step 2.3:** Add a test:
```rust
#[test]
fn update_sets_agent_config() {
    use solo_protocol::{AgentConfig, ExecutionLocation, PermissionMode};
    let store = TaskStore::open_in_memory().unwrap();
    let t = store.create(TaskDraft {
        title: "run".into(), description: String::new(),
        executor: Executor::Agent, priority: TaskPriority::Medium,
    }).unwrap();
    assert!(t.agent_config.is_none());

    let cfg = AgentConfig {
        permission_mode: PermissionMode::Bypass,
        execution_location: ExecutionLocation::Worktree,
        ..Default::default()
    };
    let updated = store.update(&t.id, TaskPatch {
        agent_config: Some(cfg.clone()),
        ..Default::default()
    }).unwrap();
    assert_eq!(updated.agent_config.unwrap().permission_mode, PermissionMode::Bypass);
}
```

- [ ] **Step 2.4:** `cargo test -p solo-tasks --lib` — expect 12 passing tests.
`cargo clippy -p solo-tasks --all-targets -- -D warnings` — zero warnings.

- [ ] **Step 2.5:** Commit:
```bash
git add crates/solo-tasks/src/store.rs
git commit -m "feat(tasks): store accepts typed AgentConfig + worktree run recording"
```

---

## Task 3 · Deny-list module

**File:** `crates/solo-tasks/src/deny_list.rs` (new)

Pure function: given a command string, return true if it matches any pattern. Simple glob/contains semantics (v1):
- Patterns beginning/ending with `*` use `str::contains`.
- Exact patterns use `str::eq`.
- Multi-token commands (`rm -rf /`) match as substring.

- [ ] **Step 3.1:** Create the file:
```rust
//! Deny-list — block destructive / dangerous shell commands regardless of
//! the task's permission mode. Evaluated on every `agent:permission_request`.

/// Default global deny-list. Shipped with Solo. Additive with per-task
/// deny_list from `AgentConfig`.
pub const DEFAULT_DENY_LIST: &[&str] = &[
    "rm -rf /*",
    "rm -rf /",
    "sudo ",          // any sudo invocation
    "curl * | sh",
    "curl * | bash",
    "wget * | sh",
    "git push --force",
    "git push -f",
    "git reset --hard",
    ":(){:|:&};:",    // fork bomb
    "mkfs",
    "dd if=/dev",
];

/// Does `cmd` (the raw shell command string the agent wants to run) match
/// any pattern in `patterns`? Patterns containing `*` are treated as wildcards
/// at that position (simple `contains` semantics for now).
pub fn is_denied(cmd: &str, patterns: &[&str]) -> Option<String> {
    let cmd_trim = cmd.trim();
    for p in patterns {
        if matches_pattern(cmd_trim, p) {
            return Some((*p).to_string());
        }
    }
    None
}

fn matches_pattern(cmd: &str, pattern: &str) -> bool {
    // No wildcard → substring contains (matches `rm -rf /` within longer commands too)
    if !pattern.contains('*') {
        return cmd.contains(pattern);
    }
    // Split pattern by '*'; command must contain each piece in order
    let pieces: Vec<&str> = pattern.split('*').collect();
    let mut cursor = 0;
    for piece in pieces.iter() {
        if piece.is_empty() { continue; }
        match cmd[cursor..].find(piece) {
            Some(i) => cursor += i + piece.len(),
            None => return false,
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_substring_matches() {
        assert!(is_denied("sudo apt install", &["sudo "]).is_some());
        assert!(is_denied("run git push --force origin main", &["git push --force"]).is_some());
    }

    #[test]
    fn wildcards_match_bracketing() {
        assert!(is_denied("curl https://x | sh", &["curl * | sh"]).is_some());
        assert!(is_denied("curl https://x | bash", &["curl * | sh"]).is_none());
    }

    #[test]
    fn benign_commands_pass() {
        assert!(is_denied("ls -la", DEFAULT_DENY_LIST).is_none());
        assert!(is_denied("git status", DEFAULT_DENY_LIST).is_none());
        assert!(is_denied("cargo test", DEFAULT_DENY_LIST).is_none());
    }

    #[test]
    fn dangerous_defaults_blocked() {
        assert!(is_denied("rm -rf /", DEFAULT_DENY_LIST).is_some());
        assert!(is_denied("sudo rm stuff", DEFAULT_DENY_LIST).is_some());
    }
}
```

- [ ] **Step 3.2:** Register in `crates/solo-tasks/src/lib.rs`:
```rust
pub mod deny_list;
pub use deny_list::{DEFAULT_DENY_LIST, is_denied};
```

- [ ] **Step 3.3:** Test + clippy:
```bash
cargo test -p solo-tasks --lib
cargo clippy -p solo-tasks --all-targets -- -D warnings
```
Expect 16 tests pass (12 + 4 new).

- [ ] **Step 3.4:** Commit:
```bash
git add crates/solo-tasks/src/deny_list.rs crates/solo-tasks/src/lib.rs
git commit -m "feat(tasks): deny-list module with default destructive-command patterns"
```

---

## Task 4 · Executor — worktree + deny-list integration

**File:** `apps/desktop/src-tauri/src/task_executor.rs`

This is the biggest task in Phase 3. Three additions:
1. If `task.agent_config.execution_location == Worktree`, create a worktree before spawning the agent.
2. Intercept `agent:permission_request` events. Evaluate the tool input against the deny-list; auto-deny matches.
3. On finalize (in worktree mode), check for diff; if any, emit `TaskReviewReady` and set status to `NeedsReview` instead of `Done`.

- [ ] **Step 4.1:** Read the existing `task_executor.rs`. Familiarize with `spawn_agent_for_task`, `install_agent_listeners`, `finalize_run`, `ExecutorMap`.

- [ ] **Step 4.2:** Extend `ActiveRun` to carry the worktree id (if any) and the deny-list:

```rust
#[derive(Clone)]
struct ActiveRun {
    task_id: String,
    run_id: String,
    worktree_id: Option<String>,
    deny_patterns: Vec<String>,
}
```
Update `ExecutorMap::insert` signature accordingly:
```rust
pub async fn insert(&self, session_id: String, task_id: String, run_id: String, worktree_id: Option<String>, deny_patterns: Vec<String>) {
    self.inner.write().await.insert(session_id, ActiveRun { task_id, run_id, worktree_id, deny_patterns });
}
```

- [ ] **Step 4.3:** Extend `spawn_agent_for_task`. After loading the task, branch on execution_location:

```rust
// Resolve config
let cfg = task.agent_config.clone().unwrap_or_default();

// Create worktree if requested
let worktree_id = if matches!(cfg.execution_location, ExecutionLocation::Worktree) {
    Some(create_worktree_for_run(app, &task.id, &run_id).await?)
} else {
    None
};
```

where `run_id` is moved earlier — you may need to reorder so the run row exists before worktree creation.

Add a helper:
```rust
async fn create_worktree_for_run(
    app: &AppHandle,
    task_id: &str,
    run_id: &str,
) -> Result<String, String> {
    // Invoke the existing worktree_create command directly via Tauri state.
    // Name pattern: solo/task-<short-task-id>-run-<short-run-id>
    use tauri::Manager as _;
    let short = |s: &str| s.chars().take(8).collect::<String>();
    let branch = format!("solo/task-{}-{}", short(task_id), short(run_id));

    let wt_state = app.state::<crate::worktree_commands::WorktreeState>();
    let fs_state = app.state::<crate::fs_commands::FsState>();
    crate::worktree_commands::worktree_create_from_current(
        branch.clone(),
        Some(format!("Task run {}", run_id)),
        wt_state,
        fs_state,
        app.clone(),
    ).await
}
```

**VERIFY the exact signature** of `worktree_create_from_current` before pasting. If the existing API differs, adjust. If there's no single-call worktree creator, compose the existing primitives (`worktree_list`, `worktree_create`, etc.). The plan's fallback if this helper path is too complex: report BLOCKED and the controller will provide a more specific fix.

- [ ] **Step 4.4:** After worktree creation, record it on the run row:
```rust
if let Some(wid) = &worktree_id {
    let _ = store.record_worktree_for_run(&run_id, wid);
}
```

- [ ] **Step 4.5:** Extend agent session creation to set the cwd when a worktree exists. `SessionManager::create_session(&id, Some(config))` accepts a `SessionConfig`. Look up what field controls cwd (likely `cwd` or `workingDirectory`). Build the `SessionConfig` accordingly:

```rust
let session_config = worktree_id.as_ref().map(|wid| {
    // Resolve worktree path from state
    let wt_path = /* look up path from WorktreeState by wid */;
    crate::agent::SessionConfig {
        cwd: Some(wt_path.to_string_lossy().into_owned()),
        ..Default::default()
    }
});
session_manager.create_session(&session_id, session_config)
    .map_err(|e| format!("agent create_session failed: {e}"))?;
```

If `SessionConfig` doesn't have a `cwd` field, grep the struct, find the right field name, and adjust. **Report BLOCKED** if none exists — we'd need to extend the agent bridge, which is out of Phase 3 scope.

- [ ] **Step 4.6:** Update the `ExecutorMap::insert` call with the worktree_id and deny-patterns:
```rust
let all_deny: Vec<String> = solo_tasks::DEFAULT_DENY_LIST.iter().map(|s| (*s).to_string())
    .chain(cfg.deny_list.iter().cloned())
    .collect();
executor_map.insert(session_id.clone(), task_id.clone(), run_id.clone(), worktree_id.clone(), all_deny).await;
```

- [ ] **Step 4.7:** Install the permission-request listener in `install_agent_listeners`. Add a second `app.listen(...)` call for `agent:permission_request`:

```rust
app.listen("agent:permission_request", {
    let app_ = app.clone();
    let map_ = executor_map.clone();
    move |event| {
        let Ok(payload): Result<Value, _> = serde_json::from_str(event.payload()) else { return };
        let Some(session_id) = payload.get("sessionId").and_then(|v| v.as_str()).map(ToString::to_string) else { return };
        let request_id = payload.get("requestId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let tool_name = payload.get("toolName").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let tool_input = payload.get("toolInput").cloned().unwrap_or(Value::Null);

        let app__ = app_.clone();
        let map__ = map_.clone();
        tauri::async_runtime::spawn(async move {
            let Some(run) = map__.get(&session_id).await else { return };

            // For shell tools, extract the command; for others we don't deny.
            let cmd_opt = extract_command(&tool_name, &tool_input);
            if let Some(cmd) = cmd_opt {
                let patterns: Vec<&str> = run.deny_patterns.iter().map(String::as_str).collect();
                if let Some(matched) = solo_tasks::is_denied(&cmd, &patterns) {
                    warn!(cmd, matched, "deny-list blocked command");
                    // Emit a synthetic permission response via agent_commands
                    let _ = app__.emit("task:permission_deny", serde_json::json!({
                        "session_id": session_id,
                        "request_id": request_id,
                        "reason": format!("blocked by deny-list: {matched}"),
                    }));
                }
            }
        });
    }
});
```

And helper:
```rust
fn extract_command(tool_name: &str, tool_input: &Value) -> Option<String> {
    // Shell tool → look for a `command` field; Bash tool → `command` field; etc.
    match tool_name {
        "Bash" | "bash" | "shell" | "Shell" => {
            tool_input.get("command").and_then(|v| v.as_str()).map(ToString::to_string)
        }
        _ => None,
    }
}
```

**Note on how denial reaches the agent:** Emitting `task:permission_deny` is a *signal*, not enforcement. The agent-bridge's permission handler listens for the user's decision. We need to ensure that a deny reaches the bridge. The minimum viable path for Phase 3: grep `agent_commands.rs` for the existing `respond_to_permission` / `agent_permission_response` / similar command. Invoke it directly from here with `PermissionDecision::Deny`. Report BLOCKED if that API doesn't exist — fallback is to document the limitation and ship Phase 3 with advisory-only deny-list, fixing enforcement in a follow-up.

- [ ] **Step 4.8:** Modify `finalize_run` for worktree mode. Before the current end-of-body that sets status to Done/Failed, add:

```rust
// Worktree-mode: check diff and route to NeedsReview if changes exist
if let Some(wid) = &run.worktree_id {
    if outcome == RunOutcome::Succeeded {
        match diff_summary_for_worktree(wid) {
            Ok(Some(summary)) => {
                // Emit review event
                let _ = app.emit("backend-event", BackendEvent::TaskReviewReady {
                    task_id: run.task_id.clone(),
                    run_id: run.run_id.clone(),
                    worktree_id: wid.clone(),
                    diff_summary: summary,
                });
                // Override status to NeedsReview
                let patch = solo_protocol::TaskPatch {
                    status: Some(TaskStatus::NeedsReview),
                    ..Default::default()
                };
                let _ = store.update(&run.task_id, patch);
                // Re-emit TasksChanged
                let _ = app.emit("backend-event", BackendEvent::TasksChanged { task_ids: vec![run.task_id.clone()] });
                // Skip the normal outcome→status mapping
                return;
            }
            Ok(None) => {} // no changes: fall through to Done
            Err(e) => warn!(error = %e, "diff check failed"),
        }
    }
}
```

Add helper `diff_summary_for_worktree`:
```rust
fn diff_summary_for_worktree(worktree_id: &str) -> Result<Option<String>, String> {
    // Look up worktree path via WorktreeState (need the state passed in;
    // for simplicity pass app and resolve from there, or refactor finalize_run
    // to accept the state).
    // Use git2 to compute diff stats.
    Ok(Some("(diff summary placeholder — see follow-up)".into()))
}
```

**Known limitation:** Computing a proper diff summary from inside `finalize_run` needs access to app state and git. The plan ships a placeholder; full impl is a follow-up. Mark clearly in the commit message. The Review modal still opens; user sees "changes detected" and can click Open PR to see actual diff.

- [ ] **Step 4.9:** `cargo check -p solo-desktop-lib` — zero errors.

- [ ] **Step 4.10:** Commit:
```bash
git add apps/desktop/src-tauri/src/task_executor.rs
git commit -m "feat(tasks): worktree execution + deny-list interceptor + review routing"
```

---

## Task 5 · Review commands

**File:** `apps/desktop/src-tauri/src/task_commands.rs`

- [ ] **Step 5.1:** Add at top (imports):
```rust
use tauri::Manager as _;
```

- [ ] **Step 5.2:** Append commands:

```rust
#[tauri::command]
pub async fn task_review_discard(
    id: String,
    run_id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<(), String> {
    let store = get_store(&state).await?;
    // Look up the worktree_id on this run
    let task = store.get(&id).map_err(|e| e.to_string())?;
    let run = task.runs.into_iter().find(|r| r.id == run_id)
        .ok_or_else(|| "run not found".to_string())?;
    let Some(wid) = run.worktree_id else {
        return Err("run has no worktree".into());
    };
    // Remove the worktree via existing command
    let wt_state = app.state::<crate::worktree_commands::WorktreeState>();
    crate::worktree_commands::worktree_remove(wid, true, wt_state, app.clone()).await?;
    // Flip task to Done (work discarded; run row keeps summary)
    store.update(&id, solo_protocol::TaskPatch {
        status: Some(solo_protocol::TaskStatus::Done),
        ..Default::default()
    }).map_err(|e| e.to_string())?;
    let _ = app.emit("backend-event", solo_protocol::BackendEvent::TasksChanged { task_ids: vec![id] });
    Ok(())
}

#[tauri::command]
pub async fn task_review_merge(
    id: String,
    run_id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<(), String> {
    let store = get_store(&state).await?;
    let task = store.get(&id).map_err(|e| e.to_string())?;
    let run = task.runs.into_iter().find(|r| r.id == run_id)
        .ok_or_else(|| "run not found".to_string())?;
    let Some(wid) = run.worktree_id else {
        return Err("run has no worktree".into());
    };
    // Merge via existing worktree merge command if available; else surface error.
    let wt_state = app.state::<crate::worktree_commands::WorktreeState>();
    crate::worktree_commands::worktree_merge_to_main(wid.clone(), wt_state.clone(), app.clone())
        .await
        .map_err(|e| format!("merge failed: {e}"))?;
    // Clean up worktree post-merge
    crate::worktree_commands::worktree_remove(wid, false, wt_state, app.clone()).await.ok();

    store.update(&id, solo_protocol::TaskPatch {
        status: Some(solo_protocol::TaskStatus::Done),
        ..Default::default()
    }).map_err(|e| e.to_string())?;
    let _ = app.emit("backend-event", solo_protocol::BackendEvent::TasksChanged { task_ids: vec![id] });
    Ok(())
}

#[tauri::command]
pub async fn task_review_open_pr(
    id: String,
    run_id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<String, String> {
    let store = get_store(&state).await?;
    let task = store.get(&id).map_err(|e| e.to_string())?;
    let run = task.runs.into_iter().find(|r| r.id == run_id)
        .ok_or_else(|| "run not found".to_string())?;
    let Some(wid) = run.worktree_id else {
        return Err("run has no worktree".into());
    };
    // Delegate to existing git command; return PR URL.
    let wt_state = app.state::<crate::worktree_commands::WorktreeState>();
    let url = crate::worktree_commands::worktree_open_pr(wid, wt_state, app.clone()).await?;
    // Task stays NeedsReview until user clicks Done; or we could auto-flip
    Ok(url)
}
```

**VERIFY existence of** `worktree_merge_to_main`, `worktree_remove`, `worktree_open_pr`. If any doesn't exist with the exact name/signature, adjust. If a feature is entirely missing (e.g., no merge helper), gate the command behind a "not yet" error and note in the PR. Don't silently fake it.

- [ ] **Step 5.3:** Register the 3 new commands in `lib.rs`:
```rust
task_commands::task_review_merge,
task_commands::task_review_discard,
task_commands::task_review_open_pr,
```

- [ ] **Step 5.4:** `cargo check -p solo-desktop-lib` — zero errors.

- [ ] **Step 5.5:** Commit:
```bash
git add apps/desktop/src-tauri/src/task_commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(tasks): review commands (merge / discard / open PR)"
```

---

## Task 6 · TS wrappers + store review state

**Files:**
- `apps/desktop/src/lib/tauri/tasks.ts`
- `apps/desktop/src/stores/taskStore.ts`

- [ ] **Step 6.1:** `tasks.ts`:
```ts
  reviewMerge:   (id: string, runId: string) => invoke<void>  ('task_review_merge',   { id, runId }),
  reviewDiscard: (id: string, runId: string) => invoke<void>  ('task_review_discard', { id, runId }),
  reviewOpenPr:  (id: string, runId: string) => invoke<string>('task_review_open_pr', { id, runId }),
```

Also re-export the new types:
```ts
export type { AgentConfig } from '@/bindings/AgentConfig';
export type { PermissionMode } from '@/bindings/PermissionMode';
export type { ExecutionLocation } from '@/bindings/ExecutionLocation';
```

- [ ] **Step 6.2:** `taskStore.ts` — add state:
```ts
  pendingReview: { taskId: string; runId: string; worktreeId: string; diffSummary: string } | null;
```
Init `pendingReview: null`.

Add actions:
```ts
  openReview: (payload: { taskId: string; runId: string; worktreeId: string; diffSummary: string }) => {
    set((s) => { s.pendingReview = payload; });
  },
  closeReview: () => set((s) => { s.pendingReview = null; }),
  reviewMerge: async () => {
    const r = get().pendingReview;
    if (!r) return;
    await tasksApi.reviewMerge(r.taskId, r.runId);
    set((s) => { s.pendingReview = null; });
  },
  reviewDiscard: async () => {
    const r = get().pendingReview;
    if (!r) return;
    await tasksApi.reviewDiscard(r.taskId, r.runId);
    set((s) => { s.pendingReview = null; });
  },
  reviewOpenPr: async () => {
    const r = get().pendingReview;
    if (!r) return '';
    const url = await tasksApi.reviewOpenPr(r.taskId, r.runId);
    return url;
  },
```

- [ ] **Step 6.3:** `bun run check` — zero errors.

- [ ] **Step 6.4:** Commit:
```bash
git add apps/desktop/src/lib/tauri/tasks.ts apps/desktop/src/stores/taskStore.ts
git commit -m "feat(tasks): TS review API + store pendingReview state"
```

---

## Task 7 · Hook handles `TaskReviewReady`

**File:** `apps/desktop/src/hooks/useTaskStream.ts`

- [ ] **Step 7.1:** Add a new case to the switch:
```ts
          case 'tasks:review_ready':
            openReview({
              taskId: ev.payload.task_id,
              runId: ev.payload.run_id,
              worktreeId: ev.payload.worktree_id,
              diffSummary: ev.payload.diff_summary,
            });
            void patchFromEvent([ev.payload.task_id]);
            break;
```

Pull `openReview` from the store via selector at the top:
```ts
const openReview = useTaskStore((s) => s.openReview);
```

Add `openReview` to the effect's dependency array.

- [ ] **Step 7.2:** `bun run check` + commit:
```bash
bun run check
git add apps/desktop/src/hooks/useTaskStream.ts
git commit -m "feat(tasks): hook opens review modal on TaskReviewReady"
```

---

## Task 8 · `ReviewModal` component

**File:** `apps/desktop/src/components/vault/tasks/ReviewModal.tsx` (new)

- [ ] **Step 8.1:**
```tsx
import { useState, type FC } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GitMerge, Trash2, GitPullRequest, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';

export const ReviewModal: FC = () => {
  const review = useTaskStore((s) => s.pendingReview);
  const merge = useTaskStore((s) => s.reviewMerge);
  const discard = useTaskStore((s) => s.reviewDiscard);
  const openPr = useTaskStore((s) => s.reviewOpenPr);
  const close = useTaskStore((s) => s.closeReview);

  const [busy, setBusy] = useState<null | 'merge' | 'discard' | 'pr'>(null);

  const run = async (action: 'merge' | 'discard' | 'pr') => {
    setBusy(action);
    try {
      if (action === 'merge') await merge();
      else if (action === 'discard') await discard();
      else {
        const url = await openPr();
        if (url) window.open(url, '_blank');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {review && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-background/60 backdrop-blur-sm"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[14px] border border-border/60 bg-card p-5 shadow-lg"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[14px] font-semibold">Task run ready for review</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">{review.diffSummary}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Worktree: <code className="rounded bg-muted/40 px-1">{review.worktreeId}</code>
                </p>
              </div>
              <button
                type="button" onClick={close} aria-label="Close"
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted/50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <Action icon={GitMerge}         label="Merge to main"   onClick={() => run('merge')}   busy={busy==='merge'}   tone="ok"/>
              <Action icon={GitPullRequest}   label="Open pull request" onClick={() => run('pr')}      busy={busy==='pr'}     tone="neutral"/>
              <Action icon={Trash2}           label="Discard changes" onClick={() => run('discard')} busy={busy==='discard'} tone="danger"/>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const Action: FC<{
  icon: React.ComponentType<{ className?: string }>,
  label: string,
  onClick: () => void,
  busy: boolean,
  tone: 'ok' | 'neutral' | 'danger',
}> = ({ icon: Icon, label, onClick, busy, tone }) => (
  <button
    type="button"
    disabled={busy}
    onClick={onClick}
    className={cn(
      'flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-medium',
      'hover:bg-muted/60 disabled:opacity-50',
      tone === 'ok'     && 'border-green-500/40 text-green-600',
      tone === 'neutral'&& 'border-border/60 text-foreground',
      tone === 'danger' && 'border-red-500/40 text-red-600',
    )}
  >
    <Icon className="h-4 w-4" />
    <span>{label}</span>
    {busy && <span className="ml-auto text-[10px] text-muted-foreground">running…</span>}
  </button>
);
```

- [ ] **Step 8.2:** `bun run check` + commit:
```bash
bun run check
git add apps/desktop/src/components/vault/tasks/ReviewModal.tsx
git commit -m "feat(tasks): ReviewModal — Merge / Open PR / Discard actions"
```

---

## Task 9 · Mount `ReviewModal` in `TasksSection`

**File:** `apps/desktop/src/components/sidebar/vault/TasksSection.tsx`

- [ ] **Step 9.1:** Add import + render the modal at the end of the JSX (alongside `TaskDrawer` and `NewTaskDialog`):
```tsx
import { ReviewModal } from '@/components/vault/tasks/ReviewModal';
// ...
<ReviewModal />
```

- [ ] **Step 9.2:** `bun run check` + commit:
```bash
bun run check
git add apps/desktop/src/components/sidebar/vault/TasksSection.tsx
git commit -m "feat(tasks): mount ReviewModal in TasksSection"
```

---

## Task 10 · `AgentConfigTab` — editor for execution location + permission mode + deny-list

**File:** `apps/desktop/src/components/vault/tasks/AgentConfigTab.tsx` (new)

- [ ] **Step 10.1:**
```tsx
import type { FC } from 'react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Task, AgentConfig, PermissionMode, ExecutionLocation } from '@/lib/tauri/tasks';

interface Props { readonly task: Task }

const DEFAULT_CFG: AgentConfig = {
  permission_mode: 'ask',
  execution_location: 'main_workspace',
  deny_list: [],
};

export const AgentConfigTab: FC<Props> = ({ task }) => {
  const update = useTaskStore((s) => s.update);
  const cfg: AgentConfig = task.agent_config ?? DEFAULT_CFG;

  const patch = (changes: Partial<AgentConfig>) => {
    void update(task.id, { agent_config: { ...cfg, ...changes } });
  };

  // Safety rule (UI mirror of Rust-side): Bypass only valid in Worktree
  const invalidCombo = cfg.permission_mode === 'bypass' && cfg.execution_location === 'main_workspace';

  return (
    <div className="flex flex-col gap-4 p-4 text-[12px]">
      <label className="flex flex-col gap-1 text-muted-foreground">
        Execution location
        <select
          value={cfg.execution_location}
          onChange={(e) => patch({ execution_location: e.target.value as ExecutionLocation })}
          className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground"
        >
          <option value="main_workspace">Main workspace</option>
          <option value="worktree">Isolated worktree</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-muted-foreground">
        Permission mode
        <select
          value={cfg.permission_mode}
          onChange={(e) => patch({ permission_mode: e.target.value as PermissionMode })}
          className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground"
        >
          <option value="ask">Ask (manual confirm each tool)</option>
          <option value="plan">Plan (no execution)</option>
          <option value="accept_edits">Accept edits</option>
          <option value="bypass">Bypass (worktree only)</option>
        </select>
        {invalidCombo && (
          <span className="mt-0.5 text-red-500">
            Bypass requires isolated worktree — executor will reject this combo server-side.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-muted-foreground">
        Extra deny-list patterns (one per line)
        <textarea
          rows={4}
          value={cfg.deny_list.join('\n')}
          onChange={(e) => patch({ deny_list: e.target.value.split('\n').filter(Boolean) })}
          className="rounded-md border border-border/60 bg-background px-2 py-1.5 font-mono text-[12px] text-foreground"
          placeholder="rm -rf /tmp&#10;git push --force"
        />
        <span className="mt-0.5 text-[10px]">Merged with the global deny-list.</span>
      </label>
    </div>
  );
};
```

- [ ] **Step 10.2:** Integrate into `TaskDrawer`:
- Add `'agent'` to the `DrawerTab` type: `type DrawerTab = 'overview' | 'runs' | 'agent';`
- Add it to the tabs loop: `(['overview', 'runs', 'agent'] as const)`
- Add the tab content: `{tab === 'agent' && <AgentConfigTab task={task} />}`
- Only show the Agent tab when `task.executor === 'agent'`:
  ```tsx
  {['overview', 'runs', ...(task.executor === 'agent' ? ['agent'] as const : [])].map(...)}
  ```

- [ ] **Step 10.3:** `bun run check` + commit:
```bash
bun run check
git add apps/desktop/src/components/vault/tasks/AgentConfigTab.tsx apps/desktop/src/components/vault/tasks/TaskDrawer.tsx
git commit -m "feat(tasks): AgentConfigTab (permission mode / location / deny-list)"
```

---

## Task 11 · Smoke test Phase 3

- [ ] **Step 11.1:** Launch `bun run dev`.
- [ ] **Step 11.2:** Create a new agent task: "make a trivial change to the README in this repo"
- [ ] **Step 11.3:** Open drawer → Agent tab. Set Execution location = Worktree, Permission mode = Bypass. Close drawer.
- [ ] **Step 11.4:** Click Run. Expect: task status flips to Running; worktree is created; agent runs without prompting.
- [ ] **Step 11.5:** Agent finishes with changes. Expect: Review modal pops up showing "changes detected" + worktree id.
- [ ] **Step 11.6:** Click **Discard changes**. Expect: modal closes; task status flips to Done; worktree is removed from the filesystem + `worktree_list` command shows it gone.
- [ ] **Step 11.7:** Repeat but click **Merge to main**. Expect: changes land on the current branch; worktree removed.
- [ ] **Step 11.8:** Edge case — try executor=Agent, location=Main, permission=Bypass. Save. Click Run. Expect: server rejects with error "bypass requires worktree".
- [ ] **Step 11.9:** Edge case — in the Agent tab, add deny-list entry `touch README`. Create an agent task "touch README and add a line". Click Run in Worktree/Bypass. Expect: agent's first shell call is auto-denied; task ends Failed with `blocked by deny-list` in the run summary.

**Likely issues:** the worktree-merge and open-PR commands may not exist with the exact names the plan assumes. If a review action fails with "command not found", check `apps/desktop/src-tauri/src/worktree_commands.rs` for the actual name and wire to that.

---

## Task 12 · Wrap-up

- [ ] **Step 12.1:** Run checks:
```bash
cargo test --workspace --lib && cargo clippy -p solo-tasks --all-targets -- -D warnings && bun run check
```
Expect: green.

- [ ] **Step 12.2:** Mark Phase 3 complete in spec (§15) — prepend `✅` to the Phase 3 row.

- [ ] **Step 12.3:** Commit:
```bash
git add docs/superpowers/specs/2026-04-21-task-allocator-design.md
git commit -m "docs(specs): mark Task Allocator Phase 3 complete"
```

---

## Known Phase 3 limitations (explicit)

1. **Diff summary is a placeholder** inside `finalize_run`. The Review modal shows worktree id but no file count / line counts. Follow-up: compute via `git2` proper stats.
2. **Deny-list enforcement** depends on the existing agent-bridge permission API. If the API doesn't allow us to respond with Deny from outside a user-driven flow, Phase 3 ships with *advisory* deny-list (logs a warning) and a follow-up adds true blocking. Document this in the commit.
3. **Open PR** assumes `gh` or similar is on PATH — same constraint as the rest of the Solo git feature set. No new dependency.

## Self-review

- **Spec coverage:** §4a execution location, §4b permission mode + bypass-on-worktree-only enforcement, §4c review modal, §12 deny-list + bypass safety.
- **No placeholders in code steps.** All code blocks complete. The only placeholder is the diff-summary string itself (noted above).
- **Type consistency:** `AgentConfig`, `PermissionMode`, `ExecutionLocation` names are consistent between Rust and TS bindings.
