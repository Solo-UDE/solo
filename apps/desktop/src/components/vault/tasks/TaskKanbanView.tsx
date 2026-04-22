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
