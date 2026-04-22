import { useState, type FC } from 'react';
import { X, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Task, TaskPriority, TaskStatus } from '@/lib/tauri/tasks';
import { SelectDropdown } from '@/components/settings/controls/SelectDropdown';
import { RunButton } from './RunButton';
import { TaskRunsTab } from './TaskRunsTab';
import { AgentConfigTab } from './AgentConfigTab';
import { ScheduleTab } from './ScheduleTab';

const STATUS_OPTIONS: TaskStatus[] = ['queued', 'running', 'needs_review', 'done', 'failed', 'archived'];
const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

const pretty = (v: string) => v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

type DrawerTab = 'overview' | 'runs' | 'agent' | 'schedule';

export const TaskDrawer: FC = () => {
  const taskId = useTaskStore((s) => s.selectedTaskId);
  const task = useTaskStore((s) => (taskId ? s.tasks.get(taskId) : undefined));
  const select = useTaskStore((s) => s.select);
  const update = useTaskStore((s) => s.update);
  const remove = useTaskStore((s) => s.remove);
  const [tab, setTab] = useState<DrawerTab>('overview');

  return (
    <AnimatePresence>
      {task && (
        <motion.aside
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          className={cn(
            'absolute right-0 top-0 z-40 flex h-full w-[480px] flex-col',
            'border-l border-border/60 bg-background shadow-[0_0_40px_-16px_rgba(0,0,0,0.4)]',
          )}
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-3">
            <Detail task={task} />
            <RunButton task={task} />
            <button
              type="button"
              onClick={() => void remove(task.id)}
              aria-label="Delete task"
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-red-500"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => select(null)}
              aria-label="Close drawer"
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted/50"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <nav className="flex shrink-0 gap-1 border-b border-border/50 px-3 py-1.5">
            {(task.executor === 'agent'
              ? (['overview', 'runs', 'agent', 'schedule'] as const)
              : (['overview', 'runs', 'schedule'] as const)
            ).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium capitalize',
                  tab === t ? 'bg-card text-foreground border border-border/70' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t}
                {t === 'runs' && task.runs?.length ? ` · ${task.runs.length}` : ''}
              </button>
            ))}
          </nav>

          {tab === 'overview' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <label className="mb-4 flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Title
                <input
                  value={task.title}
                  onChange={(e) => void update(task.id, { title: e.target.value })}
                  className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-[14px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-border"
                />
              </label>

              <label className="mb-4 flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Description
                <textarea
                  rows={6}
                  value={task.description}
                  onChange={(e) => void update(task.id, { description: e.target.value })}
                  className="resize-y rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-border"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Status
                  <SelectDropdown
                    value={task.status}
                    options={STATUS_OPTIONS.map((s) => ({ label: pretty(s), value: s }))}
                    onChange={(v) => void update(task.id, { status: v })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Priority
                  <SelectDropdown
                    value={task.priority}
                    options={PRIORITY_OPTIONS.map((p) => ({ label: pretty(p), value: p }))}
                    onChange={(v) => void update(task.id, { priority: v })}
                  />
                </label>
              </div>
            </div>
          )}

          {tab === 'runs' && <TaskRunsTab task={task} />}
          {tab === 'agent' && task.executor === 'agent' && <AgentConfigTab task={task} />}
          {tab === 'schedule' && <ScheduleTab task={task} />}
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

const Detail: FC<{ task: Task }> = ({ task }) => (
  <div className="min-w-0 flex-1">
    <div className="truncate text-[13px] font-semibold">{task.title || 'Untitled'}</div>
    <div className="text-[10px] text-muted-foreground">
      {task.executor === 'agent' ? 'Agent · ' : 'Manual · '}{task.status.replace(/_/g, ' ')}
    </div>
  </div>
);
