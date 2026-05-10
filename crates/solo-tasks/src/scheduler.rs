//! Scheduler — walks scheduled tasks every tick, fires any whose `next_fire` has passed.
//!
//! Design:
//! - Pure state machine: exposes `tick(now_ms) -> Vec<FireOrder>`.
//! - Caller (Tauri layer) owns the tokio loop and dispatches fires to the executor.
//! - Catch-up: on cold start, if a task has `catch_up_on_launch=true` and its
//!   `next_fire` < now, one fire is emitted and `next_fire` advances past now.

use std::sync::Arc;

use solo_protocol::Schedule;

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
    pub fn new(store: Arc<TaskStore>) -> Self {
        Self { store }
    }

    /// Walk all scheduled tasks. For each whose `next_fire` ≤ now, emit a [`FireOrder`]
    /// and advance the task's stored `next_fire`.
    ///
    /// Call from a tokio interval loop at ~15s cadence (tradeoff: lower = precision, higher = cheaper).
    pub fn tick(&self, now_ms: i64) -> TaskResult<Vec<FireOrder>> {
        let tasks = self.store.list_scheduled()?;
        let mut out = Vec::new();
        for task in tasks {
            let Some(sched) = task.schedule.as_ref() else {
                continue;
            };
            let Some(current_fire) = current_fire_of(sched) else {
                continue;
            };
            if current_fire > now_ms {
                continue;
            }

            // Compute next fire strictly after now
            match next_fires(sched, now_ms, 1) {
                Ok(fires) if !fires.is_empty() => {
                    let new_next = fires[0];
                    let new_sched = advance_schedule(sched, new_next);
                    let _ = self.store.update(
                        &task.id,
                        solo_protocol::TaskPatch {
                            schedule: Some(new_sched),
                            ..Default::default()
                        },
                    );
                    out.push(FireOrder {
                        task_id: task.id,
                        scheduled_for_ms: current_fire,
                    });
                }
                _ => {
                    // No future fire (e.g., one-shot already consumed). Clear schedule.
                    let _ = self.store.clear_schedule(&task.id);
                    out.push(FireOrder {
                        task_id: task.id,
                        scheduled_for_ms: current_fire,
                    });
                }
            }
        }
        Ok(out)
    }

    /// Catch-up pass at startup. Emits ONE fire per `catch_up_on_launch=true`
    /// task whose `next_fire` is before `now_ms`.
    pub fn catch_up(&self, now_ms: i64) -> TaskResult<Vec<FireOrder>> {
        let tasks = self.store.list_scheduled()?;
        let mut out = Vec::new();
        for task in tasks {
            if !task.catch_up_on_launch {
                continue;
            }
            let Some(sched) = task.schedule.as_ref() else {
                continue;
            };
            let Some(missed) = current_fire_of(sched) else {
                continue;
            };
            if missed > now_ms {
                continue;
            }

            // Advance schedule past now so subsequent ticks don't also fire
            if let Ok(fires) = next_fires(sched, now_ms, 1) {
                if let Some(new_next) = fires.first().copied() {
                    let new_sched = advance_schedule(sched, new_next);
                    let _ = self.store.update(
                        &task.id,
                        solo_protocol::TaskPatch {
                            schedule: Some(new_sched),
                            ..Default::default()
                        },
                    );
                }
            }
            out.push(FireOrder {
                task_id: task.id,
                scheduled_for_ms: missed,
            });
        }
        Ok(out)
    }
}

fn current_fire_of(s: &Schedule) -> Option<i64> {
    match s {
        Schedule::OneShot { at } => Some(*at),
        Schedule::Cron { next_fire, .. } | Schedule::Preset { next_fire, .. } => Some(*next_fire),
        Schedule::EventTriggered { .. } => None,
    }
}

fn advance_schedule(s: &Schedule, new_next: i64) -> Schedule {
    match s {
        Schedule::OneShot { .. } => Schedule::OneShot { at: new_next },
        Schedule::Cron { expr, .. } => Schedule::Cron {
            expr: expr.clone(),
            next_fire: new_next,
        },
        Schedule::Preset {
            kind,
            hour,
            minute,
            weekday,
            ..
        } => Schedule::Preset {
            kind: *kind,
            hour: *hour,
            minute: *minute,
            weekday: *weekday,
            next_fire: new_next,
        },
        Schedule::EventTriggered { event } => Schedule::EventTriggered { event: *event },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solo_protocol::{Executor, Task, TaskDraft, TaskPatch, TaskPriority};

    fn agent_task(store: &TaskStore, title: &str) -> Task {
        store
            .create(TaskDraft {
                title: title.into(),
                description: String::new(),
                executor: Executor::Agent,
                priority: TaskPriority::Medium,
                subtasks: Vec::new(),
                label_ids: Vec::new(),
                project_id: None,
                cycle_id: None,
            })
            .unwrap()
    }

    #[test]
    fn tick_fires_past_due_oneshot() {
        let store = Arc::new(TaskStore::open_in_memory().unwrap());
        let t = agent_task(&store, "boom");
        let now = 1_000_000;
        store
            .update(
                &t.id,
                TaskPatch {
                    schedule: Some(Schedule::OneShot { at: now - 1 }),
                    ..Default::default()
                },
            )
            .unwrap();
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
        store
            .update(
                &t.id,
                TaskPatch {
                    schedule: Some(Schedule::OneShot { at: now + 10_000 }),
                    ..Default::default()
                },
            )
            .unwrap();
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
        store
            .update(
                &t.id,
                TaskPatch {
                    schedule: Some(Schedule::Preset {
                        kind: PresetKind::Daily,
                        hour: 3,
                        minute: 0,
                        weekday: None,
                        next_fire: now - 86_400_000, // 24h ago
                    }),
                    catch_up_on_launch: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
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
        store
            .update(
                &t.id,
                TaskPatch {
                    schedule: Some(Schedule::OneShot { at: now - 1 }),
                    // catch_up_on_launch stays default (false)
                    ..Default::default()
                },
            )
            .unwrap();
        let s = Scheduler::new(store.clone());
        let fires = s.catch_up(now).unwrap();
        assert!(fires.is_empty());
    }
}
