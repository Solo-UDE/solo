//! SQLite-backed task store (FTS5 in Task 5).

use std::path::Path;
use std::sync::Mutex;
use rusqlite::{Connection, OptionalExtension, params};
use solo_protocol::{
    Executor, RunOutcome, Task, TaskDraft, TaskListFilters,
    TaskOrigin, TaskPatch, TaskPriority, TaskRun, TaskStatus,
};
use uuid::Uuid;

use crate::error::{TaskError, TaskResult};

pub struct TaskStore {
    conn: Mutex<Connection>,
}

impl TaskStore {
    /// Open (or create) the task store at `db_path`. Parent dir must exist.
    pub fn open(db_path: &Path) -> TaskResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        let store = Self { conn: Mutex::new(conn) };
        store.migrate()?;
        Ok(store)
    }

    /// Open in memory (tests).
    #[cfg(test)]
    pub fn open_in_memory() -> TaskResult<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn: Mutex::new(conn) };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> TaskResult<()> {
        let conn = self.conn.lock().expect("poisoned");
        conn.execute_batch(
            r"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL,
                executor TEXT NOT NULL,
                priority TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                agent_config_json TEXT,
                schedule_json TEXT,
                context_anchors_json TEXT NOT NULL DEFAULT '[]',
                last_error TEXT,
                catch_up_on_launch INTEGER NOT NULL DEFAULT 0,
                origin_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task_runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                outcome TEXT NOT NULL,
                session_id TEXT,
                worktree_id TEXT,
                summary TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_updated   ON tasks(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_task_runs_task  ON task_runs(task_id, started_at DESC);

            CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
                title, description, content='tasks', content_rowid='rowid',
                tokenize='porter unicode61'
            );

            CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
                INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
            END;
            CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
                INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
            END;
            CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
                INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
                INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
            END;
            ",
        )?;
        Ok(())
    }

    // ---- CRUD -----------------------------------------------------------

    pub fn create(&self, draft: TaskDraft) -> TaskResult<Task> {
        let now = now_ms();
        let id = Uuid::new_v4().to_string();
        let task = Task {
            id: id.clone(),
            title: draft.title,
            description: draft.description,
            status: TaskStatus::Queued,
            executor: draft.executor,
            priority: draft.priority,
            created_at: now,
            updated_at: now,
            agent_config: None,
            schedule: None,
            context_anchors: Vec::new(),
            runs: Vec::new(),
            last_error: None,
            catch_up_on_launch: false,
            origin: TaskOrigin::Manual,
        };
        self.insert(&task)?;
        Ok(task)
    }

    pub fn get(&self, id: &str) -> TaskResult<Task> {
        let conn = self.conn.lock().expect("poisoned");
        let task = load_task_row(&conn, id)?
            .ok_or_else(|| TaskError::NotFound(id.to_string()))?;
        Ok(task)
    }

    pub fn list(&self, filter: &TaskListFilters) -> TaskResult<Vec<Task>> {
        let conn = self.conn.lock().expect("poisoned");
        let mut sql = String::from("SELECT id FROM tasks");
        let mut clauses: Vec<String> = Vec::new();
        let mut params_vec: Vec<String> = Vec::new();

        if let Some(statuses) = &filter.status {
            if !statuses.is_empty() {
                let placeholders = statuses.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                clauses.push(format!("status IN ({placeholders})"));
                for s in statuses {
                    params_vec.push(status_str(*s).to_string());
                }
            }
        }
        if let Some(exec) = filter.executor {
            clauses.push("executor = ?".into());
            params_vec.push(executor_str(exec).to_string());
        }
        if let Some(prios) = &filter.priority {
            if !prios.is_empty() {
                let placeholders = prios.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                clauses.push(format!("priority IN ({placeholders})"));
                for p in prios {
                    params_vec.push(priority_str(*p).to_string());
                }
            }
        }
        if !clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&clauses.join(" AND "));
        }
        sql.push_str(" ORDER BY updated_at DESC");

        let mut stmt = conn.prepare(&sql)?;
        let ids: Vec<String> = stmt
            .query_map(
                rusqlite::params_from_iter(params_vec.iter()),
                |row| row.get::<_, String>(0),
            )?
            .collect::<Result<_, _>>()?;

        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(t) = load_task_row(&conn, &id)? {
                // Optional FTS query match
                if let Some(q) = &filter.query {
                    let needle = q.to_lowercase();
                    if !t.title.to_lowercase().contains(&needle)
                        && !t.description.to_lowercase().contains(&needle) {
                        continue;
                    }
                }
                out.push(t);
            }
        }
        Ok(out)
    }

    pub fn update(&self, id: &str, patch: TaskPatch) -> TaskResult<Task> {
        let mut task = self.get(id)?;
        if let Some(v) = patch.title { task.title = v; }
        if let Some(v) = patch.description { task.description = v; }
        if let Some(v) = patch.status { task.status = v; }
        if let Some(v) = patch.priority { task.priority = v; }
        if let Some(v) = patch.agent_config { task.agent_config = Some(v); }
        if let Some(v) = patch.schedule { task.schedule = Some(v); }
        if let Some(v) = patch.catch_up_on_launch { task.catch_up_on_launch = v; }
        task.updated_at = now_ms();
        self.insert(&task)?;     // INSERT OR REPLACE — upsert semantics
        Ok(task)
    }

    pub fn delete(&self, id: &str) -> TaskResult<()> {
        let conn = self.conn.lock().expect("poisoned");
        let affected = conn.execute("DELETE FROM tasks WHERE id = ?", [id])?;
        if affected == 0 {
            return Err(TaskError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn search(&self, query: &str) -> TaskResult<Vec<Task>> {
        if query.trim().len() < 3 {
            return self.list(&TaskListFilters {
                query: Some(query.into()),
                ..Default::default()
            });
        }
        let conn = self.conn.lock().expect("poisoned");
        let safe = query.replace('"', "\"\"");
        let match_expr = format!("\"{safe}\"*");
        let mut stmt = conn.prepare(
            "SELECT t.id FROM tasks_fts
             JOIN tasks t ON t.rowid = tasks_fts.rowid
             WHERE tasks_fts MATCH ?
             ORDER BY rank"
        )?;
        let ids: Vec<String> = stmt
            .query_map([match_expr], |row| row.get::<_, String>(0))?
            .collect::<Result<_, _>>()?;
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(t) = load_task_row(&conn, &id)? { out.push(t); }
        }
        Ok(out)
    }

    /// Clear the schedule field for a task (sets `schedule_json` to NULL).
    pub fn clear_schedule(&self, id: &str) -> TaskResult<Task> {
        let mut task = self.get(id)?;
        task.schedule = None;
        task.updated_at = now_ms();
        self.insert(&task)?;
        Ok(task)
    }

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

    /// Insert a new Running `task_run`, return its id.
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

    /// Record the worktree id for a run.
    pub fn record_worktree_for_run(&self, run_id: &str, worktree_id: &str) -> TaskResult<()> {
        let conn = self.conn.lock().expect("poisoned");
        conn.execute(
            "UPDATE task_runs SET worktree_id = ? WHERE id = ?",
            params![worktree_id, run_id],
        )?;
        Ok(())
    }

    // ---- internals ------------------------------------------------------

    fn insert(&self, task: &Task) -> TaskResult<()> {
        let conn = self.conn.lock().expect("poisoned");
        conn.execute(
            r"
            INSERT OR REPLACE INTO tasks
                (id, title, description, status, executor, priority,
                 created_at, updated_at, agent_config_json, schedule_json,
                 context_anchors_json, last_error, catch_up_on_launch, origin_json)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
            ",
            params![
                task.id,
                task.title,
                task.description,
                status_str(task.status),
                executor_str(task.executor),
                priority_str(task.priority),
                task.created_at,
                task.updated_at,
                task.agent_config.as_ref().map(serde_json::to_string).transpose()?,
                task.schedule.as_ref().map(serde_json::to_string).transpose()?,
                serde_json::to_string(&task.context_anchors)?,
                task.last_error,
                i64::from(task.catch_up_on_launch),
                serde_json::to_string(&task.origin)?,
            ],
        )?;
        Ok(())
    }
}

// ---- helpers -------------------------------------------------------------

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(0))
        .unwrap_or(0)
}

fn status_str(s: TaskStatus) -> &'static str {
    match s {
        TaskStatus::Suggested    => "suggested",
        TaskStatus::Queued       => "queued",
        TaskStatus::Running      => "running",
        TaskStatus::NeedsReview  => "needs_review",
        TaskStatus::Done         => "done",
        TaskStatus::Failed       => "failed",
        TaskStatus::Archived     => "archived",
    }
}
fn status_from(s: &str) -> TaskResult<TaskStatus> {
    Ok(match s {
        "suggested"    => TaskStatus::Suggested,
        "queued"       => TaskStatus::Queued,
        "running"      => TaskStatus::Running,
        "needs_review" => TaskStatus::NeedsReview,
        "done"         => TaskStatus::Done,
        "failed"       => TaskStatus::Failed,
        "archived"     => TaskStatus::Archived,
        other          => return Err(TaskError::Invalid(format!("status={other}"))),
    })
}

fn executor_str(e: Executor) -> &'static str {
    match e {
        Executor::Manual => "manual",
        Executor::Agent  => "agent",
    }
}
fn executor_from(s: &str) -> TaskResult<Executor> {
    Ok(match s {
        "manual" => Executor::Manual,
        "agent"  => Executor::Agent,
        other    => return Err(TaskError::Invalid(format!("executor={other}"))),
    })
}

fn priority_str(p: TaskPriority) -> &'static str {
    match p {
        TaskPriority::Low    => "low",
        TaskPriority::Medium => "medium",
        TaskPriority::High   => "high",
        TaskPriority::Urgent => "urgent",
    }
}
fn priority_from(s: &str) -> TaskResult<TaskPriority> {
    Ok(match s {
        "low"    => TaskPriority::Low,
        "medium" => TaskPriority::Medium,
        "high"   => TaskPriority::High,
        "urgent" => TaskPriority::Urgent,
        other    => return Err(TaskError::Invalid(format!("priority={other}"))),
    })
}

fn load_task_row(conn: &Connection, id: &str) -> TaskResult<Option<Task>> {
    #[allow(clippy::type_complexity)]
    let row: Option<(
        String, String, String, String, String, String,
        i64, i64, Option<String>, Option<String>,
        String, Option<String>, i64, String,
    )> = conn.query_row(
        "SELECT id, title, description, status, executor, priority,
                created_at, updated_at, agent_config_json, schedule_json,
                context_anchors_json, last_error, catch_up_on_launch, origin_json
         FROM tasks WHERE id = ?",
        [id],
        |r| Ok((
            r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?,
            r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?,
            r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?,
        ))
    ).optional()?;

    let Some(r) = row else { return Ok(None); };

    let runs = conn
        .prepare(
            "SELECT id, started_at, ended_at, outcome, session_id, worktree_id, summary
             FROM task_runs WHERE task_id = ? ORDER BY started_at DESC",
        )?
        .query_map([id], |r| Ok(TaskRun {
            id:          r.get(0)?,
            started_at:  r.get(1)?,
            ended_at:    r.get(2)?,
            outcome:     run_outcome_from(&r.get::<_, String>(3)?).map_err(|_| rusqlite::Error::InvalidQuery)?,
            session_id:  r.get(4)?,
            worktree_id: r.get(5)?,
            summary:     r.get(6)?,
        }))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Some(Task {
        id: r.0, title: r.1, description: r.2,
        status: status_from(&r.3)?,
        executor: executor_from(&r.4)?,
        priority: priority_from(&r.5)?,
        created_at: r.6, updated_at: r.7,
        agent_config: r.8.as_deref().map(serde_json::from_str).transpose()?,
        schedule:     r.9.as_deref().map(serde_json::from_str).transpose()?,
        context_anchors: serde_json::from_str(&r.10)?,
        runs,
        last_error: r.11,
        catch_up_on_launch: r.12 != 0,
        origin: serde_json::from_str(&r.13)?,
    }))
}

fn run_outcome_from(s: &str) -> TaskResult<RunOutcome> {
    Ok(match s {
        "running"   => RunOutcome::Running,
        "succeeded" => RunOutcome::Succeeded,
        "failed"    => RunOutcome::Failed,
        "cancelled" => RunOutcome::Cancelled,
        other       => return Err(TaskError::Invalid(format!("outcome={other}"))),
    })
}

fn run_outcome_str(o: RunOutcome) -> &'static str {
    match o {
        RunOutcome::Running   => "running",
        RunOutcome::Succeeded => "succeeded",
        RunOutcome::Failed    => "failed",
        RunOutcome::Cancelled => "cancelled",
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(title: &str) -> TaskDraft {
        TaskDraft {
            title: title.into(),
            description: String::new(),
            executor: Executor::Manual,
            priority: TaskPriority::Medium,
        }
    }

    #[test]
    fn create_and_get_roundtrip() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("read paper")).unwrap();
        let got = store.get(&t.id).unwrap();
        assert_eq!(got.title, "read paper");
        assert_eq!(got.status, TaskStatus::Queued);
        assert_eq!(got.executor, Executor::Manual);
    }

    #[test]
    fn get_missing_returns_not_found() {
        let store = TaskStore::open_in_memory().unwrap();
        assert!(matches!(store.get("nope"), Err(TaskError::NotFound(_))));
    }

    #[test]
    fn list_returns_newest_first() {
        let store = TaskStore::open_in_memory().unwrap();
        let a = store.create(draft("a")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let b = store.create(draft("b")).unwrap();
        let list = store.list(&TaskListFilters::default()).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, b.id, "newest first");
        assert_eq!(list[1].id, a.id);
    }

    #[test]
    fn list_filters_by_status() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("x")).unwrap();
        store.update(&t.id, TaskPatch { status: Some(TaskStatus::Done), ..Default::default() }).unwrap();
        let only_done = store.list(&TaskListFilters {
            status: Some(vec![TaskStatus::Done]),
            ..Default::default()
        }).unwrap();
        assert_eq!(only_done.len(), 1);
        let only_queued = store.list(&TaskListFilters {
            status: Some(vec![TaskStatus::Queued]),
            ..Default::default()
        }).unwrap();
        assert!(only_queued.is_empty());
    }

    #[test]
    fn list_filters_by_query_substring() {
        let store = TaskStore::open_in_memory().unwrap();
        store.create(draft("ship billing dashboard")).unwrap();
        store.create(draft("refactor auth")).unwrap();
        let hits = store.list(&TaskListFilters {
            query: Some("billing".into()),
            ..Default::default()
        }).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "ship billing dashboard");
    }

    #[test]
    fn update_changes_fields_and_bumps_updated_at() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("todo")).unwrap();
        let original_updated = t.updated_at;
        std::thread::sleep(std::time::Duration::from_millis(2));
        let upd = store.update(&t.id, TaskPatch {
            title: Some("todo v2".into()),
            status: Some(TaskStatus::Done),
            ..Default::default()
        }).unwrap();
        assert_eq!(upd.title, "todo v2");
        assert_eq!(upd.status, TaskStatus::Done);
        assert!(upd.updated_at > original_updated);
    }

    #[test]
    fn delete_removes_and_cascades_runs() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("nuke")).unwrap();
        // Simulate a run row via direct insert (no public TaskRun insert yet)
        {
            let conn = store.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO task_runs(id,task_id,started_at,outcome) VALUES(?,?,?,?)",
                params!["r1", t.id, 1i64, "succeeded"],
            ).unwrap();
        }
        store.delete(&t.id).unwrap();
        assert!(matches!(store.get(&t.id), Err(TaskError::NotFound(_))));
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM task_runs WHERE task_id = ?", [&t.id], |r| r.get(0)
        ).unwrap();
        assert_eq!(count, 0, "task_runs cascade delete");
    }

    #[test]
    fn delete_missing_errors() {
        let store = TaskStore::open_in_memory().unwrap();
        assert!(matches!(store.delete("missing"), Err(TaskError::NotFound(_))));
    }

    #[test]
    fn fts_search_matches_title_tokens() {
        let store = TaskStore::open_in_memory().unwrap();
        store.create(draft("refactor the authentication module")).unwrap();
        store.create(draft("update deployment docs")).unwrap();
        let hits = store.search("auth").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "refactor the authentication module");
    }

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

    #[test]
    fn update_sets_agent_config() {
        use solo_protocol::{AgentConfig, ExecutionLocation, AgentPermissionMode};
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(TaskDraft {
            title: "run".into(), description: String::new(),
            executor: Executor::Agent, priority: TaskPriority::Medium,
        }).unwrap();
        assert!(t.agent_config.is_none());

        let cfg = AgentConfig {
            permission_mode: AgentPermissionMode::Bypass,
            execution_location: ExecutionLocation::Worktree,
            ..Default::default()
        };
        let updated = store.update(&t.id, TaskPatch {
            agent_config: Some(cfg.clone()),
            ..Default::default()
        }).unwrap();
        assert_eq!(updated.agent_config.unwrap().permission_mode, AgentPermissionMode::Bypass);
    }

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
}
