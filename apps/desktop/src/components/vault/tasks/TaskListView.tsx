import { useMemo, useState, type FC } from 'react';
import { ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import { TaskRow } from './TaskRow';
import { groupTasks, type GroupKey } from './groupings';

interface Props {
  readonly grouping: GroupKey;
}

export const TaskListView: FC<Props> = ({ grouping }) => {
  // Select the stable Map reference (not a derived array) to avoid infinite
  // re-renders from Zustand's snapshot `===` check.
  const tasksMap = useTaskStore((s) => s.tasks);
  const selectedId = useTaskStore((s) => s.selectedTaskId);
  const select = useTaskStore((s) => s.select);
  const update = useTaskStore((s) => s.update);

  const tasks = useMemo(() => Array.from(tasksMap.values()), [tasksMap]);
  const groups = useMemo(() => groupTasks(tasks, grouping), [tasks, grouping]);

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

  return (
    <div className="flex flex-col gap-4 p-3">
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.id);
        return (
          <section key={g.id}>
            <button
              type="button"
              onClick={() => toggle(g.id)}
              className="mb-1.5 flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <ChevronRight
                className={cn('h-3 w-3 transition-transform', !isCollapsed && 'rotate-90')}
              />
              <span>{g.label}</span>
              <span className="text-muted-foreground/70">· {g.tasks.length}</span>
            </button>
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.ul
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col gap-0.5 overflow-hidden"
                >
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
                </motion.ul>
              )}
            </AnimatePresence>
          </section>
        );
      })}
    </div>
  );
};
