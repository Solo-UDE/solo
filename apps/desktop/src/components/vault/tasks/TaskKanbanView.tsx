import { useEffect, useMemo, useRef, useState, type FC, type ReactNode } from 'react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useTaskStore } from '@/stores/taskStore';
import { useLabelStore } from '@/stores/labelStore';
import { useProjectStore } from '@/stores/projectStore';
import { useCycleStore } from '@/stores/cycleStore';
import type { TaskStatus } from '@/bindings/TaskStatus';
import type { TaskPriority } from '@/bindings/TaskPriority';
import { TaskRow } from './TaskRow';
import { groupTasks, type GroupKey } from './groupings';
import { cn } from '@/lib/utils';
import { StatusIcon } from './icons/StatusIcon';
import { PriorityIcon, PRIORITY_CLASSNAME } from './icons/PriorityIcon';
import { VirtualList } from '@/components/ui/virtual-list';

interface Props { readonly grouping: GroupKey; }

// Groupings that support drag-drop column moves.
type PatchableKey = 'status' | 'priority' | 'project' | 'cycle' | 'label';
const PATCHABLE: PatchableKey[] = ['status', 'priority', 'project', 'cycle', 'label'];
const isPatchable = (k: string): k is PatchableKey => PATCHABLE.includes(k as PatchableKey);

const STATUS_IDS: TaskStatus[] = ['suggested', 'queued', 'running', 'needs_review', 'done', 'failed', 'archived'];
const PRIORITY_IDS: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];

function columnGlyph(groupingKey: GroupKey, groupId: string): ReactNode {
  if (groupingKey === 'status' && STATUS_IDS.includes(groupId as TaskStatus)) {
    return <StatusIcon status={groupId as TaskStatus} size={13} />;
  }
  if (groupingKey === 'priority' && PRIORITY_IDS.includes(groupId as TaskPriority)) {
    return (
      <span className={cn('inline-grid h-3.5 w-3.5 place-items-center', PRIORITY_CLASSNAME[groupId as TaskPriority])}>
        <PriorityIcon priority={groupId as TaskPriority} size={13} />
      </span>
    );
  }
  return null;
}

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
    <li
      ref={ref}
      className={cn(
        'select-none cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
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
  onDrop: (taskId: string, fromGroupId: string) => void;
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
        const data = source.data as { taskId?: string; fromGroupId?: string };
        if (typeof data.taskId === 'string' && typeof data.fromGroupId === 'string') {
          onDrop(data.taskId, data.fromGroupId);
        }
      },
    });
  }, [groupId, accept, onDrop]);

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className={cn(
        'flex h-full min-w-[280px] max-w-[320px] shrink-0 flex-col gap-1.5 rounded-[12px] border border-border/40 bg-muted/20 p-2 transition-colors',
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
  const setProject = useTaskStore((s) => s.setProject);
  const setCycle = useTaskStore((s) => s.setCycle);
  const addLabel = useTaskStore((s) => s.addLabel);
  const removeLabel = useTaskStore((s) => s.removeLabel);
  const labels = useLabelStore((s) => s.labels);
  const projects = useProjectStore((s) => s.projects);
  const cycles = useCycleStore((s) => s.cycles);
  const tasks = useMemo(() => Array.from(tasksMap.values()), [tasksMap]);
  const effectiveGrouping = grouping === 'none' ? 'status' : grouping;
  const groups = useMemo(
    () => groupTasks(tasks, effectiveGrouping as GroupKey, { labels, projects, cycles }),
    [tasks, effectiveGrouping, labels, projects, cycles],
  );

  const canPatch = isPatchable(effectiveGrouping);

  if (tasks.length === 0) {
    return <div className="grid h-full place-items-center text-[13px] text-muted-foreground">No tasks yet.</div>;
  }

  return (
    <div className="flex h-full min-w-0 gap-3 overflow-x-auto p-3">
      {groups.map((g) => (
        <DropColumn
          key={g.id}
          groupId={g.id}
          accept={canPatch}
          onDrop={(taskId, fromGroupId) => {
            if (!canPatch) return;
            if (effectiveGrouping === 'status') {
              void update(taskId, { status: g.id as TaskStatus });
            } else if (effectiveGrouping === 'priority') {
              void update(taskId, { priority: g.id as TaskPriority });
            } else if (effectiveGrouping === 'project') {
              void setProject(taskId, g.id === 'none' ? null : g.id);
            } else if (effectiveGrouping === 'cycle') {
              void setCycle(taskId, g.id === 'none' ? null : g.id);
            } else if (effectiveGrouping === 'label') {
              // Drag between label columns: remove the source label and add
              // the target. Dragging from "none" only adds; dragging to "none"
              // only removes.
              void (async () => {
                if (g.id !== 'none') await addLabel(taskId, g.id);
                if (fromGroupId !== 'none') await removeLabel(taskId, fromGroupId);
              })();
            }
          }}
        >
          <header className="flex items-center gap-1.5 px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {columnGlyph(effectiveGrouping as GroupKey, g.id)}
            <span>{g.label}</span>
            <span className="ml-auto rounded-full bg-muted/50 px-1.5 text-[10px] font-semibold normal-case tracking-normal text-muted-foreground">
              {g.tasks.length}
            </span>
          </header>
          <VirtualList
            items={g.tasks}
            estimateSize={() => 58}
            overscan={8}
            className="min-h-0 flex-1"
            itemClassName="pb-1"
            getItemKey={(task) => task.id}
            testId={`task-kanban-column-${g.id}`}
            renderItem={(t) => (
              <DraggableRow taskId={t.id} fromGroupId={g.id}>
                <TaskRow
                  task={t}
                  isSelected={selectedId === t.id}
                  onSelect={select}
                  onToggleDone={(id, next) => void update(id, { status: next })}
                />
              </DraggableRow>
            )}
          />
        </DropColumn>
      ))}
    </div>
  );
};
