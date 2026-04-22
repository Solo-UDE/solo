import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useTaskStore } from '@/stores/taskStore';
import type { TaskPatch } from '@/bindings/TaskPatch';
import type { TaskStatus } from '@/bindings/TaskStatus';
import type { TaskPriority } from '@/bindings/TaskPriority';
import { TaskRow } from './TaskRow';
import { groupTasks, type GroupKey } from './groupings';
import { cn } from '@/lib/utils';

interface Props { readonly grouping: GroupKey; }

// Only groupings that map 1-to-1 to a patchable TaskPatch field.
type PatchableKey = 'status' | 'priority';
const PATCHABLE: PatchableKey[] = ['status', 'priority'];
const isPatchable = (k: string): k is PatchableKey => PATCHABLE.includes(k as PatchableKey);

// ---------------------------------------------------------------------------
// DraggableRow — wraps a task card <li> with pragmatic-drag-and-drop
// ---------------------------------------------------------------------------
const DraggableRow: FC<{
  taskId: string;
  fromGroupId: string;
  children: React.ReactNode;
}> = ({ taskId, fromGroupId, children }) => {
  const ref = useRef<HTMLLIElement | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({ taskId, fromGroupId }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [taskId, fromGroupId]);

  return (
    <li ref={ref} className={cn('cursor-grab active:cursor-grabbing', dragging && 'opacity-40')}>
      {children}
    </li>
  );
};

// ---------------------------------------------------------------------------
// DropColumn — column section that is a drop target when accept=true
// ---------------------------------------------------------------------------
const DropColumn: FC<{
  groupId: string;
  accept: boolean;
  onDrop: (taskId: string) => void;
  children: React.ReactNode;
}> = ({ groupId, accept, onDrop, children }) => {
  const ref = useRef<HTMLElement | null>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        if (!accept) return false;
        const data = source.data as { taskId?: string; fromGroupId?: string };
        return typeof data.taskId === 'string' && data.fromGroupId !== groupId;
      },
      onDragEnter: () => setHover(true),
      onDragLeave: () => setHover(false),
      onDrop: ({ source }) => {
        setHover(false);
        const data = source.data as { taskId?: string };
        if (typeof data.taskId === 'string') onDrop(data.taskId);
      },
    });
  }, [groupId, accept, onDrop]);

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className={cn(
        'flex min-w-[280px] max-w-[320px] shrink-0 flex-col gap-1.5 rounded-[12px] border border-border/40 bg-muted/20 p-2 transition-colors',
        hover && accept && 'border-primary/60 bg-primary/10',
      )}
    >
      {children}
    </section>
  );
};

// ---------------------------------------------------------------------------
// TaskKanbanView — main export
// ---------------------------------------------------------------------------
export const TaskKanbanView: FC<Props> = ({ grouping }) => {
  const tasksMap = useTaskStore((s) => s.tasks);
  const selectedId = useTaskStore((s) => s.selectedTaskId);
  const select = useTaskStore((s) => s.select);
  const update = useTaskStore((s) => s.update);
  const tasks = useMemo(() => Array.from(tasksMap.values()), [tasksMap]);
  const effectiveGrouping = grouping === 'none' ? 'status' : grouping;
  const groups = useMemo(() => groupTasks(tasks, effectiveGrouping as GroupKey), [tasks, effectiveGrouping]);

  const canPatch = isPatchable(effectiveGrouping);

  if (tasks.length === 0) {
    return <div className="grid h-full place-items-center text-[13px] text-muted-foreground">No tasks yet.</div>;
  }

  return (
    <div className="flex min-w-0 gap-3 overflow-x-auto p-3">
      {groups.map((g) => (
        <DropColumn
          key={g.id}
          groupId={g.id}
          accept={canPatch}
          onDrop={(taskId) => {
            if (!canPatch) return;
            let patch: TaskPatch;
            if (effectiveGrouping === 'status') {
              patch = { status: g.id as TaskStatus };
            } else {
              patch = { priority: g.id as TaskPriority };
            }
            void update(taskId, patch);
          }}
        >
          <header className="flex items-center justify-between px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{g.label}</span>
            <span>{g.tasks.length}</span>
          </header>
          <ul className="flex flex-col gap-1">
            {g.tasks.map((t) => (
              <DraggableRow key={t.id} taskId={t.id} fromGroupId={g.id}>
                <TaskRow
                  task={t}
                  isSelected={selectedId === t.id}
                  onSelect={select}
                  onToggleDone={(id, next) => void update(id, { status: next })}
                />
              </DraggableRow>
            ))}
          </ul>
        </DropColumn>
      ))}
    </div>
  );
};
