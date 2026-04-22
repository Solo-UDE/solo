import { useMemo, useState, type FC, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import { useLabelStore } from '@/stores/labelStore';
import { useProjectStore } from '@/stores/projectStore';
import { useCycleStore } from '@/stores/cycleStore';
import { TaskRow } from './TaskRow';
import { groupTasks, type GroupKey } from './groupings';
import { StatusIcon } from './icons/StatusIcon';
import { PriorityIcon, PRIORITY_CLASSNAME } from './icons/PriorityIcon';
import type { TaskStatus } from '@/bindings/TaskStatus';
import type { TaskPriority } from '@/bindings/TaskPriority';

interface Props {
  readonly grouping: GroupKey;
}

const STATUS_IDS: TaskStatus[] = ['suggested', 'queued', 'running', 'needs_review', 'done', 'failed', 'archived'];
const PRIORITY_IDS: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];

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

  return (
    <div className="flex flex-col gap-4 p-3">
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.id);
        const glyph = headerGlyph(grouping, g.id);
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
              {glyph}
              <span>{g.label}</span>
              <span className="ml-auto rounded-full bg-muted/50 px-1.5 text-[10px] font-semibold normal-case tracking-normal text-muted-foreground">
                {g.tasks.length}
              </span>
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
