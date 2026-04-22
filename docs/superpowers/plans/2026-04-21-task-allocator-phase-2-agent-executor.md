# Task Allocator — Phase 2 (Agent Executor, Main Workspace) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user click **Run** on an `executor=Agent` task and have it spawn an agent session against their main workspace. Stream run events into the task's history. When the session ends, update the task status to Done (success) or Failed.

**Architecture:** Add an `Executor` module in `solo-tasks` that calls the existing `create_session_internal` helper (from `agent_commands.rs`) and subscribes to the agent event stream. Each run creates a `TaskRun` row and emits `BackendEvent::TaskRunStarted/Progress/Ended`. Phase 2 stays on the **main workspace** (no worktree isolation yet — that's Phase 3) with `permission=ask` (user confirms tool uses). Result capture: last assistant message + derived outcome (`Succeeded` for `result`, `Failed` for `error`).

**Tech Stack:** Continues Phase 1 stack. No new deps.

**Spec reference:** `docs/superpowers/specs/2026-04-21-task-allocator-design.md` §4 (subsystem 4: Executor), §4.2 Path B.
**Phase 1 reference:** `docs/superpowers/plans/2026-04-21-task-allocator-phase-1-foundation.md`

---

## File map for Phase 2

**Create (Rust):**
- `apps/desktop/src-tauri/src/task_executor.rs` — spawn agent session + subscribe to events + write TaskRun rows.

**Modify (Rust):**
- `crates/solo-protocol/src/lib.rs` — add BackendEvent variants: `TaskRunStarted`, `TaskRunProgress`, `TaskRunEnded`.
- `crates/solo-tasks/src/store.rs` — add `create_run`, `end_run`, `update_run_summary` methods; migrate trigger for `task_runs` updates (already FK'd).
- `apps/desktop/src-tauri/src/task_commands.rs` — add `task_run(id)` and `task_cancel(id)` commands.
- `apps/desktop/src-tauri/src/lib.rs` — register new commands + (if needed) state for active run tracking.

**Create (TS):**
- `apps/desktop/src/components/vault/tasks/TaskRunsTab.tsx` — Runs tab in drawer; shows TaskRun history table.
- `apps/desktop/src/components/vault/tasks/RunButton.tsx` — "Run now" button (manual kick off; disabled for manual executor).

**Modify (TS):**
- `apps/desktop/src/bindings/**` — regen.
- `apps/desktop/src/lib/tauri/tasks.ts` — add `run`, `cancel` methods.
- `apps/desktop/src/stores/taskStore.ts` — track active runs: `runningTasks: Set<string>`; actions `run`, `cancel`.
- `apps/desktop/src/hooks/useTaskStream.ts` — listen to `TaskRunStarted/Progress/Ended` events; update store.
- `apps/desktop/src/components/vault/tasks/TaskDrawer.tsx` — add Tabs: Overview | Runs; wire Run button.
- `apps/desktop/src/components/vault/tasks/TaskRow.tsx` — show a subtle "running" indicator (pulsing dot) when task is in `runningTasks`.

---

## Task 1 · Add BackendEvent variants for run lifecycle

**File:** `crates/solo-protocol/src/lib.rs`

- [ ] **Step 1.1:** Locate the `BackendEvent` enum. Before the closing brace, add three variants:

```rust
    /// A task run started (task_id → run_id).
    #[serde(rename = "tasks:run_started")]
    TaskRunStarted { task_id: String, run_id: String },

    /// Incremental progress — summary text of latest event (truncated).
    #[serde(rename = "tasks:run_progress")]
    TaskRunProgress { task_id: String, run_id: String, summary: String },

    /// Terminal — the run ended with an outcome.
    #[serde(rename = "tasks:run_ended")]
    TaskRunEnded { task_id: String, run_id: String, outcome: RunOutcome, summary: Option<String> },
```

- [ ] **Step 1.2:** Regenerate bindings.
```bash
bun run gen:bindings
```
Verify `apps/desktop/src/bindings/BackendEvent.ts` contains `tasks:run_started`, `tasks:run_progress`, `tasks:run_ended`.

- [ ] **Step 1.3:** Commit.
```bash
git add crates/solo-protocol/src/lib.rs apps/desktop/src/bindings/BackendEvent.ts
git commit -m "feat(protocol): add TaskRun lifecycle events"
```

---

## Task 2 · Store methods for run rows

**File:** `crates/solo-tasks/src/store.rs`

Phase 1's schema already includes `task_runs` with FK to `tasks`. We add the method surface.

- [ ] **Step 2.1:** Add imports at top if missing (most are already there):
```rust
use solo_protocol::RunOutcome;
```

- [ ] **Step 2.2:** Inside `impl TaskStore`, add these methods (paste at the end of the `impl`, before the internal `insert`):

```rust
    /// Insert a new Running task_run, return its id.
    pub fn create_run(&self, task_id: &str) -> TaskResult<String> {
        let conn = self.conn.lock().expect("poisoned");
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO task_runs(id, task_id, started_at, outcome) VALUES(?,?,?,?)",
            params![id, task_id, now_ms(), run_outcome_str(RunOutcome::Running)],
        )?;
        Ok(id)
    }

    /// Stream a progress summary into the live run (overwrites summary).
    pub fn update_run_summary(&self, run_id: &str, summary: &str) -> TaskResult<()> {
        let conn = self.conn.lock().expect("poisoned");
        conn.execute(
            "UPDATE task_runs SET summary = ? WHERE id = ?",
            params![summary, run_id],
        )?;
        Ok(())
    }

    /// Mark a run ended with final outcome + summary.
    pub fn end_run(
        &self,
        run_id: &str,
        outcome: RunOutcome,
        summary: Option<&str>,
    ) -> TaskResult<()> {
        let conn = self.conn.lock().expect("poisoned");
        conn.execute(
            "UPDATE task_runs SET ended_at = ?, outcome = ?, summary = COALESCE(?, summary) WHERE id = ?",
            params![now_ms(), run_outcome_str(outcome), summary, run_id],
        )?;
        Ok(())
    }

    /// Resolve the task that owns a run.
    pub fn task_id_for_run(&self, run_id: &str) -> TaskResult<Option<String>> {
        let conn = self.conn.lock().expect("poisoned");
        let tid: Option<String> = conn.query_row(
            "SELECT task_id FROM task_runs WHERE id = ?",
            [run_id],
            |r| r.get(0),
        ).optional()?;
        Ok(tid)
    }
```

- [ ] **Step 2.3:** Locate the existing `#[allow(unused)] fn run_outcome_str` — remove the `#[allow(unused)]` since it's now used.

- [ ] **Step 2.4:** Add tests in `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn create_and_end_run_updates_outcome() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("x")).unwrap();
        let run_id = store.create_run(&t.id).unwrap();
        store.update_run_summary(&run_id, "halfway").unwrap();
        store.end_run(&run_id, RunOutcome::Succeeded, Some("done ok")).unwrap();
        let got = store.get(&t.id).unwrap();
        assert_eq!(got.runs.len(), 1);
        assert!(matches!(got.runs[0].outcome, RunOutcome::Succeeded));
        assert_eq!(got.runs[0].summary.as_deref(), Some("done ok"));
        assert!(got.runs[0].ended_at.is_some());
    }

    #[test]
    fn task_id_for_run_resolves() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("y")).unwrap();
        let run_id = store.create_run(&t.id).unwrap();
        assert_eq!(store.task_id_for_run(&run_id).unwrap().as_deref(), Some(t.id.as_str()));
        assert_eq!(store.task_id_for_run("nope").unwrap(), None);
    }
```

- [ ] **Step 2.5:** Test + clippy.
```bash
cargo test -p solo-tasks --lib
cargo clippy -p solo-tasks --all-targets -- -D warnings
```
Expected: 11 tests pass; clippy clean.

- [ ] **Step 2.6:** Commit.
```bash
git add crates/solo-tasks/src/store.rs
git commit -m "feat(tasks): TaskRun row lifecycle (create/update-summary/end)"
```

---

## Task 3 · `task_executor.rs` — agent session glue

**File:** `apps/desktop/src-tauri/src/task_executor.rs` (new)

This module is the heart of Phase 2. It spawns an agent session, stores a mapping `session_id → (task_id, run_id)`, and subscribes to the agent event stream to mutate the task store as events arrive.

- [ ] **Step 3.1:** Create `apps/desktop/src-tauri/src/task_executor.rs`:

```rust
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
        let message_type = message.get("type").and_then(|v| v.as_str()).unwrap_or("");

        let app__ = app_.clone();
        let store__ = store_.clone();
        let map__ = map_.clone();

        tauri::async_runtime::spawn(async move {
            let Some(run) = map__.get(&session_id).await else { return };

            match message_type {
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
                    finalize_run(&app__, &store__, &map__, &session_id, RunOutcome::Succeeded, Some(final_summary(&message))).await;
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
```

- [ ] **Step 3.2:** Verify `SessionManager` has `delete_session`. Check via:
```bash
grep -n "pub fn delete_session\|pub fn create_session\|pub fn send_message" apps/desktop/src-tauri/src/agent/
```
If `delete_session` doesn't exist with that exact signature, check the agent module for an equivalent (e.g., `terminate_session`, `close_session`) and adjust the call. If there's truly no session-termination API, the cancel-task path can't work — report BLOCKED.

- [ ] **Step 3.3:** Build check:
```bash
cargo check -p solo-desktop-lib
```
If it fails with import errors on `SessionManager` or `listen`/`Listener`, fix by importing the right types. The plan uses `tauri::Listener as _` for `.listen()` — verify the Tauri version exposes this. If not, use `app.listen_global` or similar, whichever the existing code uses.

- [ ] **Step 3.4:** Commit.
```bash
git add apps/desktop/src-tauri/src/task_executor.rs
git commit -m "feat(tasks): task executor module (Phase 2 main-workspace runs)"
```

---

## Task 4 · Wire Tauri commands `task_run` + `task_cancel`

**File:** `apps/desktop/src-tauri/src/task_commands.rs`

- [ ] **Step 4.1:** At the top, add imports:
```rust
use crate::task_executor::{spawn_agent_for_task, cancel_task, ExecutorMap};
use crate::agent::SessionManager;
```

- [ ] **Step 4.2:** Add two new commands at the bottom:

```rust
#[tauri::command]
pub async fn task_run(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
    executor_map: State<'_, Arc<ExecutorMap>>,
    session_manager: State<'_, Arc<SessionManager>>,
) -> Result<String, String> {
    let store = get_store(&state).await?;
    spawn_agent_for_task(
        &app,
        store,
        executor_map.inner().clone(),
        session_manager.inner().clone(),
        id,
    ).await
}

#[tauri::command]
pub async fn task_cancel(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
    executor_map: State<'_, Arc<ExecutorMap>>,
    session_manager: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    let store = get_store(&state).await?;
    cancel_task(
        &app,
        store,
        executor_map.inner().clone(),
        session_manager.inner().clone(),
        id,
    ).await
}
```

- [ ] **Step 4.3:** In `apps/desktop/src-tauri/src/lib.rs`:
  1. Add `mod task_executor;` alongside `mod task_commands;`.
  2. Import `use task_executor::ExecutorMap;`.
  3. Right after `.manage(task_commands::TaskState::new())`, add `.manage(ExecutorMap::new())`.
  4. Inside the `.setup(move |app| { ... })` closure, after other setup work, add:
     ```rust
     let app_handle = app.handle().clone();
     let task_state = app_handle.state::<task_commands::TaskState>();
     // Eagerly open the store so listeners can mutate it
     tauri::async_runtime::block_on(async {
         if let Ok(store) = task_commands::get_store_for_setup(&app_handle).await {
             let map = app_handle.state::<Arc<ExecutorMap>>().inner().clone();
             task_executor::install_agent_listeners(&app_handle, store, map);
         }
     });
     drop(task_state);
     ```
     **NOTE:** `task_commands::get_store_for_setup` does not exist yet. Add a minimal helper in `task_commands.rs`:
     ```rust
     /// Public getter for setup-time store open (avoids State<'_> lifetime from setup context).
     pub async fn get_store_for_setup(app: &AppHandle) -> Result<Arc<TaskStore>, String> {
         use tauri::Manager as _;
         let state = app.state::<TaskState>();
         get_store(&state).await
     }
     ```
  5. Add the two new commands to `generate_handler![]`:
     ```rust
     task_commands::task_run,
     task_commands::task_cancel,
     ```

- [ ] **Step 4.4:** Build.
```bash
cargo check -p solo-desktop-lib
```

- [ ] **Step 4.5:** Commit.
```bash
git add apps/desktop/src-tauri/src/task_commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(tasks): task_run + task_cancel commands wired to executor"
```

---

## Task 5 · TS wrapper + store run-tracking

**Files:**
- `apps/desktop/src/lib/tauri/tasks.ts`
- `apps/desktop/src/stores/taskStore.ts`

- [ ] **Step 5.1:** In `lib/tauri/tasks.ts`, add two methods to `tasksApi`:

```ts
  run:    (id: string) => invoke<string>('task_run',    { id }),
  cancel: (id: string) => invoke<void>  ('task_cancel', { id }),
```

- [ ] **Step 5.2:** In `stores/taskStore.ts`, extend the state interface:

```ts
  runningTasks: Set<string>;
```

Initialize `runningTasks: new Set()` in the initial state.

Add actions:
```ts
  run: async (id: string) => {
    await tasksApi.run(id);
    // Store will be patched by TaskRunStarted event hook
  },
  cancel: async (id: string) => {
    await tasksApi.cancel(id);
  },
  markRunning: (id: string, running: boolean) => {
    set((s) => {
      if (running) s.runningTasks.add(id);
      else s.runningTasks.delete(id);
    });
  },
```

- [ ] **Step 5.3:** Typecheck.
```bash
bun run check
```

- [ ] **Step 5.4:** Commit.
```bash
git add apps/desktop/src/lib/tauri/tasks.ts apps/desktop/src/stores/taskStore.ts
git commit -m "feat(tasks): TS run/cancel + running-task tracking"
```

---

## Task 6 · Event hook handles run lifecycle

**File:** `apps/desktop/src/hooks/useTaskStream.ts`

- [ ] **Step 6.1:** Replace the hook's `if` check with a switch handling all 4 event kinds. New content:

```ts
import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BackendEvent } from '@/bindings/BackendEvent';
import { useTaskStore } from '@/stores/taskStore';

export function useTaskStream(): void {
  const patchFromEvent = useTaskStore((s) => s.patchFromEvent);
  const markRunning = useTaskStore((s) => s.markRunning);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    const setup = async () => {
      unlisten = await listen<BackendEvent>('backend-event', (e) => {
        const ev = e.payload;
        switch (ev.type) {
          case 'tasks:changed':
            void patchFromEvent(ev.payload.task_ids);
            break;
          case 'tasks:run_started':
            markRunning(ev.payload.task_id, true);
            void patchFromEvent([ev.payload.task_id]);
            break;
          case 'tasks:run_progress':
            void patchFromEvent([ev.payload.task_id]);
            break;
          case 'tasks:run_ended':
            markRunning(ev.payload.task_id, false);
            void patchFromEvent([ev.payload.task_id]);
            break;
          default:
            break;
        }
      });
    };
    void setup();
    return () => { unlisten?.(); };
  }, [patchFromEvent, markRunning]);
}
```

- [ ] **Step 6.2:** Typecheck.
```bash
bun run check
```

- [ ] **Step 6.3:** Commit.
```bash
git add apps/desktop/src/hooks/useTaskStream.ts
git commit -m "feat(tasks): hook listens for run lifecycle events"
```

---

## Task 7 · `RunButton` component

**File:** `apps/desktop/src/components/vault/tasks/RunButton.tsx` (new)

- [ ] **Step 7.1:** Create the file:

```tsx
import { useState, type FC } from 'react';
import { Play, Square, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Task } from '@/lib/tauri/tasks';

interface Props {
  readonly task: Task;
}

export const RunButton: FC<Props> = ({ task }) => {
  const run = useTaskStore((s) => s.run);
  const cancel = useTaskStore((s) => s.cancel);
  const isRunning = useTaskStore((s) => s.runningTasks.has(task.id));
  const [busy, setBusy] = useState(false);

  if (task.executor !== 'agent') return null;

  const onClick = async () => {
    setBusy(true);
    try {
      if (isRunning) await cancel(task.id);
      else await run(task.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium',
        'border border-border/60 bg-card hover:bg-muted/60 disabled:opacity-50',
        isRunning ? 'text-red-500' : 'text-foreground',
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
       isRunning ? <Square className="h-3.5 w-3.5" /> :
                   <Play className="h-3.5 w-3.5" />}
      <span>{isRunning ? 'Cancel run' : 'Run now'}</span>
    </button>
  );
};
```

- [ ] **Step 7.2:** Typecheck + commit.
```bash
bun run check
git add apps/desktop/src/components/vault/tasks/RunButton.tsx
git commit -m "feat(tasks): Run/Cancel button for agent tasks"
```

---

## Task 8 · `TaskRunsTab` component

**File:** `apps/desktop/src/components/vault/tasks/TaskRunsTab.tsx` (new)

- [ ] **Step 8.1:** Create:

```tsx
import type { FC } from 'react';
import { cn } from '@/lib/utils';
import type { Task, TaskRun } from '@/lib/tauri/tasks';

interface Props {
  readonly task: Task;
}

const OUTCOME_STYLE: Record<TaskRun['outcome'], string> = {
  running:   'bg-blue-500/15   text-blue-500   border-blue-500/30',
  succeeded: 'bg-green-500/15  text-green-500  border-green-500/30',
  failed:    'bg-red-500/15    text-red-500    border-red-500/30',
  cancelled: 'bg-muted/40      text-muted-foreground border-border/50',
};

export const TaskRunsTab: FC<Props> = ({ task }) => {
  if (!task.runs?.length) {
    return (
      <div className="p-4 text-[12px] text-muted-foreground">
        No runs yet. Click <em>Run now</em> to start one.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2 p-3">
      {task.runs.map((r) => (
        <li key={r.id} className="rounded-md border border-border/50 bg-card p-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className={cn(
              'rounded-full border px-2 py-0.5 font-medium uppercase tracking-wider',
              OUTCOME_STYLE[r.outcome],
            )}>
              {r.outcome}
            </span>
            <span className="tabular-nums">
              {fmtTime(r.started_at)}
              {r.ended_at && ` → ${fmtTime(r.ended_at)}`}
            </span>
          </div>
          {r.summary && (
            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[12px] text-foreground">
              {r.summary}
            </p>
          )}
          {r.session_id && (
            <div className="mt-1 text-[10px] text-muted-foreground">
              Session: <code className="rounded bg-muted/40 px-1">{r.session_id}</code>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
};

function fmtTime(ms: number | bigint): string {
  const d = new Date(typeof ms === 'bigint' ? Number(ms) : ms);
  return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}
```

- [ ] **Step 8.2:** Typecheck + commit.
```bash
bun run check
git add apps/desktop/src/components/vault/tasks/TaskRunsTab.tsx
git commit -m "feat(tasks): TaskRunsTab — run history list"
```

---

## Task 9 · Drawer tabs (Overview / Runs) + wire RunButton

**File:** `apps/desktop/src/components/vault/tasks/TaskDrawer.tsx`

- [ ] **Step 9.1:** Add a simple tab state and split the body. Replace the drawer's body section:

```tsx
import { useState } from 'react';
// (keep existing imports) + add:
import { RunButton } from './RunButton';
import { TaskRunsTab } from './TaskRunsTab';

type DrawerTab = 'overview' | 'runs';
```

Inside the component, add `const [tab, setTab] = useState<DrawerTab>('overview');`. In the header (next to Title/status `<Detail>` block), add Run button:

```tsx
{task.executor === 'agent' && <RunButton task={task} />}
```

Below the header, add a tab bar:

```tsx
<nav className="flex shrink-0 gap-1 border-b border-border/50 px-3 py-1.5">
  {(['overview', 'runs'] as const).map((t) => (
    <button
      key={t}
      type="button"
      onClick={() => setTab(t)}
      className={cn(
        'rounded-md px-2.5 py-1 text-[11px] font-medium capitalize',
        tab === t ? 'bg-card text-foreground border border-border/70' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {t}
      {t === 'runs' && task.runs?.length ? ` · ${task.runs.length}` : ''}
    </button>
  ))}
</nav>
```

Wrap the existing Overview content (title/desc/status/priority) in `{tab === 'overview' && (...)}`, and add `{tab === 'runs' && <TaskRunsTab task={task} />}`.

- [ ] **Step 9.2:** Typecheck + commit.
```bash
bun run check
git add apps/desktop/src/components/vault/tasks/TaskDrawer.tsx
git commit -m "feat(tasks): drawer tabs (Overview / Runs) + Run button"
```

---

## Task 10 · Row shows "running" indicator

**File:** `apps/desktop/src/components/vault/tasks/TaskRow.tsx`

- [ ] **Step 10.1:** Read the current row. Find the status icon block. After the status icon span, add a small pulsing dot when the task is running:

```tsx
const isRunning = useTaskStore((s) => s.runningTasks.has(task.id));

// (inside the row JSX, near the executor glyph)
{isRunning && (
  <span className="grid h-2 w-2 shrink-0 place-items-center" aria-label="Running">
    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
  </span>
)}
```

Import `useTaskStore` if not already imported.

- [ ] **Step 10.2:** Typecheck + commit.
```bash
bun run check
git add apps/desktop/src/components/vault/tasks/TaskRow.tsx
git commit -m "feat(tasks): pulsing dot on running task rows"
```

---

## Task 11 · Smoke test Phase 2

- [ ] **Step 11.1:** Launch `bun run dev`.
- [ ] **Step 11.2:** Open Vault → Tasks. Create a new task, executor=**Agent**, title="list the files in this repo and count them", priority=Medium.
- [ ] **Step 11.3:** Open the drawer. Expect: Run button visible in header.
- [ ] **Step 11.4:** Click **Run now**. Expect:
  - Pulsing blue dot appears on the row.
  - Task status flips to "Running" (moves groups if grouped by status).
  - Switch to Runs tab — see a "RUNNING" card appear.
  - Agent prompts you for permissions (tool uses) as it runs — confirm as needed.
  - When agent finishes, Runs card flips to SUCCEEDED with summary.
  - Task row status becomes Done.
- [ ] **Step 11.5:** Repeat but cancel mid-run. Expect: status → Failed (Phase 2 conflates cancel with Failed bucket; Phase 3 will add proper Cancelled visual).
- [ ] **Step 11.6:** Close + relaunch. Expect: run history persists in drawer's Runs tab.

---

## Task 12 · Wrap up

- [ ] **Step 12.1:** Run full checks.
```bash
cargo test --workspace --lib
cargo clippy -p solo-tasks --all-targets -- -D warnings
bun run check
```
All green.

- [ ] **Step 12.2:** Mark Phase 2 complete in spec (§15).

Change:
```
| **2 · Agent executor (main workspace)** | Executor for `executor=Agent, execution=main, permission=ask`; ...
```
to prepend `✅` and add a shipped-on line.

- [ ] **Step 12.3:** Commit.
```bash
git add docs/superpowers/specs/2026-04-21-task-allocator-design.md
git commit -m "docs(specs): mark Task Allocator Phase 2 complete"
```

---

## Self-review

- **Spec coverage:** §4 Executor subsystem, §4.2 Path B manual agent run, §6 `task_run`/`task_cancel` commands, §6 `TaskRun*` events.
- **Phase 2 intentionally skips:** worktree isolation (Phase 3), deny-list (Phase 3), permission-mode override (Phase 3), review modal (Phase 3).
- **Known gap:** The `install_agent_listeners` implementation deserializes `agent:message` via `serde_json::from_str(event.payload())`. Verify this is how Tauri delivers `Listener` payloads; if it's already `Value`, adjust. The test in Step 11 will surface any mismatch.
- **No placeholders.** Every code block is complete.
