# Kanban Subtasks + Circle Restyle — Design

**Status:** Approved 2026-04-22
**Author:** sachin (brainstorm w/ Claude)
**Predecessor:** `Orbit/docs/plans/tracked/todo/kanban-ticket-board.md` (Orbit-era plan; superseded by this doc)

## Context

Solo's existing **Task Allocator** already implements the three-view panel (list / kanban / calendar) that the predecessor plan was scoped to build. The predecessor assumed a greenfield ticket system with a single JSON file and per-subtask CLI task files. That assumption does not hold in Solo: task persistence is SQLite-backed via `solo-tasks`, agent assignment is wired through `task_executor::spawn_agent_for_task`, and the three views already exist.

This spec supersedes the predecessor by narrowing scope to the true delta:

1. Add **subtasks** (checklist items) to the existing `Task` model — the one feature the current panel lacks.
2. **Restyle** the existing views with Circle's (Linear-like) visual vocabulary, porting Circle's SVG icons and selector composition but not its routing, primitives, or multi-tenant concepts.

## Goals

- User can add an ordered checklist of subtasks to any task.
- User can toggle, rename, remove, and reorder subtasks from the task drawer.
- Agent executions receive the subtask list as a markdown checklist in their first message.
- The three existing views (list, kanban, calendar) render subtask progress inline.
- The panel visually matches Circle's Linear-inspired look: SVG status/priority icons, popover selectors, grouped-section headers, card-style Kanban columns.

## Non-goals (explicitly cut)

- Labels, projects, cycles — no new backend domains in this spec.
- Members, teams, inbox, multi-tenant orgs — Solo is single-user.
- Circle's routing (`app/[orgId]/`), `MainLayout`, and `headers/` — Solo's panel has its own shell.
- Circle's `components/ui/` — Solo already has its own primitive library.
- Circle's `react-dnd` / `react-dnd-html5-backend` — Solo uses `@atlaskit/pragmatic-drag-and-drop`.
- Auto-ticking subtasks by parsing agent output — unreliable; user ticks manually.
- A polling sync loop (as in the Orbit plan) — SQLite + `BackendEvent::TasksChanged` already cover updates.

## Architecture

Existing Solo architecture is untouched at the domain level:

- Rust side: `solo-protocol` types → `solo-tasks` SQLite store → `task_commands` Tauri commands → `BackendEvent::TasksChanged` event stream → frontend `useTaskStream` → `taskStore` patches Map.
- Agent assignment: `taskStore.run()` → `task_executor::spawn_agent_for_task` → `SessionManager::create_session` + first-message send.
- UI: `TasksPanel` → `TasksSection` (owns view/grouping state) → three views + `TaskDrawer` + dialogs.

The delta is localized:

- One new struct (`Subtask`) + one JSON column (`subtasks_json`) in SQLite.
- Five new commands + helper methods in the store.
- One prompt-builder change in `task_executor`.
- Five new React components; nine existing components restyled without API changes.

## Data Model

### New type (`solo-protocol`)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct Subtask {
    pub id: String,                  // UUID
    pub title: String,
    pub completed: bool,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct SubtaskDraft {
    pub title: String,
}
```

Subtask ordering lives in the containing `Vec` — no explicit `position` field. Reordering rewrites the array. Rationale: subtask counts are small (typically <20 per task) so O(n) array rewrites are cheaper than managing lexorank and pay no indexing cost.

### Extended types

- `Task.subtasks: Vec<Subtask>` — `#[serde(default)]` so existing rows deserialize to empty.
- `TaskDraft.subtasks: Vec<SubtaskDraft>` — `#[serde(default)]`, optional on create.
- `TaskPatch.subtasks: Option<Vec<Subtask>>` — bulk replace escape hatch. Not used by the UI; kept for completeness.

### SQLite migration (`solo-tasks/src/store.rs`)

The existing `migrate()` uses `CREATE TABLE IF NOT EXISTS` without versioning. We introduce a `PRAGMA user_version` gate:

```sql
-- Migration step (runs when user_version < 1)
ALTER TABLE tasks ADD COLUMN subtasks_json TEXT NOT NULL DEFAULT '[]';
PRAGMA user_version = 1;
```

`subtasks` is (de)serialized to/from the `subtasks_json` column — matching the existing `context_anchors_json` pattern. Loaded eagerly in `load_task_row`, written in `insert`.

Migration safety: `ALTER TABLE ADD COLUMN` with `DEFAULT '[]'` is O(1) in SQLite (no table rewrite), so this is safe even on large DBs.

## Commands

Five new `#[tauri::command]` functions in `task_commands.rs`. Each emits `BackendEvent::TasksChanged { task_ids: vec![task_id] }` on success.

| Command | Signature | Notes |
|---|---|---|
| `task_subtask_add` | `(task_id, title) → Task` | Server assigns UUID + `created_at` |
| `task_subtask_toggle` | `(task_id, subtask_id, completed) → Task` | Sets/clears `completed_at` |
| `task_subtask_rename` | `(task_id, subtask_id, title) → Task` | Title edit only |
| `task_subtask_remove` | `(task_id, subtask_id) → Task` | Filters out by id |
| `task_subtask_reorder` | `(task_id, subtask_ids: Vec<String>) → Task` | Must be a permutation of existing IDs; else `TaskError::InvalidReorder` |

Store-layer helpers sit next to the existing `update` method. Each mutation reads the row, rewrites `subtasks_json`, and bumps `updated_at`.

## Agent prompt injection

`task_executor::spawn_agent_for_task` currently composes the first message from `task.title + task.description`. New behavior: if `task.subtasks.is_empty()`, the prompt is unchanged. Otherwise, append:

```
## Checklist
Work through these subtasks in order. Report completion of each explicitly in your
response so the user can tick them off.

- [ ] Subtask 1 title
- [ ] Subtask 2 title
- [x] Subtask 3 title   (← already completed; agent skips)

Do NOT skip subtasks. Do NOT add new ones.
```

Already-completed subtasks render as `[x]` so the agent sees them as done (matters for re-runs after partial completion). **We do not auto-parse agent output** to tick subtasks — parsing completion claims is unreliable and creates false-positive failure modes. If desired later, a dedicated `task_subtask_complete` agent tool is a clean additive extension.

## Frontend Components

Solo's `packages/ui/` already has `Popover`, `Select`, `Dialog`, `ContextMenu`, `Checkbox`, `Badge`, `Menu`, `Tooltip`. Circle's `components/ui/*` is **not** copied. We port only Linear's visual signatures: SVG icons, selector composition, row/card layout.

### New components (`apps/desktop/src/components/vault/tasks/`)

| File | Source | Purpose |
|---|---|---|
| `icons/StatusIcon.tsx` | Circle `mock-data/status.tsx` | SVG per `TaskStatus` (7 variants) |
| `icons/PriorityIcon.tsx` | Circle `mock-data/priorities.tsx` | SVG per `TaskPriority` (4 variants + no-priority) |
| `StatusSelector.tsx` | Circle `issues/status-selector.tsx` | Popover trigger → filterable status list |
| `PrioritySelector.tsx` | Circle `issues/priority-selector.tsx` | Popover trigger → filterable priority list |
| `SubtaskList.tsx` | new | Drawer section: drag handle + checkbox + inline-editable title + remove; add-input at bottom; DnD reorder via pragmatic-drag-and-drop |

### Restyled components (no API change)

| File | Change |
|---|---|
| `TaskRow.tsx` | Circle `issue-line.tsx` layout: `[StatusIcon] [title] [subtask progress] [PriorityIcon] [date]` |
| `TaskListView.tsx` | Grouped collapsible sections (Circle `group-issues.tsx` pattern) |
| `TaskKanbanView.tsx` | Restyled column/card surfaces per Circle `issue-grid.tsx`; DnD wiring unchanged |
| `TaskCalendarView.tsx` | Subtle palette; status dots per day cell |
| `TaskDrawer.tsx` | Title editor → StatusSelector + PrioritySelector → description → **SubtaskList** → context anchors → tabs |
| `NewTaskDialog.tsx` | Compact Circle-style; inline selectors; dynamic subtask inputs pre-submit |
| `FiltersBar.tsx` | Circle filter-pill styling |
| `ViewToggle.tsx` | Segmented-control look |
| `GroupByMenu.tsx` | Popover trigger restyle |

### Store (`taskStore.ts`) additions

```typescript
addSubtask: (taskId: string, title: string) => Promise<Task>;
toggleSubtask: (taskId: string, subtaskId: string, completed: boolean) => Promise<Task>;
renameSubtask: (taskId: string, subtaskId: string, title: string) => Promise<Task>;
removeSubtask: (taskId: string, subtaskId: string) => Promise<Task>;
reorderSubtasks: (taskId: string, subtaskIds: string[]) => Promise<Task>;
```

Each wraps the corresponding `tasksApi.*` call and patches the task in the Map with the returned `Task`. External updates still flow through existing `patchFromEvent`.

## Testing

### Rust unit tests (`solo-tasks/src/store.rs`)

- `subtask_add_appends_and_persists`
- `subtask_toggle_sets_completed_at`
- `subtask_remove_preserves_others`
- `subtask_reorder_permutation` (including failure path on non-permutation)
- `subtask_migration_adds_column_to_existing_db`
- `task_draft_with_subtasks_persists`

### Protocol round-trip

Extend existing round-trip tests in `solo-protocol/tests.rs` to include tasks with non-empty `subtasks`.

### Frontend

- `bun run check` — cargo check + tsc passes (binding regen must succeed).
- `bun run lint` — no new violations.

### Manual E2E

1. Create task with 3 subtasks → card shows `0/3`.
2. Tick one → `1/3`.
3. Drag between Kanban columns → status changes, subtasks persist.
4. Run → agent first message contains checklist.
5. Tick while running → drawer updates via event stream.
6. Rename, reorder, remove subtasks — persist across reload.
7. Switch views — progress rendered consistently.
8. Restart app → subtasks restored.
9. Delete task → subtasks removed with it.

## Out of scope (future extensions)

- `task_subtask_complete` agent tool (auto-tick via agent-callable command).
- Label system (would need `labels` table + FK on tasks).
- Project grouping (would need `projects` table + nullable FK on tasks).
- Cycles (time-boxed task groupings).
- Saved view/filter presets persisted to disk.

Each is independently valuable and independently additive — none require changes to what this spec delivers.

## Key decisions

1. **Enhance existing Task, don't fork a tickets domain.** The Orbit plan's standalone ticket file + per-subtask CLI files are a regression against Solo's SQLite + `task_executor` architecture.
2. **Subtasks live as JSON column on `tasks` row**, not a separate table. Scale is small; atomicity with parent row is valuable.
3. **Array-index ordering for subtasks**, not lexorank. Subtask counts are bounded; array rewrite is simpler.
4. **Five fine-grained commands**, not one bulk patch. Smaller payloads, focused events, better UX responsiveness.
5. **User ticks subtasks manually.** No agent parsing. Future agent-callable tool is an additive extension.
6. **Port Circle's visual atoms only.** Not routing, not primitives, not stores, not multi-user concepts.
7. **Keep `pragmatic-drag-and-drop`.** Single DnD library across Kanban and subtask reorder.
