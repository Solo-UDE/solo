# Task Allocator — Phase 6 (Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the 7-grouping surface (add Context-anchor, Agent-fingerprint, Last-run-health), add Kanban + Calendar views with a toggle, complete the 6-source context bundle (Sessions + Notes), wire a command-palette entry for "Plan: …", and add a planner-notes settings field.

**Architecture:** Pure-frontend additions for views + groupings (no new Tauri commands). Two small Rust-side additions: Sessions/Notes providers in `task_planner.rs`. A `planner_notes` string in Solo's existing settings store.

**Tech Stack:** No new deps. Reuses existing settings infrastructure.

**Spec reference:** `docs/superpowers/specs/2026-04-21-task-allocator-design.md` §7 groupings, §8 views, §3 full context bundle.

---

## File map

**Modify (Rust):**
- `apps/desktop/src-tauri/src/task_planner.rs` — add `collect_sessions_fragment`, `collect_notes_fragment` providers; wire into `plan_from_goal` dispatcher.
- `apps/desktop/src-tauri/src/settings_commands.rs` — add `planner_notes` field to the settings schema (or piggyback on existing settings struct).

**Create (TS):**
- `apps/desktop/src/components/vault/tasks/TaskKanbanView.tsx` — kanban columns.
- `apps/desktop/src/components/vault/tasks/TaskCalendarView.tsx` — month calendar.
- `apps/desktop/src/components/vault/tasks/ViewToggle.tsx` — list/kanban/calendar picker.
- `apps/desktop/src/components/vault/tasks/PlannerNotesSetting.tsx` — textarea in settings.

**Modify (TS):**
- `apps/desktop/src/components/vault/tasks/groupings.ts` — add 3 new groupings.
- `apps/desktop/src/components/vault/tasks/GroupByMenu.tsx` — surface 3 new options.
- `apps/desktop/src/components/vault/tasks/FiltersBar.tsx` — mount ViewToggle.
- `apps/desktop/src/components/sidebar/vault/TasksSection.tsx` — track view state; switch between views.
- `apps/desktop/src/lib/keybindings/commands.ts` (or wherever the command palette registers entries) — register "Plan: …" command.

---

## Task 1 · Sessions + Notes context providers

**File:** `apps/desktop/src-tauri/src/task_planner.rs`

- [ ] **Step 1.1:** Add `collect_sessions_fragment`:

```rust
pub async fn collect_sessions_fragment(app: &AppHandle) -> Option<ContextFragment> {
    // Solo keeps recent agent sessions in the agentStore (frontend). Rust
    // side reads them from disk (~/.solo/sessions/*.json) via the helper
    // in solo-core or session_commands. If session listing from Rust is
    // fragile, return None — planner degrades gracefully.
    use tauri::Manager as _;
    let session_mgr = app.state::<std::sync::Arc<crate::agent::SessionManager>>();
    // Probe whether the manager exposes a `list_sessions` method
    let Ok(ids) = session_mgr.list_sessions() else { return None; };
    if ids.is_empty() { return None; }

    // Keep last 5; for each, read its title (if stored) or first prompt
    let lines: Vec<String> = ids.into_iter().rev().take(5).map(|id| {
        format!("- session {}", &id[..8.min(id.len())])
    }).collect();
    if lines.is_empty() { return None; }
    Some(ContextFragment::new("sessions", lines.join("\n")))
}
```

If `SessionManager::list_sessions` doesn't exist, the simpler fallback:

```rust
pub async fn collect_sessions_fragment(_app: &AppHandle) -> Option<ContextFragment> {
    // Phase 6 fallback: read recent session JSON files directly.
    let home = dirs::home_dir()?;
    let sess_dir = home.join(".solo").join("sessions");
    let mut entries: Vec<std::path::PathBuf> = std::fs::read_dir(&sess_dir).ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|ext| ext == "json").unwrap_or(false))
        .collect();
    entries.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    entries.reverse();
    entries.truncate(5);
    if entries.is_empty() { return None; }
    let body = entries.iter().map(|p| {
        let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("?");
        format!("- {}", name)
    }).collect::<Vec<_>>().join("\n");
    Some(ContextFragment::new("sessions", body))
}
```

Use whichever path works. If both fail, return None.

- [ ] **Step 1.2:** Add `collect_notes_fragment`:

```rust
pub async fn collect_notes_fragment(app: &AppHandle) -> Option<ContextFragment> {
    // Read the `planner_notes` field from settings. For v1, this is a string
    // stored in Solo's main settings struct. If no notes are set, return None.
    use tauri::Manager as _;
    let settings_state = app.state::<crate::settings_commands::SettingsState>();
    // Settings struct typically has a `get` or direct field access
    let notes = match settings_state.get_planner_notes().await {
        Ok(s) if !s.trim().is_empty() => s,
        _ => return None,
    };
    Some(ContextFragment::new("notes", notes))
}
```

**IMPORTANT:** The `get_planner_notes` accessor doesn't exist yet; it's added in Task 2. If you're implementing Task 1 before Task 2, create a stub that returns `None` and mark it with a `TODO(phase-6-task-2)` comment — to be resolved in the next task.

Actually cleaner: implement Task 1 and Task 2 as one atomic commit. See Task 2.

- [ ] **Step 1.3:** In `plan_from_goal`, extend the `match source.as_str()` block:
```rust
"sessions" => collect_sessions_fragment(app).await,
"notes"    => collect_notes_fragment(app).await,
```

- [ ] **Step 1.4:** Update `DEFAULT_BUNDLE` in `crates/solo-tasks/src/context/mod.rs` to include the two new sources:
```rust
pub const DEFAULT_BUNDLE: &[&str] = &["vault", "skills", "git", "tasks", "sessions", "notes"];
```

- [ ] **Step 1.5:** `cargo check -p solo-desktop-lib`.

- [ ] **Step 1.6:** Commit as part of Task 2's commit (atomic).

---

## Task 2 · Planner notes setting

**Files:**
- `apps/desktop/src-tauri/src/settings_commands.rs`
- `apps/desktop/src/components/vault/tasks/PlannerNotesSetting.tsx` (new)

### Rust side

- [ ] **Step 2.1:** Read `apps/desktop/src-tauri/src/settings_commands.rs` to understand the current settings schema. Solo has an established settings pattern — find the settings struct and its persistence mechanism.

- [ ] **Step 2.2:** Add a `planner_notes: String` field to the main settings struct (default empty). Extend any serialization attributes as needed to keep existing settings files backward compatible.

- [ ] **Step 2.3:** Add accessor methods:
```rust
impl SettingsState {
    pub async fn get_planner_notes(&self) -> Result<String, String> {
        let guard = self.settings.read().await;
        Ok(guard.planner_notes.clone())
    }
    pub async fn set_planner_notes(&self, notes: String) -> Result<(), String> {
        let mut guard = self.settings.write().await;
        guard.planner_notes = notes;
        // Persist via whatever write path settings uses
        drop(guard);
        self.save().await
    }
}
```

**IMPORTANT:** Adapt to the actual `SettingsState` shape and save mechanism. The method bodies above assume an `RwLock<Settings>` with a `save()` method — typical but verify.

- [ ] **Step 2.4:** Add Tauri commands:
```rust
#[tauri::command]
pub async fn settings_get_planner_notes(state: State<'_, SettingsState>) -> Result<String, String> {
    state.get_planner_notes().await
}

#[tauri::command]
pub async fn settings_set_planner_notes(notes: String, state: State<'_, SettingsState>) -> Result<(), String> {
    state.set_planner_notes(notes).await
}
```

- [ ] **Step 2.5:** Register commands in `lib.rs`'s `generate_handler![]`.

### TS side

- [ ] **Step 2.6:** Create `apps/desktop/src/components/vault/tasks/PlannerNotesSetting.tsx`:

```tsx
import { useEffect, useState, type FC } from 'react';
import { invoke } from '@tauri-apps/api/core';

export const PlannerNotesSetting: FC = () => {
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void invoke<string>('settings_get_planner_notes').then((s) => {
      setNotes(s);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const save = (next: string) => {
    setNotes(next);
    void invoke('settings_set_planner_notes', { notes: next });
  };

  return (
    <label className="flex flex-col gap-1 p-4 text-[12px] text-muted-foreground">
      Planner notes
      <textarea
        rows={5}
        value={notes}
        onChange={(e) => save(e.target.value)}
        disabled={!loaded}
        placeholder="e.g. I'm focused on shipping the billing dashboard this quarter. Prioritize backend work over UI polish."
        className="resize-y rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground"
      />
      <span className="mt-0.5 text-[10px]">Read by the planner on every goal-plan and proactive run. Short is fine.</span>
    </label>
  );
};
```

- [ ] **Step 2.7:** Mount the component somewhere visible. Simplest: add a "Planner" section at the top of the Tasks tab, collapsible. Or mount in a dedicated Settings drawer. For Phase 6, the simplest path is: add a small gear icon in `FiltersBar` that opens a modal containing `PlannerNotesSetting`.

Add a `SettingsModal` component alongside:
```tsx
// apps/desktop/src/components/vault/tasks/TasksSettingsModal.tsx
import type { FC } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { PlannerNotesSetting } from './PlannerNotesSetting';

interface Props { readonly open: boolean; readonly onClose: () => void; }

export const TasksSettingsModal: FC<Props> = ({ open, onClose }) => (
  <AnimatePresence>
    {open && (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 grid place-items-center bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          onClick={(e) => e.stopPropagation()}
          className="flex w-full max-w-md flex-col rounded-[14px] border border-border/60 bg-card shadow-lg"
        >
          <header className="flex items-center justify-between border-b border-border/50 px-4 py-3">
            <h2 className="text-[14px] font-semibold">Tasks settings</h2>
            <button type="button" onClick={onClose} aria-label="Close"
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted/50">
              <X className="h-4 w-4" />
            </button>
          </header>
          <PlannerNotesSetting />
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
```

Add a gear button to `FiltersBar` and wire open-state through `TasksSection` the way `NewPlanDialog` is wired. Import `Settings` from `lucide-react`.

- [ ] **Step 2.8:** `cargo check -p solo-desktop-lib` + `bun run check` zero errors.

- [ ] **Step 2.9:** Commit (this captures Task 1 + Task 2):
```bash
git add crates/solo-tasks/src/context/mod.rs apps/desktop/src-tauri/src/task_planner.rs apps/desktop/src-tauri/src/settings_commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/components/vault/tasks/PlannerNotesSetting.tsx apps/desktop/src/components/vault/tasks/TasksSettingsModal.tsx apps/desktop/src/components/vault/tasks/FiltersBar.tsx apps/desktop/src/components/sidebar/vault/TasksSection.tsx
git commit -m "feat(tasks): Sessions + Notes context providers + planner_notes setting"
```

No Claude attribution.

---

## Task 3 · Remaining 3 groupings

**File:** `apps/desktop/src/components/vault/tasks/groupings.ts`

Add `context_anchor`, `agent_fingerprint`, `last_run_health`.

- [ ] **Step 3.1:** Update `GroupKey`:
```ts
export type GroupKey =
  | 'status' | 'priority' | 'executor' | 'cadence'
  | 'context_anchor' | 'agent_fingerprint' | 'last_run_health'
  | 'none';
```

- [ ] **Step 3.2:** Extend `GROUPING_LABELS`:
```ts
export const GROUPING_LABELS: Record<GroupKey, string> = {
  status:            'Status',
  priority:          'Priority',
  executor:          'Executor',
  cadence:           'Cadence',
  context_anchor:    'Context anchor',
  agent_fingerprint: 'Agent fingerprint',
  last_run_health:   'Last-run health',
  none:              'No grouping',
};
```

- [ ] **Step 3.3:** Extend `groupTasks` with bucketing for the 3 new keys:

```ts
if (key === 'context_anchor') {
  const buckets = new Map<string, Task[]>();
  for (const t of tasks) {
    // Each task may have N anchors; it appears in EACH bucket (a task can be in multiple groups here).
    if (!t.context_anchors || t.context_anchors.length === 0) {
      const list = buckets.get('none') ?? [];
      list.push(t);
      buckets.set('none', list);
    } else {
      for (const anchor of t.context_anchors) {
        const key = `${anchor.kind}:${anchor.id}`;
        const list = buckets.get(key) ?? [];
        list.push(t);
        buckets.set(key, list);
      }
    }
  }
  return Array.from(buckets.entries()).map(([id, tasks]) => ({
    id,
    label: id === 'none' ? 'No anchor' : id,
    tasks,
  }));
}

if (key === 'agent_fingerprint') {
  const buckets = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.agent_config
      ? `${t.agent_config.model ?? 'default'} · ${t.agent_config.execution_location}`
      : 'no-config';
    const list = buckets.get(key) ?? [];
    list.push(t);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries()).map(([id, tasks]) => ({
    id, label: id === 'no-config' ? 'Manual / no config' : id, tasks,
  }));
}

if (key === 'last_run_health') {
  const buckets = new Map<string, Task[]>();
  const now = Date.now();
  const bucketFor = (t: Task): string => {
    if (!t.runs || t.runs.length === 0) return 'never-run';
    const last = t.runs[0]; // runs are sorted newest first
    if (last.outcome === 'failed') return 'failed';
    if (last.outcome === 'cancelled') return 'cancelled';
    if (last.outcome === 'running') return 'running';
    // Succeeded — check if scheduled and overdue
    if (t.schedule) {
      const nextFire = t.schedule.kind === 'cron' ? Number(t.schedule.data.next_fire)
        : t.schedule.kind === 'preset' ? Number(t.schedule.data.next_fire)
        : null;
      if (nextFire && nextFire < now - 86_400_000) return 'overdue'; // >1 day overdue
    }
    return 'succeeded';
  };
  for (const t of tasks) {
    const k = bucketFor(t);
    const list = buckets.get(k) ?? [];
    list.push(t);
    buckets.set(k, list);
  }
  const order = ['failed', 'overdue', 'running', 'never-run', 'succeeded', 'cancelled'];
  const labels: Record<string, string> = {
    failed: 'Failed',
    overdue: 'Overdue',
    running: 'Running',
    'never-run': 'Never run',
    succeeded: 'Succeeded',
    cancelled: 'Cancelled',
  };
  return order.filter((k) => buckets.has(k))
    .map((k) => ({ id: k, label: labels[k], tasks: buckets.get(k) ?? [] }));
}
```

- [ ] **Step 3.4:** Update `GroupByMenu.tsx`'s `OPTIONS` array:
```ts
const OPTIONS: GroupKey[] = [
  'status', 'priority', 'executor', 'cadence',
  'context_anchor', 'agent_fingerprint', 'last_run_health',
  'none',
];
```

- [ ] **Step 3.5:** `bun run check` zero errors.

- [ ] **Step 3.6:** Commit:
```bash
git add apps/desktop/src/components/vault/tasks/groupings.ts apps/desktop/src/components/vault/tasks/GroupByMenu.tsx
git commit -m "feat(tasks): 3 new groupings (context-anchor, agent-fingerprint, last-run-health)"
```

---

## Task 4 · Kanban view

**File:** `apps/desktop/src/components/vault/tasks/TaskKanbanView.tsx` (new)

Read-only kanban (no drag-drop for v1 — drag-drop is v1.1 polish).

- [ ] **Step 4.1:**

```tsx
import { useMemo, type FC } from 'react';
import { useTaskStore } from '@/stores/taskStore';
import { TaskRow } from './TaskRow';
import { groupTasks, type GroupKey } from './groupings';

interface Props { readonly grouping: GroupKey; }

export const TaskKanbanView: FC<Props> = ({ grouping }) => {
  const tasksMap = useTaskStore((s) => s.tasks);
  const selectedId = useTaskStore((s) => s.selectedTaskId);
  const select = useTaskStore((s) => s.select);
  const update = useTaskStore((s) => s.update);
  const tasks = useMemo(() => Array.from(tasksMap.values()), [tasksMap]);
  // Use status as the fallback grouping for kanban if 'none' is selected
  const effectiveGrouping = grouping === 'none' ? 'status' : grouping;
  const groups = useMemo(() => groupTasks(tasks, effectiveGrouping as GroupKey), [tasks, effectiveGrouping]);

  if (tasks.length === 0) {
    return <div className="grid h-full place-items-center text-[13px] text-muted-foreground">No tasks yet.</div>;
  }

  return (
    <div className="flex min-w-0 gap-3 overflow-x-auto p-3">
      {groups.map((g) => (
        <section
          key={g.id}
          className="flex min-w-[280px] max-w-[320px] shrink-0 flex-col gap-1.5 rounded-[12px] border border-border/50 bg-muted/20 p-2"
        >
          <header className="flex items-center justify-between px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{g.label}</span>
            <span>{g.tasks.length}</span>
          </header>
          <ul className="flex flex-col gap-1">
            {g.tasks.map((t) => (
              <li key={t.id}>
                <TaskRow
                  task={t}
                  isSelected={selectedId === t.id}
                  onSelect={select}
                  onToggleDone={(id, next) => void update(id, { status: next })}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};
```

- [ ] **Step 4.2:** Commit:
```bash
git add apps/desktop/src/components/vault/tasks/TaskKanbanView.tsx
git commit -m "feat(tasks): Kanban view (read-only columns)"
```

---

## Task 5 · Calendar view

**File:** `apps/desktop/src/components/vault/tasks/TaskCalendarView.tsx` (new)

- [ ] **Step 5.1:**

```tsx
import { useMemo, useState, type FC } from 'react';
import { ChevronLeft, ChevronRight, Bot, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Task } from '@/lib/tauri/tasks';

export const TaskCalendarView: FC = () => {
  const tasksMap = useTaskStore((s) => s.tasks);
  const select = useTaskStore((s) => s.select);
  const tasks = useMemo(() => Array.from(tasksMap.values()), [tasksMap]);

  const [cursor, setCursor] = useState<Date>(() => new Date());
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // Build a calendar grid: first Sun on or before day 1, 6 rows of 7
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay());

  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }

  // Bucket tasks by day based on their next scheduled fire (if any).
  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const sched = t.schedule;
      if (!sched) continue;
      const ts =
        sched.kind === 'cron' ? Number(sched.data.next_fire) :
        sched.kind === 'preset' ? Number(sched.data.next_fire) :
        sched.kind === 'one_shot' ? Number(sched.data.at) :
        null;
      if (!ts) continue;
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const label = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <header className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted/50"
        ><ChevronLeft className="h-4 w-4" /></button>
        <span className="min-w-[140px] text-center text-[13px] font-medium">{label}</span>
        <button
          type="button"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted/50"
        ><ChevronRight className="h-4 w-4" /></button>
        <button
          type="button"
          onClick={() => setCursor(new Date())}
          className="ml-2 rounded-md border border-border/60 bg-card px-2 py-0.5 text-[11px] font-medium hover:bg-muted/60"
        >Today</button>
      </header>

      <div className="grid grid-cols-7 gap-px rounded-md bg-border/40 p-px text-[11px]">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="bg-background p-1 text-center font-medium text-muted-foreground">{d}</div>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          const dayTasks = tasksByDay.get(key) ?? [];
          const isToday = isSameDay(d, new Date());
          return (
            <div
              key={i}
              className={cn(
                'flex min-h-[70px] flex-col gap-0.5 bg-background p-1',
                !inMonth && 'opacity-40',
                isToday && 'ring-1 ring-inset ring-blue-500/50',
              )}
            >
              <span className="text-[10px] text-muted-foreground tabular-nums">{d.getDate()}</span>
              {dayTasks.slice(0, 3).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => select(t.id)}
                  className="flex items-center gap-1 truncate rounded bg-card px-1 py-0.5 text-left text-[10px] hover:bg-muted/60"
                >
                  {t.executor === 'agent' ? <Bot className="h-2.5 w-2.5 shrink-0" /> : <User className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{t.title}</span>
                </button>
              ))}
              {dayTasks.length > 3 && (
                <span className="text-[9px] text-muted-foreground">+{dayTasks.length - 3} more</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
```

- [ ] **Step 5.2:** Commit:
```bash
git add apps/desktop/src/components/vault/tasks/TaskCalendarView.tsx
git commit -m "feat(tasks): Calendar view (month grid of scheduled fires)"
```

---

## Task 6 · View toggle + wire into TasksSection

**Files:**
- `apps/desktop/src/components/vault/tasks/ViewToggle.tsx` (new)
- `apps/desktop/src/components/vault/tasks/FiltersBar.tsx`
- `apps/desktop/src/components/sidebar/vault/TasksSection.tsx`

- [ ] **Step 6.1:** Create `ViewToggle.tsx`:

```tsx
import type { FC } from 'react';
import { List, Columns3, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ViewKind = 'list' | 'kanban' | 'calendar';

interface Props {
  readonly value: ViewKind;
  readonly onChange: (v: ViewKind) => void;
}

export const ViewToggle: FC<Props> = ({ value, onChange }) => (
  <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-card p-0.5">
    {([
      { k: 'list' as const,     Icon: List,         title: 'List view' },
      { k: 'kanban' as const,   Icon: Columns3,     title: 'Kanban view' },
      { k: 'calendar' as const, Icon: CalendarDays, title: 'Calendar view' },
    ]).map(({ k, Icon, title }) => (
      <button
        key={k}
        type="button"
        title={title}
        onClick={() => onChange(k)}
        className={cn(
          'grid h-6 w-6 place-items-center rounded text-muted-foreground',
          value === k ? 'bg-muted text-foreground' : 'hover:text-foreground',
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    ))}
  </div>
);
```

- [ ] **Step 6.2:** In `FiltersBar.tsx`, add `view` + `onViewChange` props and render `<ViewToggle />` between search and group-by:
```tsx
<ViewToggle value={view} onChange={onViewChange} />
```

- [ ] **Step 6.3:** In `TasksSection.tsx`:
- Add state: `const [view, setView] = useState<ViewKind>('list');`
- Pass `view={view} onViewChange={setView}` to FiltersBar.
- Replace `<TaskListView grouping={grouping} />` with conditional:
```tsx
{view === 'list' && <TaskListView grouping={grouping} />}
{view === 'kanban' && <TaskKanbanView grouping={grouping} />}
{view === 'calendar' && <TaskCalendarView />}
```
Import `TaskKanbanView`, `TaskCalendarView`, `ViewToggle`, `ViewKind`.

- [ ] **Step 6.4:** `bun run check` zero errors.

- [ ] **Step 6.5:** Commit:
```bash
git add apps/desktop/src/components/vault/tasks/ViewToggle.tsx apps/desktop/src/components/vault/tasks/FiltersBar.tsx apps/desktop/src/components/sidebar/vault/TasksSection.tsx
git commit -m "feat(tasks): view toggle (list/kanban/calendar)"
```

---

## Task 7 · Command palette entry (scoped)

Solo likely has a command palette that reads command definitions from a registry. Finding that registry and adding an entry is relatively small.

- [ ] **Step 7.1:** Locate the command palette implementation:
```bash
grep -rn "commandPalette\|CommandPalette\|command.*registry\|cmdk" apps/desktop/src/ | head -10
```

If there's no existing command palette, **report this task as SKIPPED** in the smoke test / wrap-up. Document the limitation in `docs/superpowers/specs/2026-04-21-task-allocator-design.md`'s §14. The "New Plan" button is still the primary entry.

If a palette exists:
- Find where commands are registered.
- Add a command:
  - ID: `tasks.new_plan`
  - Label: "Tasks: New Plan…"
  - Action: opens the NewPlanDialog (emit a custom event that TasksSection listens for, OR invoke a global store action).

- [ ] **Step 7.2:** If implemented, commit:
```bash
git add <files>
git commit -m "feat(tasks): command palette entry for New Plan"
```

If skipped, note in wrap-up and move on.

---

## Task 8 · Smoke test Phase 6

- [ ] **Step 8.1:** Restart `bun run dev`.
- [ ] **Step 8.2:** Create 6 tasks with varying configs (some scheduled, some agent-executor with runs, some manual). Switch Group by through all 7 groupings. Each should render without errors.
- [ ] **Step 8.3:** Click the Kanban view toggle. Expect: columns based on current grouping, each with tasks.
- [ ] **Step 8.4:** Click Calendar view. Expect: month grid. Navigate prev/next months. Scheduled tasks appear on their fire days.
- [ ] **Step 8.5:** Open settings gear. Enter "I'm focused on the billing dashboard this quarter." in Planner notes. Save (it auto-saves on change).
- [ ] **Step 8.6:** New Plan with a vague goal. Expect: drafts reference "billing" or "dashboard" based on the notes.
- [ ] **Step 8.7:** Restart app. Verify planner_notes persists.

---

## Task 9 · Wrap-up

- [ ] **Step 9.1:** All checks:
```bash
cargo test --workspace --lib
cargo clippy -p solo-tasks --all-targets -- -D warnings
bun run check
```

- [ ] **Step 9.2:** Mark Phase 6 complete in spec (§15). Note any skipped items (e.g. command palette if no existing palette).

- [ ] **Step 9.3:** Commit + announce Phase 6 complete.

---

## Known Phase 6 limitations (explicit)

1. **Kanban is read-only** — no drag-drop. True drag-drop needs a library integration (atlaskit/pragmatic-drag-and-drop already in-repo per the Plane recon, but wiring it up is substantial).
2. **Calendar buckets by next_fire only** — completed tasks without a schedule don't appear. This is intentional (calendar = "when will things fire").
3. **Telemetry table (§13 of spec) deferred.** Low user-value for v1; revisit if needed.
4. **Idempotent hash cache deferred** (from Phase 5 scope).
5. **Command palette entry only if an existing palette is found.** Otherwise the "New Plan" button is the sole entry.

## Self-review

- **Spec coverage:** §7 all 7 groupings ✓, §8 list+kanban+calendar views ✓, §3 full 6-source bundle ✓, §6 `planner_notes` setting ✓.
- **No placeholders.** All code complete.
- **Type consistency:** `GroupKey`, `ViewKind`, `Task` shape consistent across files.
