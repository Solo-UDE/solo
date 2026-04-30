import { useEffect, useRef, useState, type FC, type KeyboardEvent } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Task } from '@/bindings/Task';
import type { Subtask } from '@/bindings/Subtask';

interface Props {
  task: Task;
}

/**
 * Drawer section for editing a task's checklist. Rows can be toggled, renamed
 * inline, removed, or reordered by drag. Add-input at the bottom.
 *
 * Reorder uses the same `@atlaskit/pragmatic-drag-and-drop` library as the
 * Kanban view, so we have one drag paradigm across the panel.
 */
export const SubtaskList: FC<Props> = ({ task }) => {
  const addSubtask = useTaskStore((s) => s.addSubtask);
  const toggleSubtask = useTaskStore((s) => s.toggleSubtask);
  const renameSubtask = useTaskStore((s) => s.renameSubtask);
  const removeSubtask = useTaskStore((s) => s.removeSubtask);
  const reorderSubtasks = useTaskStore((s) => s.reorderSubtasks);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const completedCount = task.subtasks.filter((s) => s.completed).length;
  const totalCount = task.subtasks.length;

  const submitDraft = async () => {
    const t = draft.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await addSubtask(task.id, t);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async (dragId: string, targetId: string) => {
    if (dragId === targetId) return;
    const ids = task.subtasks.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    await reorderSubtasks(task.id, next);
  };

  return (
    <section className="flex flex-col gap-1.5">
      <header className="flex items-center justify-between px-0.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Subtasks
        </h3>
        {totalCount > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {completedCount}/{totalCount}
          </span>
        )}
      </header>

      {totalCount > 0 && (
        <ul className="flex flex-col gap-0.5">
          {task.subtasks.map((s) => (
            <SubtaskRow
              key={s.id}
              subtask={s}
              onToggle={(c) => void toggleSubtask(task.id, s.id, c)}
              onRename={(title) => void renameSubtask(task.id, s.id, title)}
              onRemove={() => void removeSubtask(task.id, s.id)}
              onDrop={(dragId) => void handleDrop(dragId, s.id)}
            />
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitDraft();
        }}
        className="flex items-center gap-2 rounded-[8px] border border-dashed border-border/50 bg-muted/20 px-2 py-1.5"
      >
        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a subtask…"
          disabled={busy}
          className="flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
      </form>
    </section>
  );
};

// ---------------------------------------------------------------------------

interface RowProps {
  subtask: Subtask;
  onToggle: (completed: boolean) => void;
  onRename: (title: string) => void;
  onRemove: () => void;
  onDrop: (dragId: string) => void;
}

const SubtaskRow: FC<RowProps> = ({ subtask, onToggle, onRename, onRemove, onDrop }) => {
  const ref = useRef<HTMLLIElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(subtask.title);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    setDraft(subtask.title);
  }, [subtask.title]);

  useEffect(() => {
    const el = ref.current;
    const handle = handleRef.current;
    if (!el || !handle) return;
    const cleanupDrag = draggable({
      element: el,
      dragHandle: handle,
      getInitialData: () => ({ subtaskId: subtask.id }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
    const cleanupDrop = dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        const data = source.data as { subtaskId?: string };
        return typeof data.subtaskId === 'string' && data.subtaskId !== subtask.id;
      },
      onDragEnter: () => setHovered(true),
      onDragLeave: () => setHovered(false),
      onDrop: ({ source }) => {
        setHovered(false);
        const data = source.data as { subtaskId?: string };
        if (typeof data.subtaskId === 'string') onDrop(data.subtaskId);
      },
    });
    return () => {
      cleanupDrag();
      cleanupDrop();
    };
  }, [subtask.id, onDrop]);

  const commitRename = () => {
    const t = draft.trim();
    setEditing(false);
    if (!t || t === subtask.title) {
      setDraft(subtask.title);
      return;
    }
    onRename(t);
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      setDraft(subtask.title);
      setEditing(false);
    }
  };

  return (
    <li
      ref={ref}
      className={cn(
        'group relative flex items-center gap-2 rounded-[8px] px-1.5 py-1.5',
        'border border-transparent hover:bg-muted/40',
        dragging && 'opacity-40',
        hovered && 'border-primary/50 bg-primary/5',
      )}
    >
      <button
        ref={handleRef}
        type="button"
        className="grid h-5 w-4 place-items-center rounded-sm text-muted-foreground/40 opacity-0 transition-opacity cursor-grab group-hover:opacity-100 hover:text-muted-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <input
        type="checkbox"
        checked={subtask.completed}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
      />

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKey}
          className="flex-1 rounded-sm bg-transparent text-[12.5px] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            'flex-1 text-left text-[12.5px] cursor-text',
            subtask.completed && 'text-muted-foreground line-through',
          )}
        >
          {subtask.title}
        </button>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove subtask"
        className="grid h-5 w-5 place-items-center rounded-sm text-muted-foreground/50 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </li>
  );
};
