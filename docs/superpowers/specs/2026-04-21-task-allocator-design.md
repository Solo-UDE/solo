# Task Allocator — Design Spec

**Date:** 2026-04-21
**Status:** Draft — awaiting user review
**Owners:** sa9082@nyu.edu
**Location in Solo:** Vault → new tab

---

## 1. Purpose

A task allocator that plans agent sessions by connecting context across Solo's data (vault, skills, git, sessions, notes, existing tasks), persists tasks in a Plane-styled UI inside Vault, spawns agent runs on demand or on a schedule, and supports autonomous, event-driven proactive planning.

The allocator is a **unified surface** for:
- tracked to-dos the user does themselves,
- agent runs the user kicks off manually,
- scheduled agent runs (cron),
- proactive suggestions generated from context, and
- daily/recurring autonomous work.

Every task is the same entity with an `executor` field (`manual` or `agent`) and an optional `schedule`. This keeps one data model, one UI, one set of filters.

## 2. User-facing summary

A new **Tasks** tab in the Vault section shows a Plane-styled task board. The user can:

- Click **"New Plan"** (prominent button, top-right) or ⌘K → "Plan: …" to open a goal-input dialog; the planner LLM decomposes the goal into a set of suggested tasks using the default context bundle (or per-plan-overridden bundle).
- Add tasks manually via a simpler "New task" affordance.
- Let the system propose tasks proactively — on a daily cron, and after every agent session ends.
- Assign any task to `manual` or `agent`; agent tasks carry model/skill/permission config.
- Schedule any task with presets (daily/weekly/hourly) or a raw cron expression.
- See all tasks in **list, kanban, or calendar** view with a view toggle (default: grouped list, grouped by status).
- Open task details in a **side drawer** (480px, right-side, Plane-style).
- Review finished agent runs via a "Review changes" modal with **Merge / Discard / Open PR** actions.

## 3. Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Task concept | Unified entity with `executor: manual \| agent` |
| 2a | Creation paths | Manual + LLM-from-goal + Proactive |
| 2b | LLM-from-goal entry | "New Plan" button AND command palette |
| 2c | Proactive triggers | Daily cron + event hooks |
| 3-bundle | Default context sources | Vault, Skills, Git, Sessions, Existing tasks, Planner notes |
| 3b | Context override | Global default + per-plan override |
| 4a | Execution location | Manual→main workspace; scheduled/proactive→worktree |
| 4b | Permission mode | **Full bypass in worktree only**; `ask` default in main workspace |
| 4c | Result handling | Log + notification + Review modal (Merge / Discard / Open PR) |
| 4d | Model choice | Default + per-task override |
| 4e | Skills | Planner picks; user can override in "advanced" |
| 5a | Cron syntax | Presets + raw cron escape hatch |
| 5b | App-closed behavior | Skip; optional per-task "catch up on next launch" checkbox |
| 5c | Event hooks | Agent session ends only (v1) |
| 5d | Rate limit | Min 10 min between proactive runs, coalesce events within the window |
| 6a | Views | List + kanban + calendar (all three, toggleable); default list |
| 6b | Detail panel | Side drawer, 480px |
| 6c | Default grouping | By status; multiple creative groupings available (see §7) |
| 6d | "New Plan" placement | Prominent button top-right of Tasks tab |

**Safety add-ons (locked):**
- Per-command **deny-list** (hard-blocks: `rm -rf /*`, `sudo *`, `curl | sh`, `git push --force`, etc.) even in bypass mode.
- Per-task **network egress allow-list** (optional, default open).

**Out of scope for v1** (explicitly deferred):
- Background daemon (`launchd` plist to run when app is closed).
- Event triggers other than session-end.
- Auto-open PR from agent runs (we'll log + notify + show review modal; user clicks "Open PR" if they want it).
- Kanban drag-drop (view exists, re-ordering ships v1.1).

## 4. Architecture

### 4.1 Subsystems (six)

```
┌─────────────────────────────────────────────────────────────┐
│                      Vault UI (Plane-styled)                │
│  Tasks tab · List/Kanban/Calendar · Side drawer · Filters   │
└──────────────┬────────────────────────┬─────────────────────┘
               │                        │
        invoke (Tauri)            listen BackendEvent
               │                        ▲
┌──────────────▼────────────────────────┴─────────────────────┐
│  Rust backend (apps/desktop/src-tauri/src/task_commands.rs) │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ TaskStore│  │ Context  │  │ Planner  │  │  Executor   │  │
│  │ (SQLite) │  │Aggregator│  │  (LLM)   │  │(agent spawn)│  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘  │
│              ┌──────────────────────────┐                   │
│              │   Scheduler (tokio)      │                   │
│              │  cron + event bus + rate │                   │
│              └──────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

Each subsystem has one clear responsibility:

1. **TaskStore** — SQLite CRUD + FTS5 search. Schema in §5. No LLM, no business logic.
2. **ContextAggregator** — trait with 6 providers (Vault, Skills, Git, Sessions, Tasks, Notes); each returns a bounded `ContextFragment { source, content, token_estimate }`. Caller passes a total token budget; aggregator fills respecting per-source caps.
3. **Planner** — takes (goal OR "proactive"), context fragments, existing-tasks snapshot → returns a list of `TaskDraft { title, description, executor_suggestion, skill_suggestions, schedule_suggestion }`. LLM call through existing agent provider stack (Anthropic/OpenAI). Planner is **idempotent** per goal+context hash — re-running the same plan produces the same drafts unless the user clicks "Refresh".
4. **Executor** — given a Task, spawns an agent session. Resolves worktree (create if needed), model, skills, permission mode, deny-list. Subscribes to session events, captures result, updates task row, fires notification + Review modal event.
5. **Scheduler** — `tokio` task that owns (a) a cron wheel, (b) an event subscriber for `AgentSessionEnded`, (c) a rate limiter (token-bucket, 1 per 10min per trigger-kind). Enqueues `PlannerTrigger` or `ExecuteTrigger` jobs into an in-proc MPSC channel.
6. **UI** — React. New Vault tab `TasksAllocatorTab`. Three view components (`TaskListView`, `TaskKanbanView`, `TaskCalendarView`). Shared `TaskDrawer`. Zustand store `taskStore.ts`. Event listener in `useTaskStream.ts`.

### 4.2 Data flow — three primary paths

**Path A: User clicks "New Plan"**
```
UI (goal text) → invoke(plan_from_goal)
  → ContextAggregator.collect(bundle) → fragments
  → Planner.plan(goal, fragments, existing_tasks) → drafts
  → TaskStore.insertDrafts(status=Suggested) → emit TasksChanged
  → UI shows drafts as "Suggested" group; user accepts/edits/dismisses
```

**Path B: User clicks Run on an agent task (manual)**
```
UI → invoke(run_task, task_id) → Executor.run(task)
  → Executor decides: main workspace (task.execution=main)
  → spawn agent_create_session with task's model+skills+permission
  → emit TaskStateChanged(running); stream session events
  → on end: emit TaskStateChanged(review); open Review modal
```

**Path C: Scheduled/proactive run (cron or post-session-end event)**
```
Scheduler tick → Scheduler.decide()
  → if cron: enqueue(ExecuteTrigger task_id)
  → if event: rate-limit gate → enqueue(PlannerTrigger proactive)
  → worker loop consumes:
     - ExecuteTrigger: same as Path B but execution=worktree, permission=bypass, deny-list on
     - PlannerTrigger: calls Planner with "proactive" intent, drafts → Suggested column
```

### 4.3 Concurrency & capacity

- Solo caps parallel agent sessions at **3** (`MAX_ACTIVE_SESSIONS`). The Task Executor respects this; scheduled tasks that would exceed it enter state `Queued-waiting-slot` until a session frees.
- `MAX_PROACTIVE_RUNS_PER_DAY = 10` (hard cap, configurable).
- Rate limiter: token bucket per trigger-kind (cron, event), refill 1 token per 10 min, burst 1. Coalesces multiple same-kind events within the window.

### 4.4 Error handling policy

| Failure | Behavior |
|---|---|
| Worktree create fails | Task → `Failed`, error stored in `last_error`, notification. No auto-retry. |
| Agent session crashes mid-run | Task → `Failed`, session log attached. No auto-retry. User clicks "Rerun" to retry. |
| Planner LLM fails | Silently — no drafts inserted. Log to task history if user-initiated. |
| Deny-list hit | Executor kills session, task → `Failed` with reason "blocked command: <cmd>", notification. |
| Cron fires while `MAX_ACTIVE_SESSIONS` reached | Task → `Queued-waiting-slot`, runs when slot frees. If waited > 30 min, fire notification. |
| App closes mid-run | Session persists per existing agent-session persistence; on relaunch, session is marked `stale`, task stays `Running` until user intervenes. |
| App was closed at scheduled time | Skip by default. If task has `catch_up_on_launch=true`, run once on next launch (at most one catch-up per schedule, not N). |
| Credentials missing for selected model | Task → `Failed` with reason "no credentials for {provider}"; auth flow surfaced in notification. |

## 5. Data model

### 5.1 `Task` (SQLite table: `tasks`)

```rust
// crates/solo-protocol/src/lib.rs
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Task {
    pub id: String,               // uuid
    pub title: String,
    pub description: String,      // markdown
    pub status: TaskStatus,
    pub executor: Executor,       // Manual | Agent
    pub priority: TaskPriority,   // Low | Med | High | Urgent
    pub created_at: i64,
    pub updated_at: i64,

    // Agent config (only if executor=Agent)
    pub agent: Option<AgentConfig>,

    // Schedule config (None = one-shot)
    pub schedule: Option<Schedule>,

    // Planner-emitted tags for grouping
    pub context_anchors: Vec<ContextAnchor>,  // e.g. VaultEntry(id), Skill(name), Branch(name), File(path)

    // History (unbounded, newest first)
    pub runs: Vec<TaskRun>,
    pub last_error: Option<String>,

    // "Catch up" flag for scheduled tasks
    pub catch_up_on_launch: bool,

    // Origin
    pub origin: TaskOrigin,       // Manual | GoalPlan(goal_id) | Proactive
}

pub enum TaskStatus { Suggested, Queued, Running, NeedsReview, Done, Failed, Archived }
pub enum Executor    { Manual, Agent }
pub enum TaskPriority { Low, Medium, High, Urgent }

pub struct AgentConfig {
    pub model: ModelId,              // override; None uses default
    pub skills: Option<Vec<String>>, // None = planner decides
    pub permission_mode: PermissionMode, // Ask | Plan | AcceptEdits | Bypass
    pub execution_location: ExecutionLocation, // MainWorkspace | Worktree
    pub deny_list: Vec<String>,      // extra commands to block (merged with global)
    pub network_allow_list: Option<Vec<String>>, // None = open; Some([]) = offline
}

pub enum Schedule {
    OneShot { at: i64 },
    Cron { expr: String, next_fire: i64 },
    Preset { kind: PresetKind, hour: u8, minute: u8, weekday: Option<u8> },
    EventTriggered { event: EventKind },
}

pub enum PresetKind { Hourly, Daily, Weekly, Monthly }
pub enum EventKind  { AgentSessionEnded }  // v1 — one variant; enum for future

pub enum ContextAnchor {
    VaultEntry(String), Skill(String), Branch(String),
    File(String),       Session(String),  Topic(String),
}

pub struct TaskRun {
    pub id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub outcome: RunOutcome,        // Running | Succeeded | Failed | Cancelled
    pub session_id: Option<String>, // link to agent session if executor=Agent
    pub worktree_id: Option<String>,
    pub summary: Option<String>,    // LLM-generated or raw final message
}
```

### 5.2 Tables

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    executor TEXT NOT NULL,
    priority TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    agent_config_json TEXT,           -- serialized AgentConfig
    schedule_json TEXT,               -- serialized Schedule
    context_anchors_json TEXT,        -- serialized Vec<ContextAnchor>
    origin_json TEXT NOT NULL,
    last_error TEXT,
    catch_up_on_launch INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE task_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    outcome TEXT NOT NULL,
    session_id TEXT,
    worktree_id TEXT,
    summary TEXT
);

CREATE INDEX idx_tasks_status    ON tasks(status);
CREATE INDEX idx_tasks_schedule  ON tasks(schedule_json);
CREATE INDEX idx_task_runs_task  ON task_runs(task_id, started_at DESC);

-- FTS index for search
CREATE VIRTUAL TABLE tasks_fts USING fts5(
    title, description, content='tasks', content_rowid='rowid'
);
```

### 5.3 Settings

`Settings.task_allocator` (JSON blob stored in existing settings store):
```json
{
  "default_context_bundle": ["vault","skills","git","sessions","existing_tasks","notes"],
  "planner_notes": "string — freeform",
  "default_model": "claude-opus-4-7[1m]",
  "default_permission_mode_main": "ask",
  "default_permission_mode_worktree": "bypass",
  "global_deny_list": ["rm -rf /*", "sudo *", "curl * | sh", "git push --force *", ...],
  "max_proactive_runs_per_day": 10,
  "rate_limit_minutes": 10,
  "enabled_event_triggers": ["agent_session_ended"]
}
```

## 6. Tauri IPC surface

All added under new `task_commands.rs`:

| Command | Purpose |
|---|---|
| `task_list(filter?, grouping?)` | list tasks, optionally filtered/grouped |
| `task_get(id)` | single task w/ runs |
| `task_create(draft)` | manual create |
| `task_update(id, patch)` | edit |
| `task_delete(id)` | delete (cascades runs) |
| `task_run(id)` | trigger immediate run |
| `task_cancel(id)` | cancel running task (kills session if any) |
| `task_accept_draft(id)` | promotes Suggested → Queued |
| `task_dismiss_draft(id)` | removes Suggested |
| `task_review_merge(id)`, `task_review_discard(id)`, `task_review_open_pr(id)` | post-run review actions |
| `plan_from_goal(goal, context_override?)` | returns draft ids; drafts land in store |
| `plan_proactive()` | manual trigger of proactive run |
| `task_schedule_preview(schedule)` | returns next-5 fire times (for UI) |
| `planner_settings_get / planner_settings_update` | settings CRUD |

### BackendEvent variants (added to `BackendEvent`)

```rust
BackendEvent::TasksChanged { task_ids: Vec<String> }
BackendEvent::TaskRunStarted { task_id: String, run_id: String }
BackendEvent::TaskRunProgress { task_id: String, run_id: String, summary: String }
BackendEvent::TaskRunEnded    { task_id: String, run_id: String, outcome: RunOutcome }
BackendEvent::TaskReviewReady { task_id: String, run_id: String, diff_summary: String }
```

## 7. Grouping options (§6c innovation)

The UI `Group by` dropdown offers these 7 groupings. **Default: Status.** Grouping is a pure client-side transform over `task_list()` results — no new queries needed.

| Grouping | Groups | Why Solo-specific |
|---|---|---|
| **Status** *(default)* | Suggested / Queued / Running / Needs Review / Done / Failed | Classic; maps to lifecycle |
| **Trigger** | Manual / Scheduled / Event-driven / Suggested | Solo has all three; this is the planning-centric view |
| **Cadence** | One-shot / Hourly / Daily / Weekly / Monthly / Custom cron | Fast answer to "what runs when?" |
| **Executor** | You / Agent | Separates your to-dos from agent queue |
| **Context anchor** | #skill:git · #vault:auth-notes · #branch:feat/dmg · #topic:refactor | Uses planner-attached `context_anchors`; reveals thematic clusters |
| **Agent fingerprint** | "Opus + {git,docs}" · "Sonnet + {no skills}" etc. | Aggregates (model, skills) tuples; surfaces cost/capability patterns |
| **Last-run health** | Never run · Succeeded recently · Failed · Overdue (scheduled but missed last window) | Ops view — fast triage of what's broken |

## 8. UI layout (Plane patterns)

### 8.1 Tab structure
`VaultPanel` gets a new `<TasksAllocatorTab />` alongside Installed/Marketplace/Forks. Tab internals:

```
┌────────────────────────────────────────────────────────────┐
│  Header                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Filters (status, executor, schedule, anchor)        │   │
│  │ Group by: [Status ▾]   View: [List|Kanban|Cal]      │   │
│  │                                      [+ New task]   │   │
│  │                                      [✨ New Plan]  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  Body (active view)                                        │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 8.2 Views

**List view** (Plane-inspired `/issues/issue-layouts/list/default.tsx`):
- Collapsible group headers (chevron, name, count).
- Row: checkbox · title · priority pill · executor avatar (you/Claude glyph) · schedule chip · context-anchor tags · last-run status dot · updated-at.
- Click row → side drawer opens.

**Kanban view**:
- Columns by status (or current group-by). v1 = no drag-drop (read-only column layout).

**Calendar view**:
- Month grid. Each cell shows cron chips (`🤖 3am scan`). Click chip → side drawer opens focused on that task.

### 8.3 Side drawer (`TaskDrawer`)
- 480px, slides from right, sticky header with title + status badge + close.
- Tabs: **Overview** (description markdown, properties, anchors) / **Runs** (history table) / **Agent** (model, skills, permission, deny-list, network allow-list) / **Schedule** (preset or cron; preview of next 5 fires).
- Footer actions: `Run now` · `Edit` · `Delete` · (if NeedsReview) `Merge` · `Discard` · `Open PR`.

### 8.4 "New Plan" dialog
- Large goal textarea (multiline).
- Collapsed "Context sources (6 defaults)" — expand to override per-plan.
- Collapsed "Advanced" — model, default permission, schedule-on-accept.
- Submit → spinner → drafts land in Suggested column; dialog closes.

### 8.5 Review modal
- Triggered by `TaskReviewReady` event.
- Shows run summary, diff stats, link to session transcript.
- Actions: `Merge to main`, `Discard worktree`, `Open PR`, `Leave for later`.

## 9. File layout

**Rust:**
- `crates/solo-protocol/src/lib.rs` — add `Task*`, `Executor`, `Schedule`, `AgentConfig`, `ContextAnchor`, `TaskRun`, BackendEvent variants (ts-rs derived).
- `crates/solo-tasks/` — **new crate**:
  - `store.rs` (SQLite + FTS)
  - `context/` (trait + 6 providers)
  - `planner.rs` (LLM call orchestration)
  - `scheduler.rs` (cron + event bus + rate limiter)
  - `executor.rs` (agent session spawn + worktree + deny-list)
  - `lib.rs` (public surface + `TaskAllocatorState`)
- `apps/desktop/src-tauri/src/task_commands.rs` — `#[tauri::command]` functions + registration.
- `apps/desktop/src-tauri/src/lib.rs` — `.manage(TaskAllocatorState::new())` + `generate_handler![…]`.
- `Cargo.toml` workspace — add `croner` (pure-Rust cron parser, maintained, no unsafe) dependency. *Chosen over `tokio-cron-scheduler` because we only need parsing + next-fire, not a full scheduler crate — our scheduler is hand-rolled for rate-limit+event integration.*

**Frontend (TS/React):**
- `apps/desktop/src/bindings/**` — auto-regenerated by `bun run gen:bindings`.
- `apps/desktop/src/lib/tauri/tasks.ts` — typed invoke wrappers.
- `apps/desktop/src/stores/taskStore.ts` — Zustand + Immer store. Map<id, Task>.
- `apps/desktop/src/hooks/useTaskStream.ts` — listens to BackendEvent::Task* and patches store.
- `apps/desktop/src/components/vault/tabs/TasksAllocatorTab.tsx` — main tab container.
- `apps/desktop/src/components/vault/tabs/tasks/` — `TaskListView.tsx`, `TaskKanbanView.tsx`, `TaskCalendarView.tsx`, `TaskDrawer.tsx`, `NewPlanDialog.tsx`, `ReviewModal.tsx`, `FiltersBar.tsx`, `GroupByMenu.tsx`, `ScheduleEditor.tsx`.
- `apps/desktop/src/components/sidebar/vault/SkillsSection.tsx` — add tab registration for `'tasks'`.

**Wiring:**
- Command palette entry: `Plan: …` → opens `NewPlanDialog`.
- Existing sidebar `TasksSection.tsx`: investigate during impl — if empty/stub, repurpose as a mini live feed (running tasks only) that deep-links to the full Tasks tab; if it has real content, rename it and keep separate.

## 10. Testing strategy

### 10.1 Rust unit tests (`crates/solo-tasks/`)
- **Store**: CRUD, FTS search, cascade delete runs, JSON round-trip for enums.
- **ContextAggregator**: each provider with a stub fixture; token-budget enforcement; ordering deterministic.
- **Planner**: stub LLM returns canned JSON; hash-based idempotence; schema validation of drafts.
- **Scheduler**: virtual-clock tests (via `tokio::time::pause()`) — cron fire timing, rate-limit coalescing, event debounce.
- **Executor**: stub agent-session creator; worktree mock; deny-list enforcement; status transitions.

### 10.2 Integration tests
- Create task → run → assert `task_runs` row + BackendEvent sequence.
- Schedule task daily → advance virtual time → assert N fires.
- Event-trigger path: emit `AgentSessionEnded` 5× in 30s → assert exactly one proactive planner run (rate-limit coalesces).
- Catch-up: schedule fires while app "closed" (simulated) → on launch, assert exactly one make-up run.
- Max active sessions: queue 5 task runs with `MAX=3` → assert 3 run, 2 wait, then drain.

### 10.3 Frontend tests
- Store reducers: TasksChanged, TaskRunEnded patches produce expected state.
- Grouping transform: given a fixture list, each of the 7 groupings yields expected groups.
- Schedule editor: preset ↔ cron-expression round-trip.

### 10.4 Manual UX test plan (end of implementation)
- [ ] Create task manually, run, see status transitions, see run in drawer Runs tab.
- [ ] New Plan from goal → drafts appear as Suggested → accept one → it moves to Queued.
- [ ] Schedule daily at 5 min from now → wait → assert run fires in worktree → Review modal opens → Merge.
- [ ] Discard path: scheduled run → Review modal → Discard → worktree cleaned.
- [ ] Event-hook: end an agent session → proactive run fires ~1× (not many). Second session within 10 min → no second run.
- [ ] Close app mid-scheduled-window, relaunch — no run (catch-up off). Toggle catch-up on, repeat — one make-up run.
- [ ] Deny-list: craft a task that attempts `sudo rm -rf /` → run in bypass mode → executor kills it, Failed with reason.
- [ ] `MAX_ACTIVE_SESSIONS`: kick off 4 agent tasks → 3 run, 1 queued → finish one → queued runs.
- [ ] Grouping dropdown: cycle through all 7 groupings, assert each renders without error.
- [ ] View toggle: list → kanban → calendar preserves filter state.

## 11. Scenarios & edge cases (catalog)

This is the catalog I promised — "all the scenarios." Design already handles each of these via the error-policy table (§4.4) and the component responsibilities above. Included here as a reference.

### 11.1 Happy paths
1. Manual to-do: create → tick done. (No executor, no schedule.)
2. Manual agent run: create agent task → click Run → see session stream → review → merge.
3. Planned goal: "Prep for demo Friday" → planner emits 5 drafts → user accepts 3, edits 1, dismisses 1.
4. Daily scheduled: "Run security scan" daily at 3am → fires in worktree → notification → review in morning.
5. Proactive suggestion: session on `feat/dmg` ends → 12 min later, proactive tick runs → draft suggests "Update CHANGELOG for feat/dmg" → user accepts.

### 11.2 Failure paths
6. LLM down during New Plan → dialog shows error, user can retry.
7. LLM down during proactive → silent skip, logged to debug console only.
8. Worktree creation fails (disk full) → task Failed, notification.
9. Session crashes mid-run → task Failed, run row captures crash reason.
10. Network allow-list blocks required domain → agent fails cleanly, reason visible in run summary.
11. Deny-list blocks agent attempt → session killed, reason logged.
12. Credentials missing for chosen model → Failed + auth-flow notification.

### 11.3 Concurrency & capacity
13. 5 cron-scheduled tasks all fire at midnight → 3 run, 2 queue with `Waiting-slot`; drain in order.
14. User runs manual task while cron fires → manual gets queued behind cron (FIFO).
15. Event hook fires 20 times in 5 min (commit spree) → exactly 1 proactive run happens.

### 11.4 App-lifecycle
16. App closed at cron fire time, no catch-up → next launch: no make-up run, schedule advances to next window.
17. App closed at cron fire time, catch-up on → next launch: one make-up run executes.
18. App closed mid-running-task → on relaunch, task shows Running+stale; user clicks "Mark stopped" to resolve.

### 11.5 UX edge cases
19. User deletes a task mid-run → confirmation modal; confirming kills session, cleans worktree, cascades run rows.
20. User edits a running task's agent config → changes apply to NEXT run; current run unaffected (warning shown).
21. User schedules two tasks at identical cron → both fire; if capacity allows, both run concurrently.
22. Suggested drafts grow unbounded → "Suggested" group collapses after 50; footer "Show N older" expands.
23. Very long task description (markdown) → drawer scrolls, description area gets its own scroll region.
24. User clicks "Rerun" on a done task → creates a new run_id appended to the same task; task status returns to Running.

## 12. Security & privacy posture

- **Bypass-only-in-worktree is enforced server-side** in the Executor. Even if the UI sends an inconsistent pair (bypass + main workspace), Executor rejects with `InvalidExecutionConfig`.
- **Deny-list is merged** from settings + per-task. Cannot be disabled entirely — the task-level field is additive.
- **Network allow-list** is advisory in v1 (we surface it to the agent prompt; we don't proxy). v1.1 can add a proxy-based enforcer if needed. *Explicitly not a security boundary in v1.*
- **Planner LLM calls** use the same provider stack the user already auth'd for agent sessions; no new credential surface.
- **Voice / dictation** is excluded from the default context bundle; only opt-in.
- **Per-command deny-list entries live in settings, version-controlled by the user**. Default set ships with Solo.

## 13. Telemetry (local only)

For the user's own retrospective (no network):
- Count of tasks created by origin (Manual / GoalPlan / Proactive).
- Count of agent runs by outcome.
- Average time-to-accept on Suggested drafts.
- Rate-limit suppressions per day.

Stored in the same SQLite DB (`telemetry_daily` table). No external reporting.

## 14. Migration / rollout

- No data migration needed — new tables.
- Existing `TasksSection.tsx` sidebar: investigated in Phase 1 of implementation; repurposed as a compact live feed (Running + NeedsReview tasks) that deep-links to the full Vault tab. If existing content is non-trivial, it's renamed rather than replaced.
- Feature is additive; no flag gate. Ships always-on.

## 15. Implementation phasing

The spec is large but cohesive. The implementation plan will land it in 6 sequential phases, each independently shippable:

| Phase | Scope | Exit criteria |
|---|---|---|
| **1 · Foundation** ✅ | Protocol types, `solo-tasks` crate skeleton, SQLite store + FTS, `task_commands.rs` for CRUD, `TasksAllocatorTab` with list view only, manual tasks end-to-end (executor=manual, no schedule, no agent) | Can create/edit/delete/search manual tasks in the UI — **shipped 2026-04-21 on `feat/dmg`, plan `docs/superpowers/plans/2026-04-21-task-allocator-phase-1-foundation.md`** |
| **2 · Agent executor (main workspace)** | Executor for `executor=Agent, execution=main, permission=ask`; spawn existing `agent_create_session`; stream run events; Runs tab in drawer | Click Run → agent session spawns → outcome captured |
| **3 · Worktree + safety** | Worktree-mode execution; deny-list enforcement (global + per-task); network allow-list plumbing (advisory); Review modal with Merge / Discard / Open PR | Scheduled-style tasks can run in worktree with bypass mode + safety gates |
| **4 · Scheduler** | Cron (`croner` crate), schedule editor UI (presets + raw), event bus (session-ended only), rate limiter, catch-up, queueing when MAX_ACTIVE_SESSIONS reached | Daily/cron tasks fire correctly; event trigger fires proactive with rate limit |
| **5 · Planner (LLM)** | ContextAggregator (6 providers), planner prompt + LLM call, New Plan dialog + command palette entry, Suggested state flow, idempotent hash cache | Goal → drafts → accept flow works end-to-end |
| **6 · Polish** | Kanban view, Calendar view, all 7 groupings, telemetry table, manual UX test pass | All §10.4 manual checks pass |

## 16. Open questions

- **None critical.** All decisions captured in §3. Micro-choices (exact preset time defaults, default task priority) deferred to implementation.
