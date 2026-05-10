//! SQLite-backed task store (FTS5 in Task 5).

use rusqlite::{params, Connection, OptionalExtension};
use solo_protocol::{
    Cycle, CycleDraft, CyclePatch, Executor, Label, LabelDraft, LabelPatch, Project, ProjectDraft,
    ProjectHealth, ProjectPatch, ProjectStatus, RunOutcome, Subtask, Task, TaskDraft,
    TaskListFilters, TaskOrigin, TaskPatch, TaskPriority, TaskRun, TaskStatus,
};
use std::path::Path;
use std::sync::Mutex;
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
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        Ok(store)
    }

    /// Open in memory (tests).
    #[cfg(test)]
    pub fn open_in_memory() -> TaskResult<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self {
            conn: Mutex::new(conn),
        };
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

        // Versioned migrations (gated by PRAGMA user_version).
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

        if version < 1 {
            // v1: add subtasks_json column. ADD COLUMN with DEFAULT is O(1) in SQLite.
            // Pre-existing rows read back with an empty list via the DEFAULT.
            let has_column: bool = conn
                .prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'subtasks_json'")?
                .query_map([], |_| Ok(()))?
                .next()
                .is_some();
            if !has_column {
                conn.execute_batch(
                    "ALTER TABLE tasks ADD COLUMN subtasks_json TEXT NOT NULL DEFAULT '[]';",
                )?;
            }
            conn.execute_batch("PRAGMA user_version = 1;")?;
        }

        if version < 2 {
            // v2: Labels, Projects, Cycles. Tasks get label_ids, project_id, cycle_id.
            let add_column = |name: &str, ddl: &str| -> TaskResult<()> {
                let has: bool = conn
                    .prepare(&format!(
                        "SELECT 1 FROM pragma_table_info('tasks') WHERE name = '{name}'"
                    ))?
                    .query_map([], |_| Ok(()))?
                    .next()
                    .is_some();
                if !has {
                    conn.execute_batch(ddl)?;
                }
                Ok(())
            };
            add_column(
                "label_ids_json",
                "ALTER TABLE tasks ADD COLUMN label_ids_json TEXT NOT NULL DEFAULT '[]';",
            )?;
            add_column(
                "project_id",
                "ALTER TABLE tasks ADD COLUMN project_id TEXT;",
            )?;
            add_column("cycle_id", "ALTER TABLE tasks ADD COLUMN cycle_id TEXT;")?;

            conn.execute_batch(
                r"
                CREATE TABLE IF NOT EXISTS labels (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    color TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    health TEXT NOT NULL,
                    color TEXT NOT NULL,
                    start_at INTEGER,
                    target_at INTEGER,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cycles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    start_at INTEGER NOT NULL,
                    end_at INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
                CREATE INDEX IF NOT EXISTS idx_tasks_cycle   ON tasks(cycle_id);
                ",
            )?;
            conn.execute_batch("PRAGMA user_version = 2;")?;
        }

        Ok(())
    }

    // ---- CRUD -----------------------------------------------------------

    pub fn create(&self, draft: TaskDraft) -> TaskResult<Task> {
        let now = now_ms();
        let id = Uuid::new_v4().to_string();
        let subtasks = draft
            .subtasks
            .into_iter()
            .map(|d| Subtask {
                id: Uuid::new_v4().to_string(),
                title: d.title,
                completed: false,
                created_at: now,
                completed_at: None,
            })
            .collect();
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
            subtasks,
            label_ids: draft.label_ids,
            project_id: draft.project_id,
            cycle_id: draft.cycle_id,
        };
        self.insert(&task)?;
        Ok(task)
    }

    pub fn get(&self, id: &str) -> TaskResult<Task> {
        let conn = self.conn.lock().expect("poisoned");
        let task = load_task_row(&conn, id)?.ok_or_else(|| TaskError::NotFound(id.to_string()))?;
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
            .query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
                row.get::<_, String>(0)
            })?
            .collect::<Result<_, _>>()?;

        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(t) = load_task_row(&conn, &id)? {
                // Optional FTS query match
                if let Some(q) = &filter.query {
                    let needle = q.to_lowercase();
                    if !t.title.to_lowercase().contains(&needle)
                        && !t.description.to_lowercase().contains(&needle)
                    {
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
        if let Some(v) = patch.title {
            task.title = v;
        }
        if let Some(v) = patch.description {
            task.description = v;
        }
        if let Some(v) = patch.status {
            task.status = v;
        }
        if let Some(v) = patch.priority {
            task.priority = v;
        }
        if let Some(v) = patch.agent_config {
            task.agent_config = Some(v);
        }
        if let Some(v) = patch.schedule {
            task.schedule = Some(v);
        }
        if let Some(v) = patch.catch_up_on_launch {
            task.catch_up_on_launch = v;
        }
        if let Some(v) = patch.subtasks {
            task.subtasks = v;
        }
        if let Some(v) = patch.label_ids {
            task.label_ids = v;
        }
        if patch.clear_project == Some(true) {
            task.project_id = None;
        } else if let Some(v) = patch.project_id {
            task.project_id = Some(v);
        }
        if patch.clear_cycle == Some(true) {
            task.cycle_id = None;
        } else if let Some(v) = patch.cycle_id {
            task.cycle_id = Some(v);
        }
        task.updated_at = now_ms();
        self.insert(&task)?; // INSERT OR REPLACE — upsert semantics
        Ok(task)
    }

    // ---- Subtasks -------------------------------------------------------

    pub fn subtask_add(&self, task_id: &str, title: String) -> TaskResult<Task> {
        let mut task = self.get(task_id)?;
        let now = now_ms();
        task.subtasks.push(Subtask {
            id: Uuid::new_v4().to_string(),
            title,
            completed: false,
            created_at: now,
            completed_at: None,
        });
        task.updated_at = now;
        self.insert(&task)?;
        Ok(task)
    }

    pub fn subtask_toggle(
        &self,
        task_id: &str,
        subtask_id: &str,
        completed: bool,
    ) -> TaskResult<Task> {
        let mut task = self.get(task_id)?;
        let now = now_ms();
        let sub = task
            .subtasks
            .iter_mut()
            .find(|s| s.id == subtask_id)
            .ok_or_else(|| TaskError::NotFound(format!("subtask {subtask_id}")))?;
        sub.completed = completed;
        sub.completed_at = if completed { Some(now) } else { None };
        task.updated_at = now;
        self.insert(&task)?;
        Ok(task)
    }

    pub fn subtask_rename(
        &self,
        task_id: &str,
        subtask_id: &str,
        title: String,
    ) -> TaskResult<Task> {
        let mut task = self.get(task_id)?;
        let sub = task
            .subtasks
            .iter_mut()
            .find(|s| s.id == subtask_id)
            .ok_or_else(|| TaskError::NotFound(format!("subtask {subtask_id}")))?;
        sub.title = title;
        task.updated_at = now_ms();
        self.insert(&task)?;
        Ok(task)
    }

    pub fn subtask_remove(&self, task_id: &str, subtask_id: &str) -> TaskResult<Task> {
        let mut task = self.get(task_id)?;
        let before = task.subtasks.len();
        task.subtasks.retain(|s| s.id != subtask_id);
        if task.subtasks.len() == before {
            return Err(TaskError::NotFound(format!("subtask {subtask_id}")));
        }
        task.updated_at = now_ms();
        self.insert(&task)?;
        Ok(task)
    }

    /// Reorder subtasks to match `ordered_ids` exactly. Must be a permutation
    /// of the current subtask ids (same length, same set).
    pub fn subtask_reorder(&self, task_id: &str, ordered_ids: &[String]) -> TaskResult<Task> {
        let mut task = self.get(task_id)?;
        if ordered_ids.len() != task.subtasks.len() {
            return Err(TaskError::Invalid(format!(
                "subtask reorder length mismatch: got {}, expected {}",
                ordered_ids.len(),
                task.subtasks.len()
            )));
        }
        let mut by_id: std::collections::HashMap<String, Subtask> =
            task.subtasks.drain(..).map(|s| (s.id.clone(), s)).collect();
        let mut next = Vec::with_capacity(ordered_ids.len());
        for id in ordered_ids {
            let s = by_id
                .remove(id)
                .ok_or_else(|| TaskError::Invalid(format!("subtask reorder unknown id: {id}")))?;
            next.push(s);
        }
        if !by_id.is_empty() {
            return Err(TaskError::Invalid(
                "subtask reorder missing ids in permutation".into(),
            ));
        }
        task.subtasks = next;
        task.updated_at = now_ms();
        self.insert(&task)?;
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
             ORDER BY rank",
        )?;
        let ids: Vec<String> = stmt
            .query_map([match_expr], |row| row.get::<_, String>(0))?
            .collect::<Result<_, _>>()?;
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(t) = load_task_row(&conn, &id)? {
                out.push(t);
            }
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
        let ids: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<_, _>>()?;
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(t) = load_task_row(&conn, &id)? {
                out.push(t);
            }
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
        let tid: Option<String> = conn
            .query_row(
                "SELECT task_id FROM task_runs WHERE id = ?",
                [run_id],
                |r| r.get(0),
            )
            .optional()?;
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

    // ---- Labels ---------------------------------------------------------

    pub fn label_list(&self) -> TaskResult<Vec<Label>> {
        let conn = self.conn.lock().expect("poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, color, created_at FROM labels ORDER BY name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Label {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                created_at: r.get(3)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn label_create(&self, draft: LabelDraft) -> TaskResult<Label> {
        let conn = self.conn.lock().expect("poisoned");
        let label = Label {
            id: Uuid::new_v4().to_string(),
            name: draft.name,
            color: draft.color,
            created_at: now_ms(),
        };
        conn.execute(
            "INSERT INTO labels(id, name, color, created_at) VALUES(?1, ?2, ?3, ?4)",
            params![label.id, label.name, label.color, label.created_at],
        )?;
        Ok(label)
    }

    pub fn label_update(&self, id: &str, patch: LabelPatch) -> TaskResult<Label> {
        let conn = self.conn.lock().expect("poisoned");
        let existing: Option<(String, String, String, i64)> = conn
            .query_row(
                "SELECT id, name, color, created_at FROM labels WHERE id = ?",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        let Some((lid, mut name, mut color, created_at)) = existing else {
            return Err(TaskError::NotFound(id.into()));
        };
        if let Some(v) = patch.name {
            name = v;
        }
        if let Some(v) = patch.color {
            color = v;
        }
        conn.execute(
            "UPDATE labels SET name = ?2, color = ?3 WHERE id = ?1",
            params![lid, name, color],
        )?;
        Ok(Label {
            id: lid,
            name,
            color,
            created_at,
        })
    }

    /// Delete a label and prune its id from every task's `label_ids_json`.
    pub fn label_delete(&self, id: &str) -> TaskResult<Vec<String>> {
        let conn = self.conn.lock().expect("poisoned");
        let affected = conn.execute("DELETE FROM labels WHERE id = ?", [id])?;
        if affected == 0 {
            return Err(TaskError::NotFound(id.into()));
        }
        // Prune from all tasks that carry it.
        let mut stmt =
            conn.prepare("SELECT id, label_ids_json FROM tasks WHERE label_ids_json LIKE ?")?;
        let affected_ids: Vec<(String, String)> = stmt
            .query_map([format!("%\"{id}\"%")], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        drop(stmt);
        let mut changed_task_ids = Vec::new();
        for (task_id, json) in affected_ids {
            let mut ids: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
            let before = ids.len();
            ids.retain(|x| x != id);
            if ids.len() != before {
                conn.execute(
                    "UPDATE tasks SET label_ids_json = ?1, updated_at = ?2 WHERE id = ?3",
                    params![serde_json::to_string(&ids)?, now_ms(), task_id],
                )?;
                changed_task_ids.push(task_id);
            }
        }
        Ok(changed_task_ids)
    }

    pub fn task_label_add(&self, task_id: &str, label_id: &str) -> TaskResult<Task> {
        let mut task = self.get(task_id)?;
        if !task.label_ids.iter().any(|x| x == label_id) {
            task.label_ids.push(label_id.to_string());
            task.updated_at = now_ms();
            self.insert(&task)?;
        }
        Ok(task)
    }

    pub fn task_label_remove(&self, task_id: &str, label_id: &str) -> TaskResult<Task> {
        let mut task = self.get(task_id)?;
        let before = task.label_ids.len();
        task.label_ids.retain(|x| x != label_id);
        if task.label_ids.len() != before {
            task.updated_at = now_ms();
            self.insert(&task)?;
        }
        Ok(task)
    }

    // ---- Projects -------------------------------------------------------

    pub fn project_list(&self) -> TaskResult<Vec<Project>> {
        let conn = self.conn.lock().expect("poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, description, status, health, color, start_at, target_at,
                    created_at, updated_at FROM projects ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                status: project_status_from(&r.get::<_, String>(3)?)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                health: project_health_from(&r.get::<_, String>(4)?)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                color: r.get(5)?,
                start_at: r.get(6)?,
                target_at: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn project_create(&self, draft: ProjectDraft) -> TaskResult<Project> {
        let now = now_ms();
        let project = Project {
            id: Uuid::new_v4().to_string(),
            name: draft.name,
            description: draft.description,
            status: ProjectStatus::Planned,
            health: ProjectHealth::Unknown,
            color: draft.color,
            start_at: None,
            target_at: None,
            created_at: now,
            updated_at: now,
        };
        self.project_insert(&project)?;
        Ok(project)
    }

    pub fn project_update(&self, id: &str, patch: ProjectPatch) -> TaskResult<Project> {
        let mut p = self.project_get(id)?;
        if let Some(v) = patch.name {
            p.name = v;
        }
        if let Some(v) = patch.description {
            p.description = v;
        }
        if let Some(v) = patch.status {
            p.status = v;
        }
        if let Some(v) = patch.health {
            p.health = v;
        }
        if let Some(v) = patch.color {
            p.color = v;
        }
        if let Some(v) = patch.start_at {
            p.start_at = Some(v);
        }
        if let Some(v) = patch.target_at {
            p.target_at = Some(v);
        }
        p.updated_at = now_ms();
        self.project_insert(&p)?;
        Ok(p)
    }

    pub fn project_get(&self, id: &str) -> TaskResult<Project> {
        let conn = self.conn.lock().expect("poisoned");
        let row: Option<(
            String,
            String,
            String,
            String,
            String,
            String,
            Option<i64>,
            Option<i64>,
            i64,
            i64,
        )> = conn
            .query_row(
                "SELECT id, name, description, status, health, color, start_at, target_at,
                    created_at, updated_at FROM projects WHERE id = ?",
                [id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                    ))
                },
            )
            .optional()?;
        let Some(r) = row else {
            return Err(TaskError::NotFound(id.into()));
        };
        Ok(Project {
            id: r.0,
            name: r.1,
            description: r.2,
            status: project_status_from(&r.3)?,
            health: project_health_from(&r.4)?,
            color: r.5,
            start_at: r.6,
            target_at: r.7,
            created_at: r.8,
            updated_at: r.9,
        })
    }

    /// Delete a project and null out `project_id` on every task that pointed to it.
    pub fn project_delete(&self, id: &str) -> TaskResult<Vec<String>> {
        let conn = self.conn.lock().expect("poisoned");
        let affected = conn.execute("DELETE FROM projects WHERE id = ?", [id])?;
        if affected == 0 {
            return Err(TaskError::NotFound(id.into()));
        }
        let mut stmt = conn.prepare("SELECT id FROM tasks WHERE project_id = ?")?;
        let ids: Vec<String> = stmt
            .query_map([id], |r| r.get::<_, String>(0))?
            .collect::<Result<_, _>>()?;
        drop(stmt);
        conn.execute(
            "UPDATE tasks SET project_id = NULL, updated_at = ? WHERE project_id = ?",
            params![now_ms(), id],
        )?;
        Ok(ids)
    }

    fn project_insert(&self, p: &Project) -> TaskResult<()> {
        let conn = self.conn.lock().expect("poisoned");
        conn.execute(
            "INSERT OR REPLACE INTO projects(id, name, description, status, health,
                color, start_at, target_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                p.id,
                p.name,
                p.description,
                project_status_str(&p.status),
                project_health_str(&p.health),
                p.color,
                p.start_at,
                p.target_at,
                p.created_at,
                p.updated_at,
            ],
        )?;
        Ok(())
    }

    // ---- Cycles ---------------------------------------------------------

    pub fn cycle_list(&self) -> TaskResult<Vec<Cycle>> {
        let conn = self.conn.lock().expect("poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, start_at, end_at, created_at FROM cycles ORDER BY start_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Cycle {
                id: r.get(0)?,
                name: r.get(1)?,
                start_at: r.get(2)?,
                end_at: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn cycle_create(&self, draft: CycleDraft) -> TaskResult<Cycle> {
        let conn = self.conn.lock().expect("poisoned");
        let cycle = Cycle {
            id: Uuid::new_v4().to_string(),
            name: draft.name,
            start_at: draft.start_at,
            end_at: draft.end_at,
            created_at: now_ms(),
        };
        conn.execute(
            "INSERT INTO cycles(id, name, start_at, end_at, created_at) VALUES(?1, ?2, ?3, ?4, ?5)",
            params![
                cycle.id,
                cycle.name,
                cycle.start_at,
                cycle.end_at,
                cycle.created_at
            ],
        )?;
        Ok(cycle)
    }

    pub fn cycle_update(&self, id: &str, patch: CyclePatch) -> TaskResult<Cycle> {
        let conn = self.conn.lock().expect("poisoned");
        let row: Option<(String, String, i64, i64, i64)> = conn
            .query_row(
                "SELECT id, name, start_at, end_at, created_at FROM cycles WHERE id = ?",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;
        let Some((cid, mut name, mut start_at, mut end_at, created_at)) = row else {
            return Err(TaskError::NotFound(id.into()));
        };
        if let Some(v) = patch.name {
            name = v;
        }
        if let Some(v) = patch.start_at {
            start_at = v;
        }
        if let Some(v) = patch.end_at {
            end_at = v;
        }
        conn.execute(
            "UPDATE cycles SET name = ?2, start_at = ?3, end_at = ?4 WHERE id = ?1",
            params![cid, name, start_at, end_at],
        )?;
        Ok(Cycle {
            id: cid,
            name,
            start_at,
            end_at,
            created_at,
        })
    }

    /// Delete a cycle and null out `cycle_id` on every task that pointed to it.
    pub fn cycle_delete(&self, id: &str) -> TaskResult<Vec<String>> {
        let conn = self.conn.lock().expect("poisoned");
        let affected = conn.execute("DELETE FROM cycles WHERE id = ?", [id])?;
        if affected == 0 {
            return Err(TaskError::NotFound(id.into()));
        }
        let mut stmt = conn.prepare("SELECT id FROM tasks WHERE cycle_id = ?")?;
        let ids: Vec<String> = stmt
            .query_map([id], |r| r.get::<_, String>(0))?
            .collect::<Result<_, _>>()?;
        drop(stmt);
        conn.execute(
            "UPDATE tasks SET cycle_id = NULL, updated_at = ? WHERE cycle_id = ?",
            params![now_ms(), id],
        )?;
        Ok(ids)
    }

    // ---- internals ------------------------------------------------------

    fn insert(&self, task: &Task) -> TaskResult<()> {
        let conn = self.conn.lock().expect("poisoned");
        conn.execute(
            r"
            INSERT OR REPLACE INTO tasks
                (id, title, description, status, executor, priority,
                 created_at, updated_at, agent_config_json, schedule_json,
                 context_anchors_json, last_error, catch_up_on_launch, origin_json,
                 subtasks_json, label_ids_json, project_id, cycle_id)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
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
                task.agent_config
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
                task.schedule
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
                serde_json::to_string(&task.context_anchors)?,
                task.last_error,
                i64::from(task.catch_up_on_launch),
                serde_json::to_string(&task.origin)?,
                serde_json::to_string(&task.subtasks)?,
                serde_json::to_string(&task.label_ids)?,
                task.project_id,
                task.cycle_id,
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
        TaskStatus::Suggested => "suggested",
        TaskStatus::Queued => "queued",
        TaskStatus::Running => "running",
        TaskStatus::NeedsReview => "needs_review",
        TaskStatus::Done => "done",
        TaskStatus::Failed => "failed",
        TaskStatus::Archived => "archived",
    }
}
fn status_from(s: &str) -> TaskResult<TaskStatus> {
    Ok(match s {
        "suggested" => TaskStatus::Suggested,
        "queued" => TaskStatus::Queued,
        "running" => TaskStatus::Running,
        "needs_review" => TaskStatus::NeedsReview,
        "done" => TaskStatus::Done,
        "failed" => TaskStatus::Failed,
        "archived" => TaskStatus::Archived,
        other => return Err(TaskError::Invalid(format!("status={other}"))),
    })
}

fn executor_str(e: Executor) -> &'static str {
    match e {
        Executor::Manual => "manual",
        Executor::Agent => "agent",
    }
}
fn executor_from(s: &str) -> TaskResult<Executor> {
    Ok(match s {
        "manual" => Executor::Manual,
        "agent" => Executor::Agent,
        other => return Err(TaskError::Invalid(format!("executor={other}"))),
    })
}

fn priority_str(p: TaskPriority) -> &'static str {
    match p {
        TaskPriority::Low => "low",
        TaskPriority::Medium => "medium",
        TaskPriority::High => "high",
        TaskPriority::Urgent => "urgent",
    }
}
fn priority_from(s: &str) -> TaskResult<TaskPriority> {
    Ok(match s {
        "low" => TaskPriority::Low,
        "medium" => TaskPriority::Medium,
        "high" => TaskPriority::High,
        "urgent" => TaskPriority::Urgent,
        other => return Err(TaskError::Invalid(format!("priority={other}"))),
    })
}

fn load_task_row(conn: &Connection, id: &str) -> TaskResult<Option<Task>> {
    #[allow(clippy::type_complexity)]
    let row: Option<(
        String,
        String,
        String,
        String,
        String,
        String,
        i64,
        i64,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        i64,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
    )> = conn
        .query_row(
            "SELECT id, title, description, status, executor, priority,
                created_at, updated_at, agent_config_json, schedule_json,
                context_anchors_json, last_error, catch_up_on_launch, origin_json,
                subtasks_json, label_ids_json, project_id, cycle_id
         FROM tasks WHERE id = ?",
            [id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                    r.get(12)?,
                    r.get(13)?,
                    r.get(14)?,
                    r.get(15)?,
                    r.get(16)?,
                    r.get(17)?,
                ))
            },
        )
        .optional()?;

    let Some(r) = row else {
        return Ok(None);
    };

    let runs = conn
        .prepare(
            "SELECT id, started_at, ended_at, outcome, session_id, worktree_id, summary
             FROM task_runs WHERE task_id = ? ORDER BY started_at DESC",
        )?
        .query_map([id], |r| {
            Ok(TaskRun {
                id: r.get(0)?,
                started_at: r.get(1)?,
                ended_at: r.get(2)?,
                outcome: run_outcome_from(&r.get::<_, String>(3)?)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                session_id: r.get(4)?,
                worktree_id: r.get(5)?,
                summary: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Some(Task {
        id: r.0,
        title: r.1,
        description: r.2,
        status: status_from(&r.3)?,
        executor: executor_from(&r.4)?,
        priority: priority_from(&r.5)?,
        created_at: r.6,
        updated_at: r.7,
        agent_config: r.8.as_deref().map(serde_json::from_str).transpose()?,
        schedule: r.9.as_deref().map(serde_json::from_str).transpose()?,
        context_anchors: serde_json::from_str(&r.10)?,
        runs,
        last_error: r.11,
        catch_up_on_launch: r.12 != 0,
        origin: serde_json::from_str(&r.13)?,
        subtasks: serde_json::from_str(&r.14)?,
        label_ids: serde_json::from_str(&r.15)?,
        project_id: r.16,
        cycle_id: r.17,
    }))
}

fn project_status_str(s: &ProjectStatus) -> &'static str {
    match s {
        ProjectStatus::Planned => "planned",
        ProjectStatus::InProgress => "in_progress",
        ProjectStatus::Paused => "paused",
        ProjectStatus::Completed => "completed",
        ProjectStatus::Cancelled => "cancelled",
    }
}
fn project_status_from(s: &str) -> TaskResult<ProjectStatus> {
    Ok(match s {
        "planned" => ProjectStatus::Planned,
        "in_progress" => ProjectStatus::InProgress,
        "paused" => ProjectStatus::Paused,
        "completed" => ProjectStatus::Completed,
        "cancelled" => ProjectStatus::Cancelled,
        other => return Err(TaskError::Invalid(format!("project status={other}"))),
    })
}

fn project_health_str(h: &ProjectHealth) -> &'static str {
    match h {
        ProjectHealth::OnTrack => "on_track",
        ProjectHealth::AtRisk => "at_risk",
        ProjectHealth::OffTrack => "off_track",
        ProjectHealth::Unknown => "unknown",
    }
}
fn project_health_from(s: &str) -> TaskResult<ProjectHealth> {
    Ok(match s {
        "on_track" => ProjectHealth::OnTrack,
        "at_risk" => ProjectHealth::AtRisk,
        "off_track" => ProjectHealth::OffTrack,
        "unknown" => ProjectHealth::Unknown,
        other => return Err(TaskError::Invalid(format!("project health={other}"))),
    })
}

fn run_outcome_from(s: &str) -> TaskResult<RunOutcome> {
    Ok(match s {
        "running" => RunOutcome::Running,
        "succeeded" => RunOutcome::Succeeded,
        "failed" => RunOutcome::Failed,
        "cancelled" => RunOutcome::Cancelled,
        other => return Err(TaskError::Invalid(format!("outcome={other}"))),
    })
}

fn run_outcome_str(o: RunOutcome) -> &'static str {
    match o {
        RunOutcome::Running => "running",
        RunOutcome::Succeeded => "succeeded",
        RunOutcome::Failed => "failed",
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
            subtasks: Vec::new(),
            label_ids: Vec::new(),
            project_id: None,
            cycle_id: None,
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
        store
            .update(
                &t.id,
                TaskPatch {
                    status: Some(TaskStatus::Done),
                    ..Default::default()
                },
            )
            .unwrap();
        let only_done = store
            .list(&TaskListFilters {
                status: Some(vec![TaskStatus::Done]),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(only_done.len(), 1);
        let only_queued = store
            .list(&TaskListFilters {
                status: Some(vec![TaskStatus::Queued]),
                ..Default::default()
            })
            .unwrap();
        assert!(only_queued.is_empty());
    }

    #[test]
    fn list_filters_by_query_substring() {
        let store = TaskStore::open_in_memory().unwrap();
        store.create(draft("ship billing dashboard")).unwrap();
        store.create(draft("refactor auth")).unwrap();
        let hits = store
            .list(&TaskListFilters {
                query: Some("billing".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "ship billing dashboard");
    }

    #[test]
    fn update_changes_fields_and_bumps_updated_at() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("todo")).unwrap();
        let original_updated = t.updated_at;
        std::thread::sleep(std::time::Duration::from_millis(2));
        let upd = store
            .update(
                &t.id,
                TaskPatch {
                    title: Some("todo v2".into()),
                    status: Some(TaskStatus::Done),
                    ..Default::default()
                },
            )
            .unwrap();
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
            )
            .unwrap();
        }
        store.delete(&t.id).unwrap();
        assert!(matches!(store.get(&t.id), Err(TaskError::NotFound(_))));
        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_runs WHERE task_id = ?",
                [&t.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "task_runs cascade delete");
    }

    #[test]
    fn delete_missing_errors() {
        let store = TaskStore::open_in_memory().unwrap();
        assert!(matches!(
            store.delete("missing"),
            Err(TaskError::NotFound(_))
        ));
    }

    #[test]
    fn fts_search_matches_title_tokens() {
        let store = TaskStore::open_in_memory().unwrap();
        store
            .create(draft("refactor the authentication module"))
            .unwrap();
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
        store
            .end_run(&run_id, RunOutcome::Succeeded, Some("done ok"))
            .unwrap();
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
        assert_eq!(
            store.task_id_for_run(&run_id).unwrap().as_deref(),
            Some(t.id.as_str())
        );
        assert_eq!(store.task_id_for_run("nope").unwrap(), None);
    }

    #[test]
    fn update_sets_agent_config() {
        use solo_protocol::{AgentConfig, AgentPermissionMode, ExecutionLocation};
        let store = TaskStore::open_in_memory().unwrap();
        let t = store
            .create(TaskDraft {
                title: "run".into(),
                description: String::new(),
                executor: Executor::Agent,
                priority: TaskPriority::Medium,
                subtasks: Vec::new(),
                label_ids: Vec::new(),
                project_id: None,
                cycle_id: None,
            })
            .unwrap();
        assert!(t.agent_config.is_none());

        let cfg = AgentConfig {
            permission_mode: AgentPermissionMode::Bypass,
            execution_location: ExecutionLocation::Worktree,
            ..Default::default()
        };
        let updated = store
            .update(
                &t.id,
                TaskPatch {
                    agent_config: Some(cfg.clone()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            updated.agent_config.unwrap().permission_mode,
            AgentPermissionMode::Bypass
        );
    }

    #[test]
    fn list_scheduled_returns_only_scheduled() {
        use solo_protocol::{PresetKind, Schedule};
        let store = TaskStore::open_in_memory().unwrap();
        let _manual = store.create(draft("no schedule")).unwrap();
        let scheduled = store.create(draft("will run")).unwrap();
        store
            .update(
                &scheduled.id,
                TaskPatch {
                    schedule: Some(Schedule::Preset {
                        kind: PresetKind::Daily,
                        hour: 3,
                        minute: 0,
                        weekday: None,
                        next_fire: 0,
                    }),
                    ..Default::default()
                },
            )
            .unwrap();
        let list = store.list_scheduled().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, scheduled.id);
    }

    // ---- Subtasks ------------------------------------------------------

    #[test]
    fn subtask_add_appends_and_persists() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("parent")).unwrap();
        assert!(t.subtasks.is_empty());

        let after_one = store.subtask_add(&t.id, "first".into()).unwrap();
        assert_eq!(after_one.subtasks.len(), 1);
        assert_eq!(after_one.subtasks[0].title, "first");
        assert!(!after_one.subtasks[0].completed);

        let after_two = store.subtask_add(&t.id, "second".into()).unwrap();
        assert_eq!(after_two.subtasks.len(), 2);
        assert_eq!(after_two.subtasks[1].title, "second");

        let reloaded = store.get(&t.id).unwrap();
        assert_eq!(reloaded.subtasks.len(), 2);
        assert_eq!(reloaded.subtasks[0].title, "first");
        assert_eq!(reloaded.subtasks[1].title, "second");
    }

    #[test]
    fn subtask_toggle_sets_and_clears_completed_at() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("parent")).unwrap();
        let t = store.subtask_add(&t.id, "do it".into()).unwrap();
        let sub_id = t.subtasks[0].id.clone();

        let toggled_on = store.subtask_toggle(&t.id, &sub_id, true).unwrap();
        assert!(toggled_on.subtasks[0].completed);
        assert!(toggled_on.subtasks[0].completed_at.is_some());

        let toggled_off = store.subtask_toggle(&t.id, &sub_id, false).unwrap();
        assert!(!toggled_off.subtasks[0].completed);
        assert!(toggled_off.subtasks[0].completed_at.is_none());
    }

    #[test]
    fn subtask_toggle_missing_id_returns_not_found() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("parent")).unwrap();
        let err = store.subtask_toggle(&t.id, "no-such-id", true).unwrap_err();
        assert!(matches!(err, TaskError::NotFound(_)));
    }

    #[test]
    fn subtask_rename_changes_title() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("parent")).unwrap();
        let t = store.subtask_add(&t.id, "old name".into()).unwrap();
        let sub_id = t.subtasks[0].id.clone();

        let renamed = store
            .subtask_rename(&t.id, &sub_id, "new name".into())
            .unwrap();
        assert_eq!(renamed.subtasks[0].title, "new name");
        assert_eq!(renamed.subtasks[0].id, sub_id);
    }

    #[test]
    fn subtask_remove_preserves_other_order() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("parent")).unwrap();
        let t = store.subtask_add(&t.id, "a".into()).unwrap();
        let t = store.subtask_add(&t.id, "b".into()).unwrap();
        let t = store.subtask_add(&t.id, "c".into()).unwrap();
        let middle_id = t.subtasks[1].id.clone();

        let after = store.subtask_remove(&t.id, &middle_id).unwrap();
        assert_eq!(after.subtasks.len(), 2);
        assert_eq!(after.subtasks[0].title, "a");
        assert_eq!(after.subtasks[1].title, "c");
    }

    #[test]
    fn subtask_remove_missing_is_not_found() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("parent")).unwrap();
        let err = store.subtask_remove(&t.id, "nope").unwrap_err();
        assert!(matches!(err, TaskError::NotFound(_)));
    }

    #[test]
    fn subtask_reorder_valid_permutation() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("parent")).unwrap();
        let t = store.subtask_add(&t.id, "a".into()).unwrap();
        let t = store.subtask_add(&t.id, "b".into()).unwrap();
        let t = store.subtask_add(&t.id, "c".into()).unwrap();
        let ids = [
            t.subtasks[0].id.clone(),
            t.subtasks[1].id.clone(),
            t.subtasks[2].id.clone(),
        ];
        // Reverse order: c, b, a
        let reversed = store
            .subtask_reorder(&t.id, &[ids[2].clone(), ids[1].clone(), ids[0].clone()])
            .unwrap();
        assert_eq!(reversed.subtasks[0].title, "c");
        assert_eq!(reversed.subtasks[1].title, "b");
        assert_eq!(reversed.subtasks[2].title, "a");
    }

    #[test]
    fn subtask_reorder_rejects_non_permutation() {
        let store = TaskStore::open_in_memory().unwrap();
        let t = store.create(draft("parent")).unwrap();
        let t = store.subtask_add(&t.id, "a".into()).unwrap();
        let t = store.subtask_add(&t.id, "b".into()).unwrap();

        // Wrong length
        let err = store
            .subtask_reorder(&t.id, &[t.subtasks[0].id.clone()])
            .unwrap_err();
        assert!(matches!(err, TaskError::Invalid(_)));

        // Unknown id
        let err = store
            .subtask_reorder(&t.id, &["bogus".into(), t.subtasks[0].id.clone()])
            .unwrap_err();
        assert!(matches!(err, TaskError::Invalid(_)));
    }

    #[test]
    fn draft_subtasks_create_with_ids_and_timestamps() {
        let store = TaskStore::open_in_memory().unwrap();
        let d = TaskDraft {
            title: "parent".into(),
            description: String::new(),
            executor: Executor::Manual,
            priority: TaskPriority::Medium,
            subtasks: vec![
                solo_protocol::SubtaskDraft {
                    title: "one".into(),
                },
                solo_protocol::SubtaskDraft {
                    title: "two".into(),
                },
            ],
            label_ids: Vec::new(),
            project_id: None,
            cycle_id: None,
        };
        let t = store.create(d).unwrap();
        assert_eq!(t.subtasks.len(), 2);
        assert!(!t.subtasks[0].id.is_empty());
        assert!(!t.subtasks[1].id.is_empty());
        assert_ne!(t.subtasks[0].id, t.subtasks[1].id);
        assert_eq!(t.subtasks[0].title, "one");
        assert_eq!(t.subtasks[1].title, "two");
    }

    #[test]
    fn subtasks_survive_reload() {
        // Confirm subtasks_json column round-trips through disk.
        let path = std::env::temp_dir().join(format!("solo-subtask-reload-{}.db", Uuid::new_v4()));
        let store = TaskStore::open(&path).unwrap();
        let t = store.create(draft("parent")).unwrap();
        let t = store.subtask_add(&t.id, "persist me".into()).unwrap();
        let sub_id = t.subtasks[0].id.clone();
        drop(store);

        let reopen = TaskStore::open(&path).unwrap();
        let reloaded = reopen.get(&t.id).unwrap();
        assert_eq!(reloaded.subtasks.len(), 1);
        assert_eq!(reloaded.subtasks[0].id, sub_id);
        assert_eq!(reloaded.subtasks[0].title, "persist me");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn migration_is_idempotent() {
        // Opening twice must not error on the ALTER TABLE re-check.
        let path = std::env::temp_dir().join(format!("solo-migrate-{}.db", Uuid::new_v4()));
        {
            let s = TaskStore::open(&path).unwrap();
            let _ = s.create(draft("x")).unwrap();
        }
        {
            let s = TaskStore::open(&path).unwrap();
            let list = s.list(&TaskListFilters::default()).unwrap();
            assert_eq!(list.len(), 1);
        }
        let _ = std::fs::remove_file(&path);
    }
}
