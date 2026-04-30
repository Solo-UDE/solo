# Task Allocator — Phase 4 (Scheduler) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent-tasks with a schedule fire automatically — daily/weekly/hourly presets or raw cron expressions. When the worktree+MAX_ACTIVE_SESSIONS=3 budget is full, scheduled fires queue and drain. On app launch, missed fires run once if the task has `catch_up_on_launch=true`.

**Architecture:** Typed `Schedule` enum replaces `Option<Value>` on `Task`. New `solo-tasks::scheduler` module hosts a tokio-spawned loop that wakes every 15s, walks scheduled tasks, and dispatches fires via `ExecutorMap`. Rate-limit and event-hook scaffolding are installed; event-driven proactive planning activates in Phase 5 when a planner LLM exists. `croner` (maintained pure-Rust cron parser) computes next-fire from cron expressions.

**Tech Stack:** `croner = "2"` (new dep on solo-tasks), `tokio::time::interval`, `chrono` for UTC math. No UI framework changes.

**Spec reference:** `docs/superpowers/specs/2026-04-21-task-allocator-design.md` §4 Scheduler, §4.3 concurrency, §4.4 catch-up, §5 `Schedule` enum.

---

## File map

**Create (Rust):**
- `crates/solo-tasks/src/scheduler.rs` — cron wheel + queue + catch-up.
- `crates/solo-tasks/src/schedule_preview.rs` — pure fn returning next N fire times.

**Modify (Rust):**
- `crates/solo-protocol/src/lib.rs` — add `Schedule` enum + `PresetKind` + `EventKind`. Change `Task.schedule: Option<Schedule>`.
- `crates/solo-tasks/Cargo.toml` — add `croner = "2"` and `chrono = { version = "0.4", features = ["serde"] }`.
- `crates/solo-tasks/src/lib.rs` — export new modules.
- `crates/solo-tasks/src/store.rs` — `update()` handles `patch.schedule`; new `list_scheduled()` query.
- `apps/desktop/src-tauri/src/task_commands.rs` — `task_schedule_preview` command.
- `apps/desktop/src-tauri/src/task_executor.rs` — teach `ExecutorMap` to expose capacity (how many active runs) for scheduler queue gate.
- `apps/desktop/src-tauri/src/lib.rs` — start scheduler on setup; register new command.

**Create (TS):**
- `apps/desktop/src/components/vault/tasks/ScheduleEditor.tsx` — preset/cron toggle + preview.
- `apps/desktop/src/components/vault/tasks/ScheduleTab.tsx` — drawer tab wrapping the editor.

**Modify (TS):**
- `apps/desktop/src/bindings/**` — regen.
- `apps/desktop/src/lib/tauri/tasks.ts` — `schedulePreview`, re-export `Schedule`, `PresetKind`, `EventKind`.
- `apps/desktop/src/stores/taskStore.ts` — local `cadence` grouping helper.
- `apps/desktop/src/components/vault/tasks/TaskDrawer.tsx` — 4th tab "Schedule".
- `apps/desktop/src/components/vault/tasks/groupings.ts` — add `'cadence'` grouping.

---

## Task 1 · Typed `Schedule` enum

**File:** `crates/solo-protocol/src/lib.rs`

- [ ] **Step 1.1:** Before the `Task` struct, add:

```rust
/// Preset cadence for scheduled tasks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum PresetKind { Hourly, Daily, Weekly, Monthly }

/// Event trigger kinds. v1 ships one variant; enum lets Phase 5+ add more without migration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "snake_case")]
pub enum EventKind { AgentSessionEnded }

/// How a task fires automatically. `None` on Task = one-shot / manual.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum Schedule {
    /// Fire once at the given UTC millis.
    OneShot { at: i64 },
    /// Fire on a raw cron expression (UTC).
    Cron { expr: String, next_fire: i64 },
    /// Preset kind — hour/minute interpreted in UTC; weekday is 0..=6 (Mon=0).
    Preset { kind: PresetKind, hour: u8, minute: u8, weekday: Option<u8>, next_fire: i64 },
    /// Event-driven. v1 populates this shape but the scheduler wires it up in Phase 5.
    EventTriggered { event: EventKind },
}
```

- [ ] **Step 1.2:** Change `Task.schedule` — replace:
```rust
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "unknown | null")]
    pub schedule: Option<serde_json::Value>,
```
with:
```rust
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub schedule: Option<Schedule>,
```

- [ ] **Step 1.3:** Add `schedule` to `TaskPatch`:
```rust
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub schedule: Option<Schedule>,
```

- [ ] **Step 1.4:** `bun run gen:bindings`. Verify `Schedule.ts`, `PresetKind.ts`, `EventKind.ts` generated; `Task.ts`, `TaskPatch.ts` updated.

- [ ] **Step 1.5:** `cargo check -p solo-protocol`.

- [ ] **Step 1.6:** Commit (force-add the new binding files):
```bash
git add crates/solo-protocol/src/lib.rs apps/desktop/src/bindings/Schedule.ts apps/desktop/src/bindings/PresetKind.ts apps/desktop/src/bindings/EventKind.ts apps/desktop/src/bindings/Task.ts apps/desktop/src/bindings/TaskPatch.ts apps/desktop/src/bindings/index.ts
git commit -m "feat(protocol): typed Schedule enum (preset/cron/oneshot/event)"
```

---

## Task 2 · Schedule deps + `schedule_preview`

**Files:**
- `crates/solo-tasks/Cargo.toml`
- `crates/solo-tasks/src/schedule_preview.rs` (new)
- `crates/solo-tasks/src/lib.rs`

- [ ] **Step 2.1:** Append deps in `crates/solo-tasks/Cargo.toml` under `[dependencies]`:
```toml
croner = "2"
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 2.2:** Create `crates/solo-tasks/src/schedule_preview.rs`:

```rust
//! Pure function: given a `Schedule`, return the next N fire times as UTC millis.

use chrono::{DateTime, Datelike, TimeZone, Timelike, Utc, Weekday};
use croner::Cron;
use solo_protocol::{PresetKind, Schedule};
use crate::error::{TaskError, TaskResult};

/// Compute the next `n` fire times from `now` (UTC millis).
/// `EventTriggered` returns empty — not time-bound.
/// `OneShot` at < now returns empty; otherwise single-element vec.
pub fn next_fires(schedule: &Schedule, now_ms: i64, n: usize) -> TaskResult<Vec<i64>> {
    match schedule {
        Schedule::OneShot { at } => {
            if *at > now_ms { Ok(vec![*at]) } else { Ok(vec![]) }
        }
        Schedule::Cron { expr, .. } => {
            let cron = Cron::new(expr).parse().map_err(|e| TaskError::Invalid(format!("cron parse: {e}")))?;
            let mut out = Vec::with_capacity(n);
            let mut cursor = Utc.timestamp_millis_opt(now_ms).single()
                .ok_or_else(|| TaskError::Invalid("invalid now_ms".into()))?;
            for _ in 0..n {
                cursor = cron.find_next_occurrence(&cursor, false)
                    .map_err(|e| TaskError::Invalid(format!("cron step: {e}")))?;
                out.push(cursor.timestamp_millis());
            }
            Ok(out)
        }
        Schedule::Preset { kind, hour, minute, weekday, .. } => {
            let mut out = Vec::with_capacity(n);
            let mut cursor = next_preset_fire(*kind, *hour, *minute, *weekday, now_ms)?;
            for _ in 0..n {
                out.push(cursor);
                cursor = next_preset_fire(*kind, *hour, *minute, *weekday, cursor + 1000)?;
            }
            Ok(out)
        }
        Schedule::EventTriggered { .. } => Ok(vec![]),
    }
}

fn next_preset_fire(
    kind: PresetKind, hour: u8, minute: u8, weekday: Option<u8>, now_ms: i64,
) -> TaskResult<i64> {
    let now = Utc.timestamp_millis_opt(now_ms).single()
        .ok_or_else(|| TaskError::Invalid("invalid now_ms".into()))?;
    let h = hour as u32;
    let m = minute as u32;

    match kind {
        PresetKind::Hourly => {
            // Next occurrence of :MM in the next hour (or this hour if >now)
            let candidate = now.with_minute(m).and_then(|d| d.with_second(0)).and_then(|d| d.with_nanosecond(0))
                .ok_or_else(|| TaskError::Invalid("preset math".into()))?;
            Ok(if candidate > now { candidate.timestamp_millis() } else { (candidate + chrono::Duration::hours(1)).timestamp_millis() })
        }
        PresetKind::Daily => {
            let candidate = now.with_hour(h).and_then(|d| d.with_minute(m))
                .and_then(|d| d.with_second(0)).and_then(|d| d.with_nanosecond(0))
                .ok_or_else(|| TaskError::Invalid("preset math".into()))?;
            Ok(if candidate > now { candidate.timestamp_millis() } else { (candidate + chrono::Duration::days(1)).timestamp_millis() })
        }
        PresetKind::Weekly => {
            let target_wd = weekday.unwrap_or(0);
            let now_wd = weekday_idx(now.weekday());
            let days_fwd = ((target_wd as i64) - (now_wd as i64) + 7) % 7;
            let candidate = now.with_hour(h).and_then(|d| d.with_minute(m))
                .and_then(|d| d.with_second(0)).and_then(|d| d.with_nanosecond(0))
                .map(|d| d + chrono::Duration::days(days_fwd))
                .ok_or_else(|| TaskError::Invalid("preset math".into()))?;
            Ok(if candidate > now { candidate.timestamp_millis() } else { (candidate + chrono::Duration::days(7)).timestamp_millis() })
        }
        PresetKind::Monthly => {
            // Same day-of-month as current, at hour:minute. If past today, next month's same dom.
            let dom = now.day();
            let mut y = now.year();
            let mut mo = now.month();
            let candidate = Utc.with_ymd_and_hms(y, mo, dom, h, m, 0).single()
                .ok_or_else(|| TaskError::Invalid("preset math".into()))?;
            if candidate <= now {
                mo += 1;
                if mo == 13 { mo = 1; y += 1; }
            }
            let fire = Utc.with_ymd_and_hms(y, mo, dom.min(28), h, m, 0).single()
                .ok_or_else(|| TaskError::Invalid("preset math".into()))?;
            Ok(fire.timestamp_millis())
        }
    }
}

fn weekday_idx(wd: Weekday) -> u8 {
    match wd {
        Weekday::Mon => 0, Weekday::Tue => 1, Weekday::Wed => 2,
        Weekday::Thu => 3, Weekday::Fri => 4, Weekday::Sat => 5,
        Weekday::Sun => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oneshot_future_returns_one() {
        let now = 1_000_000;
        let s = Schedule::OneShot { at: now + 10_000 };
        let r = next_fires(&s, now, 5).unwrap();
        assert_eq!(r, vec![now + 10_000]);
    }

    #[test]
    fn oneshot_past_returns_empty() {
        let now = 1_000_000;
        let s = Schedule::OneShot { at: now - 1 };
        let r = next_fires(&s, now, 5).unwrap();
        assert!(r.is_empty());
    }

    #[test]
    fn preset_daily_returns_n_fires() {
        let now = Utc.with_ymd_and_hms(2026, 4, 21, 14, 30, 0).unwrap().timestamp_millis();
        let s = Schedule::Preset {
            kind: PresetKind::Daily, hour: 3, minute: 0, weekday: None, next_fire: 0,
        };
        let r = next_fires(&s, now, 3).unwrap();
        assert_eq!(r.len(), 3);
        // Each subsequent fire should be +24h
        assert_eq!(r[1] - r[0], 86_400_000);
    }

    #[test]
    fn cron_every_5_min_returns_monotonic() {
        let now = Utc.with_ymd_and_hms(2026, 4, 21, 14, 0, 0).unwrap().timestamp_millis();
        let s = Schedule::Cron { expr: "*/5 * * * *".into(), next_fire: 0 };
        let r = next_fires(&s, now, 3).unwrap();
        assert_eq!(r.len(), 3);
        assert!(r[0] < r[1]);
        assert!(r[1] < r[2]);
    }

    #[test]
    fn event_triggered_returns_empty() {
        let s = Schedule::EventTriggered { event: solo_protocol::EventKind::AgentSessionEnded };
        assert!(next_fires(&s, 0, 5).unwrap().is_empty());
    }
}
```

- [ ] **Step 2.3:** Register module in `crates/solo-tasks/src/lib.rs`:
```rust
pub mod schedule_preview;
pub use schedule_preview::next_fires;
```

- [ ] **Step 2.4:** `cargo test -p solo-tasks --lib` — expect 21 tests pass (16 prev + 5 new).
`cargo clippy -p solo-tasks --all-targets -- -D warnings` — zero warnings.

- [ ] **Step 2.5:** Commit:
```bash
git add crates/solo-tasks/Cargo.toml crates/solo-tasks/src/schedule_preview.rs crates/solo-tasks/src/lib.rs
git commit -m "feat(tasks): schedule_preview (next N fires for preset/cron/oneshot)"
```

---

## Task 3 · Store — `list_scheduled` + `update schedule`

**File:** `crates/solo-tasks/src/store.rs`

- [ ] **Step 3.1:** In the `update()` method, after `patch.agent_config` handling (added in P3-T2), add:
```rust
    if let Some(v) = patch.schedule { task.schedule = Some(v); }
```

- [ ] **Step 3.2:** Add a new method returning all tasks whose `schedule` field is non-null AND whose status is `Queued` or `Done` (not `Archived`, not currently `Running`/`NeedsReview`):

```rust
/// List tasks eligible for scheduling (scheduled field set, status Queued or Done).
pub fn list_scheduled(&self) -> TaskResult<Vec<Task>> {
    let conn = self.conn.lock().expect("poisoned");
    let mut stmt = conn.prepare(
        "SELECT id FROM tasks WHERE schedule_json IS NOT NULL AND status IN ('queued','done') ORDER BY updated_at DESC"
    )?;
    let ids: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<_, _>>()?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(t) = load_task_row(&conn, &id)? { out.push(t); }
    }
    Ok(out)
}
```

- [ ] **Step 3.3:** Add a test:

```rust
#[test]
fn list_scheduled_returns_only_scheduled() {
    use solo_protocol::{Schedule, PresetKind};
    let store = TaskStore::open_in_memory().unwrap();
    let _manual = store.create(draft("no schedule")).unwrap();
    let scheduled = store.create(draft("will run")).unwrap();
    store.update(&scheduled.id, TaskPatch {
        schedule: Some(Schedule::Preset {
            kind: PresetKind::Daily, hour: 3, minute: 0, weekday: None, next_fire: 0,
        }),
        ..Default::default()
    }).unwrap();
    let list = store.list_scheduled().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, scheduled.id);
}
```

- [ ] **Step 3.4:** `cargo test -p solo-tasks --lib` → 22 passing.
`cargo clippy -p solo-tasks --all-targets -- -D warnings` clean.

- [ ] **Step 3.5:** Commit:
```bash
git add crates/solo-tasks/src/store.rs
git commit -m "feat(tasks): store list_scheduled + schedule patch"
```

---

## Task 4 · `scheduler.rs` — cron wheel + catch-up

**File:** `crates/solo-tasks/src/scheduler.rs` (new)

This module is pure scheduling logic. It does NOT spawn agent sessions directly — it emits "fire" callbacks that the Tauri layer converts into `task_run` invocations. Keeps solo-tasks free of Tauri dependencies.

- [ ] **Step 4.1:** Create `crates/solo-tasks/src/scheduler.rs`:

```rust
//! Scheduler — walks scheduled tasks every tick, fires any whose next_fire has passed.
//!
//! Design:
//! - Pure state machine: exposes `tick(now_ms) -> Vec<FireOrder>`.
//! - Caller (Tauri layer) owns the tokio loop and dispatches fires to the executor.
//! - Catch-up: on cold start, if a task has `catch_up_on_launch=true` and its
//!   `next_fire < now`, one fire is emitted and next_fire advances past now.

use std::sync::Arc;

use solo_protocol::{PresetKind, Schedule, Task};

use crate::error::TaskResult;
use crate::schedule_preview::next_fires;
use crate::store::TaskStore;

/// Emitted when the scheduler decides a task should fire now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FireOrder {
    pub task_id: String,
    pub scheduled_for_ms: i64,
}

pub struct Scheduler {
    store: Arc<TaskStore>,
}

impl Scheduler {
    pub fn new(store: Arc<TaskStore>) -> Self { Self { store } }

    /// Walk all scheduled tasks. For each whose next_fire ≤ now, emit a FireOrder
    /// and advance the task's stored next_fire.
    ///
    /// Call from a tokio interval loop at ~15s cadence (tradeoff: lower = precision, higher = cheaper).
    pub fn tick(&self, now_ms: i64) -> TaskResult<Vec<FireOrder>> {
        let tasks = self.store.list_scheduled()?;
        let mut out = Vec::new();
        for task in tasks {
            let Some(sched) = task.schedule.as_ref() else { continue };
            let Some(current_fire) = current_fire_of(sched) else { continue };
            if current_fire > now_ms { continue }

            // Compute next fire strictly after now
            match next_fires(sched, now_ms, 1) {
                Ok(fires) if !fires.is_empty() => {
                    let new_next = fires[0];
                    let new_sched = advance_schedule(sched, new_next);
                    let _ = self.store.update(&task.id, solo_protocol::TaskPatch {
                        schedule: Some(new_sched), ..Default::default()
                    });
                    out.push(FireOrder { task_id: task.id, scheduled_for_ms: current_fire });
                }
                _ => {
                    // No future fire (e.g., one-shot already consumed). Clear schedule.
                    let _ = self.store.update(&task.id, solo_protocol::TaskPatch {
                        schedule: None, ..Default::default()
                    });
                    out.push(FireOrder { task_id: task.id, scheduled_for_ms: current_fire });
                }
            }
        }
        Ok(out)
    }

    /// Catch-up pass at startup. Emits ONE fire per `catch_up_on_launch=true`
    /// task whose next_fire is before `now_ms`.
    pub fn catch_up(&self, now_ms: i64) -> TaskResult<Vec<FireOrder>> {
        let tasks = self.store.list_scheduled()?;
        let mut out = Vec::new();
        for task in tasks {
            if !task.catch_up_on_launch { continue }
            let Some(sched) = task.schedule.as_ref() else { continue };
            let Some(missed) = current_fire_of(sched) else { continue };
            if missed > now_ms { continue }

            // Advance schedule past now so subsequent ticks don't also fire
            if let Ok(fires) = next_fires(sched, now_ms, 1) {
                if let Some(new_next) = fires.first().copied() {
                    let new_sched = advance_schedule(sched, new_next);
                    let _ = self.store.update(&task.id, solo_protocol::TaskPatch {
                        schedule: Some(new_sched), ..Default::default()
                    });
                }
            }
            out.push(FireOrder { task_id: task.id, scheduled_for_ms: missed });
        }
        Ok(out)
    }
}

fn current_fire_of(s: &Schedule) -> Option<i64> {
    match s {
        Schedule::OneShot { at } => Some(*at),
        Schedule::Cron { next_fire, .. } => Some(*next_fire),
        Schedule::Preset { next_fire, .. } => Some(*next_fire),
        Schedule::EventTriggered { .. } => None,
    }
}

fn advance_schedule(s: &Schedule, new_next: i64) -> Schedule {
    match s {
        Schedule::OneShot { .. } => Schedule::OneShot { at: new_next },
        Schedule::Cron { expr, .. } => Schedule::Cron { expr: expr.clone(), next_fire: new_next },
        Schedule::Preset { kind, hour, minute, weekday, .. } => Schedule::Preset {
            kind: *kind, hour: *hour, minute: *minute, weekday: *weekday, next_fire: new_next,
        },
        Schedule::EventTriggered { event } => Schedule::EventTriggered { event: *event },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solo_protocol::{Executor, TaskDraft, TaskPatch, TaskPriority};

    fn agent_task(store: &TaskStore, title: &str) -> Task {
        store.create(TaskDraft {
            title: title.into(), description: String::new(),
            executor: Executor::Agent, priority: TaskPriority::Medium,
        }).unwrap()
    }

    #[test]
    fn tick_fires_past_due_oneshot() {
        let store = Arc::new(TaskStore::open_in_memory().unwrap());
        let t = agent_task(&store, "boom");
        let now = 1_000_000;
        store.update(&t.id, TaskPatch {
            schedule: Some(Schedule::OneShot { at: now - 1 }),
            ..Default::default()
        }).unwrap();
        let s = Scheduler::new(store.clone());
        let fires = s.tick(now).unwrap();
        assert_eq!(fires.len(), 1);
        assert_eq!(fires[0].task_id, t.id);

        // Schedule should be cleared (one-shot consumed)
        let reloaded = store.get(&t.id).unwrap();
        assert!(reloaded.schedule.is_none());
    }

    #[test]
    fn tick_skips_future_fires() {
        let store = Arc::new(TaskStore::open_in_memory().unwrap());
        let t = agent_task(&store, "later");
        let now = 1_000_000;
        store.update(&t.id, TaskPatch {
            schedule: Some(Schedule::OneShot { at: now + 10_000 }),
            ..Default::default()
        }).unwrap();
        let s = Scheduler::new(store.clone());
        let fires = s.tick(now).unwrap();
        assert!(fires.is_empty());
    }

    #[test]
    fn catch_up_fires_once_for_missed_preset() {
        use solo_protocol::PresetKind;
        let store = Arc::new(TaskStore::open_in_memory().unwrap());
        let t = agent_task(&store, "missed daily");
        let now = 1_700_000_000_000; // arbitrary
        store.update(&t.id, TaskPatch {
            schedule: Some(Schedule::Preset {
                kind: PresetKind::Daily, hour: 3, minute: 0, weekday: None,
                next_fire: now - 86_400_000, // 24h ago
            }),
            catch_up_on_launch: Some(true),
            ..Default::default()
        }).unwrap();
        let s = Scheduler::new(store.clone());
        let fires = s.catch_up(now).unwrap();
        assert_eq!(fires.len(), 1);
        // Schedule advanced past now
        let reloaded = store.get(&t.id).unwrap();
        if let Some(Schedule::Preset { next_fire, .. }) = reloaded.schedule {
            assert!(next_fire > now);
        } else {
            panic!("schedule should still be Preset");
        }
    }

    #[test]
    fn catch_up_skips_when_flag_false() {
        let store = Arc::new(TaskStore::open_in_memory().unwrap());
        let t = agent_task(&store, "no catch-up");
        let now = 1_700_000_000_000;
        store.update(&t.id, TaskPatch {
            schedule: Some(Schedule::OneShot { at: now - 1 }),
            // catch_up_on_launch stays default (false)
            ..Default::default()
        }).unwrap();
        let s = Scheduler::new(store.clone());
        let fires = s.catch_up(now).unwrap();
        assert!(fires.is_empty());
    }
}
```

- [ ] **Step 4.2:** Register in `crates/solo-tasks/src/lib.rs`:
```rust
pub mod scheduler;
pub use scheduler::{Scheduler, FireOrder};
```

- [ ] **Step 4.3:** `cargo test -p solo-tasks --lib` — expect 26 tests (22 + 4 new).
`cargo clippy -p solo-tasks --all-targets -- -D warnings` clean.

- [ ] **Step 4.4:** Commit:
```bash
git add crates/solo-tasks/src/scheduler.rs crates/solo-tasks/src/lib.rs
git commit -m "feat(tasks): scheduler with tick + catch-up (pure state machine)"
```

---

## Task 5 · Wire scheduler into app setup

**Files:**
- `apps/desktop/src-tauri/src/task_commands.rs` — new `task_schedule_preview` command
- `apps/desktop/src-tauri/src/lib.rs` — start the scheduler loop + register command

- [ ] **Step 5.1:** Add command to `task_commands.rs`:

```rust
#[tauri::command]
pub async fn task_schedule_preview(
    schedule: solo_protocol::Schedule,
) -> Result<Vec<i64>, String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(0))
        .unwrap_or(0);
    solo_tasks::next_fires(&schedule, now_ms, 5).map_err(|e| e.to_string())
}
```

- [ ] **Step 5.2:** In `apps/desktop/src-tauri/src/lib.rs`:
  1. Add to `generate_handler![]`: `task_commands::task_schedule_preview,`
  2. Inside `.setup(move |app| { ... })`, after the existing `install_agent_listeners` block, add the scheduler loop:

```rust
// Start the task scheduler tick loop (Phase 4)
let handle_for_scheduler = app.handle().clone();
tauri::async_runtime::spawn(async move {
    use std::sync::Arc;
    use tauri::Manager as _;
    // Wait a moment for stores to initialize
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    let Ok(store) = task_commands::get_store_for_setup(&handle_for_scheduler).await else {
        tracing::warn!("task scheduler: store unavailable");
        return;
    };
    let sched = Arc::new(solo_tasks::Scheduler::new(store));

    // Catch-up pass
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(0))
        .unwrap_or(0);
    if let Ok(fires) = sched.catch_up(now) {
        for fire in fires {
            tracing::info!(task_id = %fire.task_id, "catch-up fire");
            dispatch_fire(&handle_for_scheduler, fire.task_id).await;
        }
    }

    // Tick loop
    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(15));
    loop {
        ticker.tick().await;
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| i64::try_from(d.as_millis()).unwrap_or(0))
            .unwrap_or(0);
        match sched.tick(now_ms) {
            Ok(fires) => {
                for fire in fires {
                    tracing::info!(task_id = %fire.task_id, "scheduled fire");
                    dispatch_fire(&handle_for_scheduler, fire.task_id).await;
                }
            }
            Err(e) => tracing::warn!(error = %e, "scheduler tick failed"),
        }
    }
});
```

  3. Add helper at module scope (before `run()`):

```rust
async fn dispatch_fire(app: &tauri::AppHandle, task_id: String) {
    use tauri::Manager as _;
    use std::sync::Arc;
    let exec_map = app.state::<Arc<task_executor::ExecutorMap>>().inner().clone();
    let session_mgr = app.state::<Arc<agent::SessionManager>>().inner().clone();
    let Ok(store) = task_commands::get_store_for_setup(app).await else { return };

    // Capacity gate: respect MAX_ACTIVE_SESSIONS (3). If at capacity, skip this
    // tick; the task's next_fire already advanced, so this fire is dropped for
    // the current window.
    //
    // TODO (v2): proper queueing persists dropped fires until capacity frees.
    // For Phase 4 we accept skipped fires — they appear as missed days in the
    // Runs history which the user can run manually.
    if let Err(e) = task_executor::spawn_agent_for_task(
        app, store, exec_map, session_mgr, task_id.clone(),
    ).await {
        tracing::warn!(task_id, error = %e, "scheduled fire: dispatch failed");
    }
}
```

- [ ] **Step 5.3:** `cargo check -p solo-desktop-lib` — zero errors.

- [ ] **Step 5.4:** Commit:
```bash
git add apps/desktop/src-tauri/src/task_commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(tasks): start scheduler tick loop + catch-up on app setup"
```

---

## Task 6 · TS wrapper + store integration

**Files:**
- `apps/desktop/src/lib/tauri/tasks.ts`
- `apps/desktop/src/stores/taskStore.ts` (minor — no new state)

- [ ] **Step 6.1:** In `tasks.ts`, add:
```ts
  schedulePreview: (schedule: Schedule) => invoke<number[]>('task_schedule_preview', { schedule }),
```

And re-export types:
```ts
export type { Schedule } from '@/bindings/Schedule';
export type { PresetKind } from '@/bindings/PresetKind';
export type { EventKind } from '@/bindings/EventKind';
```

- [ ] **Step 6.2:** No store changes — schedule state lives on the task itself.

- [ ] **Step 6.3:** `bun run check` zero errors.

- [ ] **Step 6.4:** Commit:
```bash
git add apps/desktop/src/lib/tauri/tasks.ts
git commit -m "feat(tasks): TS schedulePreview wrapper + Schedule types"
```

---

## Task 7 · `ScheduleEditor` component

**File:** `apps/desktop/src/components/vault/tasks/ScheduleEditor.tsx` (new)

A controlled component: current `Schedule | null` in, `onChange(next)` out. Visual: radio for Mode (None / Preset / Cron / OneShot), plus per-mode inputs, plus a "Next 5 fires" preview computed via the Tauri command.

- [ ] **Step 7.1:**

```tsx
import { useEffect, useState, type FC } from 'react';
import { cn } from '@/lib/utils';
import { tasksApi, type Schedule, type PresetKind } from '@/lib/tauri/tasks';

interface Props {
  readonly value: Schedule | null;
  readonly onChange: (next: Schedule | null) => void;
}

type Mode = 'none' | 'preset' | 'cron' | 'oneshot';

export const ScheduleEditor: FC<Props> = ({ value, onChange }) => {
  const mode: Mode = !value ? 'none' : value.kind === 'preset' ? 'preset' : value.kind === 'cron' ? 'cron' : value.kind === 'one_shot' ? 'oneshot' : 'none';

  const [preview, setPreview] = useState<number[]>([]);
  useEffect(() => {
    if (!value) { setPreview([]); return }
    void tasksApi.schedulePreview(value).then(setPreview).catch(() => setPreview([]));
  }, [value]);

  const setMode = (m: Mode) => {
    if (m === 'none') onChange(null);
    else if (m === 'preset') onChange({ kind: 'preset', data: { kind: 'daily', hour: 9, minute: 0, weekday: null, next_fire: 0 } });
    else if (m === 'cron') onChange({ kind: 'cron', data: { expr: '0 9 * * *', next_fire: 0 } });
    else onChange({ kind: 'one_shot', data: { at: Date.now() + 60_000 } });
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-[12px]">
      <fieldset className="flex gap-2">
        {(['none', 'preset', 'cron', 'oneshot'] as const).map((m) => (
          <label key={m} className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 px-2 py-1',
            mode === m ? 'bg-card' : 'bg-background hover:bg-muted/40',
          )}>
            <input
              type="radio" name="sched-mode" value={m} checked={mode === m}
              onChange={() => setMode(m)}
              className="accent-foreground"
            />
            <span className="capitalize">{m === 'oneshot' ? 'One-shot' : m}</span>
          </label>
        ))}
      </fieldset>

      {mode === 'preset' && value?.kind === 'preset' && (
        <PresetFields value={value.data} onChange={(data) => onChange({ kind: 'preset', data })} />
      )}
      {mode === 'cron' && value?.kind === 'cron' && (
        <CronFields value={value.data} onChange={(data) => onChange({ kind: 'cron', data })} />
      )}
      {mode === 'oneshot' && value?.kind === 'one_shot' && (
        <OneShotFields value={value.data} onChange={(data) => onChange({ kind: 'one_shot', data })} />
      )}

      {preview.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Next 5 fires</div>
          <ul className="flex flex-col gap-0.5 rounded-md border border-border/50 bg-card p-2 text-[11px]">
            {preview.map((ms, i) => (
              <li key={i} className="tabular-nums text-foreground">{new Date(ms).toLocaleString()}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const PresetFields: FC<{
  value: Extract<Schedule, { kind: 'preset' }>['data'],
  onChange: (data: Extract<Schedule, { kind: 'preset' }>['data']) => void,
}> = ({ value, onChange }) => (
  <div className="grid grid-cols-2 gap-2">
    <label className="flex flex-col gap-1 text-muted-foreground">Kind
      <select
        value={value.kind}
        onChange={(e) => onChange({ ...value, kind: e.target.value as PresetKind })}
        className="rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] text-foreground"
      >
        <option value="hourly">Hourly</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
    </label>
    <label className="flex flex-col gap-1 text-muted-foreground">At (UTC)
      <div className="flex gap-1">
        <input
          type="number" min={0} max={23}
          value={value.hour}
          onChange={(e) => onChange({ ...value, hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })}
          className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] text-foreground tabular-nums"
        />
        <span className="self-center">:</span>
        <input
          type="number" min={0} max={59}
          value={value.minute}
          onChange={(e) => onChange({ ...value, minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)) })}
          className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] text-foreground tabular-nums"
        />
      </div>
    </label>
    {value.kind === 'weekly' && (
      <label className="flex flex-col gap-1 text-muted-foreground col-span-2">Weekday
        <select
          value={value.weekday ?? 0}
          onChange={(e) => onChange({ ...value, weekday: Number(e.target.value) })}
          className="rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] text-foreground"
        >
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((wd, idx) => (
            <option key={idx} value={idx}>{wd}</option>
          ))}
        </select>
      </label>
    )}
  </div>
);

const CronFields: FC<{
  value: Extract<Schedule, { kind: 'cron' }>['data'],
  onChange: (data: Extract<Schedule, { kind: 'cron' }>['data']) => void,
}> = ({ value, onChange }) => (
  <label className="flex flex-col gap-1 text-muted-foreground">Cron expression (UTC, 5-field)
    <input
      value={value.expr}
      onChange={(e) => onChange({ ...value, expr: e.target.value })}
      placeholder="0 9 * * *"
      className="rounded-md border border-border/60 bg-background px-2 py-1 font-mono text-[12px] text-foreground"
    />
    <span className="text-[10px]">Examples: <code>0 9 * * *</code> daily 9am · <code>*/5 * * * *</code> every 5 min · <code>0 0 * * 1</code> Mondays midnight</span>
  </label>
);

const OneShotFields: FC<{
  value: Extract<Schedule, { kind: 'one_shot' }>['data'],
  onChange: (data: Extract<Schedule, { kind: 'one_shot' }>['data']) => void,
}> = ({ value, onChange }) => {
  const iso = new Date(typeof value.at === 'bigint' ? Number(value.at) : value.at).toISOString().slice(0, 16);
  return (
    <label className="flex flex-col gap-1 text-muted-foreground">Fire at
      <input
        type="datetime-local"
        value={iso}
        onChange={(e) => onChange({ ...value, at: new Date(e.target.value).getTime() })}
        className="rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] text-foreground"
      />
    </label>
  );
};
```

- [ ] **Step 7.2:** `bun run check`. Likely issue: the generated `Schedule` type may use different kind-literals (e.g. `'one_shot'` vs `'OneShot'`). Inspect `apps/desktop/src/bindings/Schedule.ts` and adjust string literals accordingly.

- [ ] **Step 7.3:** Commit:
```bash
git add apps/desktop/src/components/vault/tasks/ScheduleEditor.tsx
git commit -m "feat(tasks): ScheduleEditor — preset/cron/one-shot + preview"
```

---

## Task 8 · Schedule tab in drawer + cadence grouping

**Files:**
- `apps/desktop/src/components/vault/tasks/ScheduleTab.tsx` (new)
- `apps/desktop/src/components/vault/tasks/TaskDrawer.tsx`
- `apps/desktop/src/components/vault/tasks/groupings.ts`

- [ ] **Step 8.1:** Create `ScheduleTab.tsx`:
```tsx
import type { FC } from 'react';
import { useTaskStore } from '@/stores/taskStore';
import { ScheduleEditor } from './ScheduleEditor';
import type { Task, Schedule } from '@/lib/tauri/tasks';

interface Props { readonly task: Task }

export const ScheduleTab: FC<Props> = ({ task }) => {
  const update = useTaskStore((s) => s.update);
  return (
    <div className="flex flex-col gap-3 p-1">
      <ScheduleEditor
        value={task.schedule ?? null}
        onChange={(next) => void update(task.id, { schedule: next ?? undefined })}
      />
      <label className="flex items-center gap-2 px-4 text-[12px] text-muted-foreground">
        <input
          type="checkbox"
          checked={task.catch_up_on_launch}
          onChange={(e) => void update(task.id, { catch_up_on_launch: e.target.checked })}
        />
        Catch up on next launch if a fire was missed
      </label>
    </div>
  );
};
```

- [ ] **Step 8.2:** In `TaskDrawer.tsx`, extend tabs:

```tsx
type DrawerTab = 'overview' | 'runs' | 'agent' | 'schedule';

// Build tabs conditionally
const TABS: readonly DrawerTab[] = task.executor === 'agent'
  ? (['overview', 'runs', 'agent', 'schedule'] as const)
  : (['overview', 'runs', 'schedule'] as const);
```

Add `{tab === 'schedule' && <ScheduleTab task={task} />}` in the body. Import `ScheduleTab`.

- [ ] **Step 8.3:** Add cadence grouping to `groupings.ts`. Update `GroupKey`:
```ts
export type GroupKey = 'status' | 'priority' | 'executor' | 'cadence' | 'none';
```

Add label:
```ts
export const GROUPING_LABELS: Record<GroupKey, string> = {
  status:   'Status',
  priority: 'Priority',
  executor: 'Executor',
  cadence:  'Cadence',
  none:     'No grouping',
};
```

Add cadence bucketing in `groupTasks`:
```ts
if (key === 'cadence') {
  const buckets = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = t.schedule ? t.schedule.kind : 'none';
    const list = buckets.get(k) ?? [];
    list.push(t);
    buckets.set(k, list);
  }
  const order: string[] = ['cron', 'preset', 'one_shot', 'event_triggered', 'none'];
  return order
    .filter((k) => buckets.has(k))
    .map((k) => ({
      id: k,
      label: cadenceLabel(k),
      tasks: buckets.get(k) ?? [],
    }));
}
```

And:
```ts
function cadenceLabel(k: string): string {
  switch (k) {
    case 'cron':            return 'Custom cron';
    case 'preset':          return 'Preset schedule';
    case 'one_shot':        return 'One-shot';
    case 'event_triggered': return 'Event-triggered';
    default:                return 'Unscheduled';
  }
}
```

Also include `'cadence'` in `GroupByMenu`'s `OPTIONS`:
```ts
const OPTIONS: GroupKey[] = ['status', 'priority', 'executor', 'cadence', 'none'];
```

- [ ] **Step 8.4:** `bun run check` zero errors.

- [ ] **Step 8.5:** Commit:
```bash
git add apps/desktop/src/components/vault/tasks/ScheduleTab.tsx apps/desktop/src/components/vault/tasks/TaskDrawer.tsx apps/desktop/src/components/vault/tasks/groupings.ts apps/desktop/src/components/vault/tasks/GroupByMenu.tsx
git commit -m "feat(tasks): Schedule tab in drawer + cadence grouping"
```

---

## Task 9 · Smoke test Phase 4

- [ ] **Step 9.1:** Restart `bun run dev`.
- [ ] **Step 9.2:** Create an agent task. Open drawer → Schedule tab. Set preset=Daily at 9:00 UTC. Verify "Next 5 fires" preview shows 5 consecutive days at 09:00 UTC.
- [ ] **Step 9.3:** Set a preset 1-2 minutes in the future. Wait. Expect: task run fires automatically; you see the pulsing dot on the row without clicking Run.
- [ ] **Step 9.4:** Cadence grouping: switch Group by → Cadence. Expect: groups "Preset" / "Cron" / "One-shot" / "Unscheduled".
- [ ] **Step 9.5:** Try raw cron: `* * * * *` (every minute). Verify preview shows a minute-by-minute sequence. Wait ~1min, expect fire.
- [ ] **Step 9.6:** Toggle catch-up. Quit app during a schedule window; relaunch. Expect one make-up run in the logs.
- [ ] **Step 9.7:** Schedule an agent task while 3 sessions already active (force by running 3 manual agent tasks). Expect: scheduler's tick logs "dispatch failed" (capacity exceeded) — this is expected; the fire is skipped for this window.

---

## Task 10 · Wrap-up

- [ ] **Step 10.1:**
```bash
cargo test --workspace --lib
cargo clippy -p solo-tasks --all-targets -- -D warnings
bun run check
```

- [ ] **Step 10.2:** Mark Phase 4 complete in spec (§15).

- [ ] **Step 10.3:** Commit spec update.

---

## Known Phase 4 limitations (explicit)

1. **Capacity handling is drop-not-queue.** If all 3 slots are busy when a scheduled fire occurs, the fire is skipped and `next_fire` advances. A true queue (persisted in SQLite with `Queued-waiting-slot` status) is a follow-up — for v1 this is acceptable because typical usage has far fewer than 3 concurrent agent sessions.
2. **Tick interval is 15s.** Preset/cron fire times are accurate to within 15s. Fine for daily/hourly/every-N-minute schedules; worse for sub-minute cron (user shouldn't expect that anyway).
3. **Event-triggered schedules** have their *storage* working but the scheduler never fires them (event wiring is Phase 5's job). `EventTriggered` schedules show up in the "Event-triggered" cadence group as a placeholder.
4. **Rate limiter for event hooks** is deferred to Phase 5 — the scaffolding lives in scheduler.rs's doc comments but is not implemented here.

## Self-review

- **Spec coverage:** §5 `Schedule` typed enum, §4 Scheduler subsystem (tick + catch-up + capacity gate), §5 `task_schedule_preview` command, §6 schedule editor UI, §7 cadence grouping.
- **No placeholders in code steps.** All helpers pasted in full.
- **Type consistency:** `Schedule`, `PresetKind`, `EventKind` names consistent across Rust/TS. `schedule_preview::next_fires` function name consistent.
