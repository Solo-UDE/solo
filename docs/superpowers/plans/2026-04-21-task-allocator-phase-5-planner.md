# Task Allocator — Phase 5 (Planner LLM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User types a goal ("ship the billing dashboard this week") into a "New Plan" dialog. The planner reads the 6-source context bundle, calls an LLM, and drops N `TaskStatus::Suggested` drafts into the board. User accepts (→ `Queued`) or dismisses (→ deleted). A proactive hook runs the same pipeline after an agent session ends, rate-limited to 1 per 10 min.

**Architecture:** `ContextAggregator` trait in `solo-tasks` with providers for Vault/Skills/Git/Tasks/Notes; the `Planner` module calls `agent_create_session` with a JSON-mode-style prompt and parses the returned JSON into `TaskDraft`s. Settings get a `planner_notes` freeform text field. Proactive firing uses the `agent:message` event interceptor (Phase 2) — when an `AgentSessionEnded` event arrives *and* it's not from a planner-spawned session, tick a token bucket and fire `plan_proactive()` if allowed.

**Tech Stack:** No new crates. Reuses existing agent-bridge + provider auth. Simple in-memory rate limiter.

**Spec reference:** `docs/superpowers/specs/2026-04-21-task-allocator-design.md` §4 Planner subsystem, §3 context bundle decision, §4.2 Path A + C, §4.3 rate limiter.

---

## Scope cut

Phase 5 intentionally **ships 4 of 6 context providers** (Vault, Skills, Git, Existing tasks). Sessions and Planner-notes land in Phase 6 polish. Command palette entry also deferred to Phase 6.

---

## File map

**Create (Rust):**
- `crates/solo-tasks/src/context/mod.rs` — trait + orchestrator.
- `crates/solo-tasks/src/context/fragment.rs` — `ContextFragment` type + token-estimate helper.
- `apps/desktop/src-tauri/src/task_planner.rs` — Tauri-side planner that assembles context via existing Tauri state and calls the LLM.

**Modify (Rust):**
- `crates/solo-tasks/src/lib.rs` — export context module.
- `apps/desktop/src-tauri/src/task_commands.rs` — `plan_from_goal`, `plan_accept_draft`, `plan_dismiss_draft`, `plan_proactive`.
- `apps/desktop/src-tauri/src/task_executor.rs` — install a second listener for proactive hook; rate-limit gate.
- `apps/desktop/src-tauri/src/lib.rs` — register new commands; no new state.

**Create (TS):**
- `apps/desktop/src/components/vault/tasks/NewPlanDialog.tsx` — LLM goal dialog.

**Modify (TS):**
- `apps/desktop/src/lib/tauri/tasks.ts` — 4 new wrappers.
- `apps/desktop/src/stores/taskStore.ts` — `planFromGoal`, `acceptDraft`, `dismissDraft` actions.
- `apps/desktop/src/components/vault/tasks/FiltersBar.tsx` — add "✨ New Plan" button.
- `apps/desktop/src/components/sidebar/vault/TasksSection.tsx` — mount `NewPlanDialog`; wire open-state.
- `apps/desktop/src/components/vault/tasks/TaskRow.tsx` — Accept/Dismiss inline actions for `Suggested` rows.

---

## Task 1 · `ContextFragment` + trait skeleton

**Files:**
- `crates/solo-tasks/src/context/fragment.rs` (new)
- `crates/solo-tasks/src/context/mod.rs` (new)
- `crates/solo-tasks/src/lib.rs`

- [ ] **Step 1.1:** Create `crates/solo-tasks/src/context/fragment.rs`:

```rust
//! A single fragment of context supplied to the planner.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextFragment {
    /// Which source produced this fragment (vault, skills, git, tasks, notes, sessions).
    pub source: String,
    /// Human-readable body — will be concatenated into the LLM prompt.
    pub content: String,
    /// Rough token estimate (`content.len() / 4`).
    pub token_estimate: usize,
}

impl ContextFragment {
    pub fn new(source: impl Into<String>, content: impl Into<String>) -> Self {
        let content = content.into();
        let token_estimate = content.len() / 4;
        Self { source: source.into(), content, token_estimate }
    }
}
```

- [ ] **Step 1.2:** Create `crates/solo-tasks/src/context/mod.rs`:

```rust
//! Context aggregator — pluggable providers that supply context fragments.

pub mod fragment;
pub use fragment::ContextFragment;

/// Bundle of provider keys the caller wants aggregated. Identifies string
/// names ("vault", "skills", "git", "tasks", "notes", "sessions") — the
/// actual provider implementations live in the Tauri layer because they
/// need access to Tauri State (store, worktree state, agent sessions, etc.)
/// that a pure Rust crate can't reference.
pub type Bundle = Vec<String>;

pub const DEFAULT_BUNDLE: &[&str] = &["vault", "skills", "git", "tasks"];

/// Total token budget for a single planner call. Fragments beyond this are truncated.
pub const DEFAULT_TOKEN_BUDGET: usize = 8000;

/// Format a list of fragments into a prompt string. Applies a per-fragment
/// header so the LLM knows where each piece came from.
pub fn render_prompt(goal: &str, fragments: &[ContextFragment]) -> String {
    let mut out = String::new();
    out.push_str("You are the Solo Task Allocator's planner.\n\n");
    out.push_str("GOAL: ");
    out.push_str(goal);
    out.push_str("\n\n");
    out.push_str("CONTEXT:\n");
    for f in fragments {
        out.push_str(&format!("\n--- {} ---\n{}\n", f.source, f.content));
    }
    out.push_str("\n\nINSTRUCTIONS:\n");
    out.push_str("Decompose the goal into 3-7 concrete tasks. Return ONLY a JSON array with this shape:\n");
    out.push_str(r#"[
  {
    "title": "short imperative title",
    "description": "2-3 sentence context — what + why",
    "executor": "manual" | "agent",
    "priority": "low" | "medium" | "high" | "urgent"
  }
]"#);
    out.push_str("\n\nOutput ONLY the JSON array, no prose, no markdown fences.\n");
    out
}

/// Trim fragments to fit a token budget. Keeps earliest fragments in order.
pub fn trim_to_budget(mut fragments: Vec<ContextFragment>, budget: usize) -> Vec<ContextFragment> {
    let mut running = 0;
    let mut cutoff = fragments.len();
    for (i, f) in fragments.iter().enumerate() {
        running += f.token_estimate;
        if running > budget {
            cutoff = i;
            break;
        }
    }
    fragments.truncate(cutoff);
    fragments
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_prompt_contains_goal_and_fragments() {
        let fragments = vec![
            ContextFragment::new("vault", "entry A"),
            ContextFragment::new("skills", "git skill"),
        ];
        let p = render_prompt("ship billing", &fragments);
        assert!(p.contains("ship billing"));
        assert!(p.contains("--- vault ---"));
        assert!(p.contains("entry A"));
        assert!(p.contains("JSON array"));
    }

    #[test]
    fn trim_to_budget_drops_overflow() {
        // Each fragment has content.len()/4 tokens. Make 3 fragments, each ~100 tokens.
        let f = |n: usize| ContextFragment::new("x", "a".repeat(n * 4));
        let frags = vec![f(100), f(100), f(100)];
        let trimmed = trim_to_budget(frags, 150);
        assert_eq!(trimmed.len(), 1); // 100 fits, second would push to 200 > 150
    }
}
```

- [ ] **Step 1.3:** Register in `crates/solo-tasks/src/lib.rs`:
```rust
pub mod context;
pub use context::{ContextFragment, render_prompt, trim_to_budget, DEFAULT_BUNDLE, DEFAULT_TOKEN_BUDGET};
```

- [ ] **Step 1.4:** `cargo test -p solo-tasks --lib` — expect 28 tests pass (26 + 2 new).
`cargo clippy -p solo-tasks --all-targets -- -D warnings` clean.

- [ ] **Step 1.5:** Commit:
```bash
git add crates/solo-tasks/src/context/ crates/solo-tasks/src/lib.rs
git commit -m "feat(tasks): context aggregator core (fragment + prompt rendering)"
```

---

## Task 2 · Tauri-side planner module

**File:** `apps/desktop/src-tauri/src/task_planner.rs` (new)

This is where the provider implementations live (needing Tauri state), plus the actual LLM call.

- [ ] **Step 2.1:**

```rust
//! Task planner — Tauri-side orchestrator.
//!
//! Gathers context fragments from available providers, renders a prompt,
//! drives an agent_create_session call with a JSON-mode prompt, parses
//! the response, and inserts Suggested tasks.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use solo_protocol::{Executor, TaskDraft, TaskPatch, TaskPriority, TaskStatus};
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
            if now.duration_since(t) < self.min_interval { return false; }
        }
        *last = Some(now);
        true
    }
}

impl Default for ProactiveGate {
    fn default() -> Self {
        Self { last_fire: Mutex::new(None), min_interval: Duration::from_secs(10 * 60) }
    }
}

// --- Providers (all async, all return Vec<ContextFragment>) ------------------

pub async fn collect_vault_fragment(app: &AppHandle) -> Option<ContextFragment> {
    let vault_state = app.state::<crate::vault_commands::VaultState>();
    // Use whatever read-only list/search API the vault exposes. We grab the
    // most recent N entries as a proxy for "what the user is focused on".
    //
    // Signature-wise: we need an Arc<solo_vault::Vault>. The Vault impls a
    // list method we can call directly, not via a Tauri command.
    let guard = vault_state.inner.read().await;
    let Some(vault) = guard.as_ref() else { return None; };

    let filters = solo_protocol::VaultListFilters::default();
    let entries = vault.list(&filters).ok()?;
    let top = entries.into_iter().take(10).collect::<Vec<_>>();
    if top.is_empty() { return None; }
    let body = top.iter()
        .map(|e| format!("- {}: {}", e.title, e.preview.as_deref().unwrap_or("")))
        .collect::<Vec<_>>()
        .join("\n");
    Some(ContextFragment::new("vault", body))
}

pub async fn collect_skills_fragment(app: &AppHandle) -> Option<ContextFragment> {
    // Skills surface is large — we just want names + brief descriptions.
    // The simplest path: shell out to the existing skills listing command.
    // If the Tauri command call is fragile, fall back to reading the two
    // skill directories (solo + adapter) directly.
    let body = match crate::skills_commands::skills_list_available_internal(app).await {
        Ok(skills) => skills.iter()
            .map(|s| format!("- {}: {}", s.name, s.description.as_deref().unwrap_or("")))
            .collect::<Vec<_>>()
            .join("\n"),
        Err(_) => return None,
    };
    if body.is_empty() { return None; }
    Some(ContextFragment::new("skills", body))
}

pub async fn collect_git_fragment(app: &AppHandle) -> Option<ContextFragment> {
    // Current branch + last 5 commits. Use existing git command internals
    // if they expose non-Tauri APIs; otherwise fall back to git2 directly
    // on fs_commands' repo path.
    let fs_state = app.state::<crate::fs_commands::FsState>();
    let root = fs_state.current_workspace_root().await.ok()??;
    let repo = git2::Repository::open(&root).ok()?;
    let head = repo.head().ok()?;
    let branch = head.shorthand().unwrap_or("?").to_string();

    let mut revwalk = repo.revwalk().ok()?;
    revwalk.push_head().ok()?;
    let commits: Vec<String> = revwalk.take(5).filter_map(|oid| {
        let oid = oid.ok()?;
        let commit = repo.find_commit(oid).ok()?;
        Some(format!("{} {}", &oid.to_string()[..8], commit.summary().unwrap_or("")))
    }).collect();

    let body = format!("Current branch: {}\nRecent commits:\n{}",
        branch,
        commits.join("\n"),
    );
    Some(ContextFragment::new("git", body))
}

pub async fn collect_tasks_fragment(store: &Arc<TaskStore>) -> Option<ContextFragment> {
    let existing = store.list(&solo_protocol::TaskListFilters::default()).ok()?;
    let open: Vec<_> = existing.into_iter()
        .filter(|t| !matches!(t.status, TaskStatus::Done | TaskStatus::Archived))
        .take(20)
        .collect();
    if open.is_empty() { return None; }
    let body = open.iter()
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
            "vault"          => collect_vault_fragment(app).await,
            "skills"         => collect_skills_fragment(app).await,
            "git"            => collect_git_fragment(app).await,
            "tasks" | "existing_tasks" => collect_tasks_fragment(&store).await,
            _ => None, // Phase 5 providers end here; "sessions" + "notes" in Phase 6
        };
        if let Some(f) = frag { fragments.push(f); }
    }
    fragments = trim_to_budget(fragments, DEFAULT_TOKEN_BUDGET);

    info!(n_fragments = fragments.len(), "running planner");

    let prompt = render_prompt(&goal, &fragments);

    // Spawn a one-shot session to get the LLM response
    let session_id = uuid::Uuid::new_v4().to_string();
    session_manager.create_session(&session_id, None)
        .map_err(|e| format!("planner session: {e}"))?;
    session_manager.send_message(&session_id, &prompt, None)
        .map_err(|e| format!("planner prompt: {e}"))?;

    // Wait for the session to complete — we collect agent:message events and
    // look for a `result` message. For Phase 5 we use a simple timed poll.
    let raw = wait_for_result(app, &session_id, Duration::from_secs(60)).await
        .ok_or_else(|| "planner timed out".to_string())?;

    // Kill the session (it's one-shot)
    let _ = session_manager.delete_session(&session_id);

    // Parse drafts
    let drafts = parse_drafts(&raw)?;
    let mut ids = Vec::new();
    for d in drafts {
        let task = store.create(TaskDraft {
            title: d.title,
            description: d.description,
            executor: d.executor,
            priority: d.priority,
        }).map_err(|e| e.to_string())?;
        // Promote to Suggested status (create defaults to Queued)
        store.update(&task.id, TaskPatch {
            status: Some(TaskStatus::Suggested),
            ..Default::default()
        }).map_err(|e| e.to_string())?;
        ids.push(task.id);
    }
    Ok(ids)
}

// Wait for an agent:message with type=result for this session.
async fn wait_for_result(app: &AppHandle, session_id: &str, timeout: Duration) -> Option<String> {
    use tauri::Listener as _;
    let (tx, mut rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Arc::new(Mutex::new(Some(tx)));
    let sid = session_id.to_string();
    let handle = app.listen("agent:message", move |event| {
        let tx_c = tx.clone();
        let sid_c = sid.clone();
        let payload = event.payload().to_string();
        tauri::async_runtime::spawn(async move {
            let Ok(v): Result<serde_json::Value, _> = serde_json::from_str(&payload) else { return };
            let Some(msg_session) = v.get("sessionId").and_then(|x| x.as_str()) else { return };
            if msg_session != sid_c { return; }
            let Some(msg) = v.get("message") else { return };
            if msg.get("type").and_then(|x| x.as_str()) != Some("result") { return; }
            let result_str = msg.get("result").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if let Some(tx) = tx_c.lock().await.take() {
                let _ = tx.send(result_str);
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
        .trim_start_matches("```json").trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    serde_json::from_str::<Vec<RawDraft>>(cleaned)
        .map_err(|e| format!("planner returned invalid JSON: {e} / raw: {cleaned}"))
}
```

- [ ] **Step 2.2:** Add `mod task_planner;` to `apps/desktop/src-tauri/src/lib.rs` next to `task_executor`.

- [ ] **Step 2.3:** Verify needed dependencies. Checks to run:
```bash
grep "git2" apps/desktop/src-tauri/Cargo.toml
grep "fn list" crates/solo-vault/src/lib.rs  # confirm Vault::list exists
grep "skills_list_available_internal" apps/desktop/src-tauri/src/skills_commands.rs
grep "fn current_workspace_root" apps/desktop/src-tauri/src/fs_commands.rs
```

Adjust any API call that doesn't match. If a helper function doesn't exist, replace with the closest existing command invoked directly from Rust (not via Tauri). Fall back gracefully — if a provider can't gather its fragment, it returns `None` and the planner just runs with fewer fragments.

- [ ] **Step 2.4:** `cargo check -p solo-desktop-lib` — zero errors.

- [ ] **Step 2.5:** Commit:
```bash
git add apps/desktop/src-tauri/src/task_planner.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(tasks): planner module with 4 context providers + JSON drafts"
```

---

## Task 3 · Planner commands

**File:** `apps/desktop/src-tauri/src/task_commands.rs`

- [ ] **Step 3.1:** Add imports:
```rust
use crate::task_planner::{plan_from_goal as planner_run, ProactiveGate};
```

- [ ] **Step 3.2:** Append commands:

```rust
#[tauri::command]
pub async fn plan_from_goal(
    goal: String,
    context_override: Option<Vec<String>>,
    app: AppHandle,
    state: State<'_, TaskState>,
    session_manager: State<'_, Arc<SessionManager>>,
) -> Result<Vec<String>, String> {
    let store = get_store(&state).await?;
    let bundle = context_override.unwrap_or_default();
    let draft_ids = planner_run(
        &app,
        store,
        session_manager.inner().clone(),
        goal,
        bundle,
    ).await?;
    let _ = app.emit("backend-event", solo_protocol::BackendEvent::TasksChanged {
        task_ids: draft_ids.clone(),
    });
    Ok(draft_ids)
}

#[tauri::command]
pub async fn plan_accept_draft(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<(), String> {
    let store = get_store(&state).await?;
    store.update(&id, solo_protocol::TaskPatch {
        status: Some(solo_protocol::TaskStatus::Queued),
        ..Default::default()
    }).map_err(|e| e.to_string())?;
    let _ = app.emit("backend-event", solo_protocol::BackendEvent::TasksChanged {
        task_ids: vec![id],
    });
    Ok(())
}

#[tauri::command]
pub async fn plan_dismiss_draft(
    id: String,
    app: AppHandle,
    state: State<'_, TaskState>,
) -> Result<(), String> {
    let store = get_store(&state).await?;
    store.delete(&id).map_err(|e| e.to_string())?;
    let _ = app.emit("backend-event", solo_protocol::BackendEvent::TasksChanged {
        task_ids: vec![id],
    });
    Ok(())
}

#[tauri::command]
pub async fn plan_proactive(
    app: AppHandle,
    state: State<'_, TaskState>,
    session_manager: State<'_, Arc<SessionManager>>,
    gate: State<'_, Arc<ProactiveGate>>,
) -> Result<Vec<String>, String> {
    if !gate.try_fire().await {
        return Err("proactive planner rate-limited (10 min min)".into());
    }
    let store = get_store(&state).await?;
    let draft_ids = planner_run(
        &app,
        store,
        session_manager.inner().clone(),
        "Based on my recent activity, suggest 3 useful next tasks.".to_string(),
        Vec::new(), // use default bundle
    ).await?;
    let _ = app.emit("backend-event", solo_protocol::BackendEvent::TasksChanged {
        task_ids: draft_ids.clone(),
    });
    Ok(draft_ids)
}
```

- [ ] **Step 3.3:** In `lib.rs`:
1. `.manage(crate::task_planner::ProactiveGate::new())` alongside other state registrations.
2. Register 4 commands in `generate_handler![]`:
```rust
task_commands::plan_from_goal,
task_commands::plan_accept_draft,
task_commands::plan_dismiss_draft,
task_commands::plan_proactive,
```

- [ ] **Step 3.4:** `cargo check -p solo-desktop-lib` zero errors.

- [ ] **Step 3.5:** Commit:
```bash
git add apps/desktop/src-tauri/src/task_commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(tasks): planner commands (from_goal / accept / dismiss / proactive)"
```

---

## Task 4 · Install proactive hook on session-end

**File:** `apps/desktop/src-tauri/src/task_executor.rs`

- [ ] **Step 4.1:** In `install_agent_listeners`, add a second listener block after the existing `agent:message` listener — this one watches for `type=result` on sessions NOT registered with `ExecutorMap` (i.e., sessions outside the task-run system), and fires `plan_proactive` when the rate-limiter allows.

Find the `agent:message` listener's closure. Add this logic inside — when `message_type == "result"` AND the session_id is NOT in `executor_map`, we kick the proactive planner. Something like:

```rust
// Inside the existing agent:message listener's tauri::async_runtime::spawn block,
// after the existing `if let Some(run) = map__.get(&session_id).await ...` branch
// for finalize_run, add an `else { ... }` for unmanaged sessions:
if message_type == "result" {
    if map__.get(&session_id).await.is_none() {
        // This session belongs to something else (e.g., the user's main agent).
        // Check proactive gate.
        use tauri::Manager as _;
        let gate = app__.state::<std::sync::Arc<crate::task_planner::ProactiveGate>>().inner().clone();
        if gate.try_fire().await {
            tracing::info!("proactive planner: firing after session-end");
            // Invoke the Tauri command for uniform error-handling / event emission
            let _ = app__.emit("backend-event", serde_json::json!({"type":"planner:proactive_triggered"}));
            // Fire-and-forget actual run via the planner
            let store_res = crate::task_commands::get_store_for_setup(&app__).await;
            if let Ok(store) = store_res {
                let sess_mgr = app__.state::<std::sync::Arc<crate::agent::SessionManager>>().inner().clone();
                let app_cloned = app__.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::task_planner::plan_from_goal(
                        &app_cloned, store, sess_mgr,
                        "Suggest 3 follow-up tasks based on my recent work.".to_string(),
                        vec![],
                    ).await;
                });
            }
        } else {
            tracing::debug!("proactive planner: rate-limited");
        }
    }
}
```

**Placement note:** Add this INSIDE the existing listener closure's inner task, around the existing switch on message_type. If the existing structure doesn't have that shape, adapt carefully — the key is: a `result` event on a session NOT in executor_map → trigger `plan_proactive` via the rate-limited path.

- [ ] **Step 4.2:** `cargo check -p solo-desktop-lib` zero errors.

- [ ] **Step 4.3:** Commit:
```bash
git add apps/desktop/src-tauri/src/task_executor.rs
git commit -m "feat(tasks): proactive planner triggered on non-task session-end"
```

---

## Task 5 · TS wrappers + store actions

**Files:**
- `apps/desktop/src/lib/tauri/tasks.ts`
- `apps/desktop/src/stores/taskStore.ts`

- [ ] **Step 5.1:** Add to `tasks.ts`:
```ts
  planFromGoal:    (goal: string, contextOverride?: string[]) =>
    invoke<string[]>('plan_from_goal', { goal, contextOverride: contextOverride ?? null }),
  planAcceptDraft: (id: string) => invoke<void>('plan_accept_draft', { id }),
  planDismissDraft:(id: string) => invoke<void>('plan_dismiss_draft', { id }),
  planProactive:   () => invoke<string[]>('plan_proactive'),
```

- [ ] **Step 5.2:** In `taskStore.ts`, add actions:
```ts
  planFromGoal: async (goal: string, contextOverride?: string[]): Promise<string[]> => {
    return await tasksApi.planFromGoal(goal, contextOverride);
  },
  acceptDraft: async (id: string) => { await tasksApi.planAcceptDraft(id); },
  dismissDraft: async (id: string) => { await tasksApi.planDismissDraft(id); },
```

Declare in state interface.

- [ ] **Step 5.3:** `bun run check` zero errors.
- [ ] **Step 5.4:** Commit:
```bash
git add apps/desktop/src/lib/tauri/tasks.ts apps/desktop/src/stores/taskStore.ts
git commit -m "feat(tasks): TS planner API + store actions"
```

---

## Task 6 · `NewPlanDialog` component

**File:** `apps/desktop/src/components/vault/tasks/NewPlanDialog.tsx` (new)

- [ ] **Step 6.1:**

```tsx
import { useState, type FC, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';

const SOURCES = [
  { id: 'vault',  label: 'Vault entries' },
  { id: 'skills', label: 'Skills' },
  { id: 'git',    label: 'Git state' },
  { id: 'tasks',  label: 'Existing tasks' },
] as const;

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

export const NewPlanDialog: FC<Props> = ({ open, onClose }) => {
  const planFromGoal = useTaskStore((s) => s.planFromGoal);
  const [goal, setGoal] = useState('');
  const [bundle, setBundle] = useState<readonly string[]>(() => SOURCES.map((s) => s.id));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) return;
    setBusy(true); setErr(null);
    try {
      const ids = await planFromGoal(goal.trim(), bundle as string[]);
      if (ids.length === 0) setErr('Planner returned no drafts. Try a more specific goal.');
      else { setGoal(''); onClose(); }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    setBundle((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-background/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.form
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={onSubmit}
            className="flex w-full max-w-lg flex-col gap-4 rounded-[14px] border border-border/60 bg-card p-5 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-foreground" />
              <h2 className="text-[14px] font-semibold">Plan from goal</h2>
            </div>

            <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              Goal
              <textarea
                autoFocus
                rows={3}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Prep for the demo this Friday — slides, rehearsal, backup plan"
                className="resize-none rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground"
              />
            </label>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-[11px] uppercase tracking-wider text-muted-foreground">Context sources</legend>
              <div className="flex flex-wrap gap-2 pt-1">
                {SOURCES.map((s) => (
                  <label key={s.id} className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[12px]',
                    bundle.includes(s.id) ? 'bg-card' : 'bg-background text-muted-foreground',
                  )}>
                    <input
                      type="checkbox"
                      checked={bundle.includes(s.id)}
                      onChange={() => toggle(s.id)}
                      className="accent-foreground"
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {err && <div className="text-[12px] text-red-500">{err}</div>}

            <div className="flex justify-end gap-2">
              <button
                type="button" onClick={onClose} disabled={busy}
                className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-[12px] hover:bg-muted/60"
              >Cancel</button>
              <button
                type="submit" disabled={busy || !goal.trim()}
                className={cn(
                  'flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background',
                  'disabled:opacity-50',
                )}
              >
                {busy ? <><Loader2 className="h-3 w-3 animate-spin" />Planning…</> : <><Sparkles className="h-3 w-3" />Generate drafts</>}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
```

- [ ] **Step 6.2:** `bun run check` zero errors.

- [ ] **Step 6.3:** Commit:
```bash
git add apps/desktop/src/components/vault/tasks/NewPlanDialog.tsx
git commit -m "feat(tasks): NewPlanDialog (goal input + context selection)"
```

---

## Task 7 · Wire "New Plan" button + mount dialog

**Files:**
- `apps/desktop/src/components/vault/tasks/FiltersBar.tsx`
- `apps/desktop/src/components/sidebar/vault/TasksSection.tsx`

- [ ] **Step 7.1:** In `FiltersBar.tsx`, add a "New Plan" button alongside "New task". Add prop:
```tsx
interface Props {
  readonly grouping: GroupKey;
  readonly onGroupingChange: (k: GroupKey) => void;
  readonly onNewTask: () => void;
  readonly onNewPlan: () => void;
}
```

Add button (place next to "+ New task"):
```tsx
<button
  type="button"
  onClick={onNewPlan}
  className={cn(
    'flex items-center gap-1 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-[12px] font-medium',
    'text-foreground hover:bg-muted/60',
  )}
>
  <Sparkles className="h-3.5 w-3.5" />
  New Plan
</button>
```

Import `Sparkles` from `lucide-react`.

- [ ] **Step 7.2:** In `TasksSection.tsx`:
- Add `import { NewPlanDialog } from '@/components/vault/tasks/NewPlanDialog';`
- Add state: `const [planOpen, setPlanOpen] = useState(false);`
- Pass `onNewPlan={() => setPlanOpen(true)}` to `<FiltersBar />`
- Mount `<NewPlanDialog open={planOpen} onClose={() => setPlanOpen(false)} />` alongside the existing `<NewTaskDialog>`.

- [ ] **Step 7.3:** `bun run check` zero errors.

- [ ] **Step 7.4:** Commit:
```bash
git add apps/desktop/src/components/vault/tasks/FiltersBar.tsx apps/desktop/src/components/sidebar/vault/TasksSection.tsx
git commit -m "feat(tasks): wire New Plan button + dialog into Tasks panel"
```

---

## Task 8 · `TaskRow` Accept / Dismiss for Suggested

**File:** `apps/desktop/src/components/vault/tasks/TaskRow.tsx`

- [ ] **Step 8.1:** Pull the 2 new actions from store:
```tsx
const accept  = useTaskStore((s) => s.acceptDraft);
const dismiss = useTaskStore((s) => s.dismissDraft);
```

Add icons from lucide: `Check`, `X`.

When `task.status === 'suggested'`, render inline accept/dismiss buttons inside the row (replace the tick-circle with these two buttons, left-aligned, compact):

```tsx
{task.status === 'suggested' ? (
  <div className="flex shrink-0 gap-1">
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void accept(task.id); }}
      className="grid h-5 w-5 place-items-center rounded-full border border-green-500/30 bg-green-500/10 text-green-600 hover:bg-green-500/20"
      aria-label="Accept draft"
    >
      <Check className="h-3 w-3" />
    </button>
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void dismiss(task.id); }}
      className="grid h-5 w-5 place-items-center rounded-full border border-border/50 text-muted-foreground hover:bg-muted/50"
      aria-label="Dismiss draft"
    >
      <X className="h-3 w-3" />
    </button>
  </div>
) : (
  /* existing status/tick circle */
)}
```

Wrap the existing tick-circle block in the else. Keep the rest of the row unchanged.

- [ ] **Step 8.2:** `bun run check` zero errors.

- [ ] **Step 8.3:** Commit:
```bash
git add apps/desktop/src/components/vault/tasks/TaskRow.tsx
git commit -m "feat(tasks): inline Accept/Dismiss for Suggested rows"
```

---

## Task 9 · Smoke test Phase 5

- [ ] **Step 9.1:** Restart `bun run dev`.
- [ ] **Step 9.2:** Click **✨ New Plan**. Type goal "Help me ship the task allocator — next steps". Submit.
- [ ] **Step 9.3:** Wait up to 60s. Expect: 3-7 new tasks appear under a "Suggested" group. Each has title, description, executor, priority.
- [ ] **Step 9.4:** Click the green check on one row. Expect: row moves to Queued group.
- [ ] **Step 9.5:** Click the X on another. Expect: row disappears.
- [ ] **Step 9.6:** Open any other agent session in the app, finish it. Within ~10 min, expect ONE proactive planner fire (a handful of Suggested drafts appears). Finish another session immediately — no new drafts (rate-limited). Wait 11 min, finish another — new drafts appear.
- [ ] **Step 9.7:** Context-override: open New Plan dialog, uncheck Git + Skills, submit. Drafts should still generate but the LLM should not reference skill names or branch state.

---

## Task 10 · Wrap-up

- [ ] **Step 10.1:**
```bash
cargo test --workspace --lib
cargo clippy -p solo-tasks --all-targets -- -D warnings
bun run check
```
Green.

- [ ] **Step 10.2:** Mark Phase 5 complete in spec (§15) — prepend ✅.

- [ ] **Step 10.3:** Commit.

---

## Known Phase 5 limitations (explicit)

1. **Sessions + Notes providers deferred to Phase 6.** The default bundle in Phase 5 is 4 sources, not 6.
2. **Command palette entry deferred to Phase 6.**
3. **Idempotent hash cache is not implemented.** Re-submitting the same goal generates a fresh set of drafts.
4. **LLM call uses agent_create_session** — spawns a full session for each planner run. This is heavier than a direct API call but requires no new credentials plumbing. Follow-up: use direct Claude API with JSON mode.
5. **Rate limiter is in-memory only.** Restarts reset the window — if the app restarts, next session-end will fire a proactive run even if one fired minutes before shutdown.

## Self-review

- **Spec coverage:** §4 Planner subsystem (simplified), §3 context bundle (4/6 sources), §4.2 Path A + C, §6 `plan_from_goal`/`plan_accept_draft`/`plan_dismiss_draft`/`plan_proactive` commands.
- **Scope cuts explicit:** Sessions/Notes providers, command palette, hash cache.
- **No placeholders in code.**
- **Type names consistent:** `ContextFragment`, `ProactiveGate`, `RawDraft`.
