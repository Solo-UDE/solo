import { useMemo, useState, type FC, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import { useLabelStore } from '@/stores/labelStore';
import { useProjectStore } from '@/stores/projectStore';
import { useCycleStore } from '@/stores/cycleStore';
import { TaskRow } from './TaskRow';
import { groupTasks, type GroupKey } from './groupings';
import { StatusIcon } from './icons/StatusIcon';
import { PriorityIcon, PRIORITY_CLASSNAME } from './icons/PriorityIcon';
import { VirtualList } from '@/components/ui/virtual-list';
import type { TaskStatus } from '@/bindings/TaskStatus';
import type { TaskPriority } from '@/bindings/TaskPriority';
import type { Task } from '@/lib/tauri/tasks';

interface Props {
  readonly grouping: GroupKey;
}

const STATUS_IDS: TaskStatus[] = ['suggested', 'queued', 'running', 'needs_review', 'done', 'failed', 'archived'];
const PRIORITY_IDS: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];

type TaskListRow =
  | { kind: 'group'; id: string; label: string; count: number }
  | { kind: 'task'; id: string; task: Task };

function headerGlyph(groupingKey: GroupKey, groupId: string): ReactNode {
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

export const TaskListView: FC<Props> = ({ grouping }) => {
  // Select the stable Map reference (not a derived array) to avoid infinite
  // re-renders from Zustand's snapshot `===` check.
  const tasksMap = useTaskStore((s) => s.tasks);
  const selectedId = useTaskStore((s) => s.selectedTaskId);
  const select = useTaskStore((s) => s.select);
  const update = useTaskStore((s) => s.update);

  const labels = useLabelStore((s) => s.labels);
  const projects = useProjectStore((s) => s.projects);
  const cycles = useCycleStore((s) => s.cycles);
  const tasks = useMemo(() => Array.from(tasksMap.values()), [tasksMap]);
  const groups = useMemo(
    () => groupTasks(tasks, grouping, { labels, projects, cycles }),
    [tasks, grouping, labels, projects, cycles],
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  if (tasks.length === 0) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-muted-foreground">
        No tasks yet. Click "+ New task" to create one.
      </div>
    );
  }

  const rows: TaskListRow[] = [];
  for (const group of groups) {
    rows.push({ kind: 'group', id: group.id, label: group.label, count: group.tasks.length });
    if (!collapsed.has(group.id)) {
      for (const task of group.tasks) {
        rows.push({ kind: 'task', id: task.id, task });
      }
    }
  }

  return (
    <VirtualList
      items={rows}
      estimateSize={() => 54}
      overscan={12}
      className="h-full p-3"
      getItemKey={(row) => `${row.kind}:${row.id}`}
      testId="task-list-view"
      renderItem={(row) => {
        if (row.kind === 'group') {
          const isCollapsed = collapsed.has(row.id);
          const glyph = headerGlyph(grouping, row.id);
          return (
            <button
              type="button"
              onClick={() => toggle(row.id)}
              className="mb-1.5 flex w-full items-center gap-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <ChevronRight
                className={cn('h-3 w-3 transition-transform', !isCollapsed && 'rotate-90')}
              />
              {glyph}
              <span>{row.label}</span>
              <span className="ml-auto rounded-full bg-muted/50 px-1.5 text-[10px] font-semibold normal-case tracking-normal text-muted-foreground">
                {row.count}
              </span>
            </button>
          );
        }

        return (
          <div className="pb-0.5">
            <TaskRow
              task={row.task}
              isSelected={selectedId === row.task.id}
              onSelect={select}
              onToggleDone={(id, next) => void update(id, { status: next })}
            />
          </div>
        );
      }}
    />
  );
};
