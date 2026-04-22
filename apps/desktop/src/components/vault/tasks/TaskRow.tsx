import type { FC, ComponentType } from 'react';
import { Bot, User, Circle, CircleDot, CheckCircle2, XCircle, Archive, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus, TaskPriority, Executor } from '@/lib/tauri/tasks';
import { useTaskStore } from '@/stores/taskStore';

interface Props {
  readonly task: Task;
  readonly isSelected: boolean;
  readonly onSelect: (id: string) => void;
  readonly onToggleDone: (id: string, next: TaskStatus) => void;
}

const STATUS_ICON: Record<TaskStatus, ComponentType<{ className?: string }>> = {
  suggested:    Circle,
  queued:       Circle,
  running:      CircleDot,
  needs_review: CircleDot,
  done:         CheckCircle2,
  failed:       XCircle,
  archived:     Archive,
};

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  urgent: 'text-red-500   border-red-500/30   bg-red-500/10',
  high:   'text-amber-500 border-amber-500/30 bg-amber-500/10',
  medium: 'text-sky-500   border-sky-500/30   bg-sky-500/10',
  low:    'text-muted-foreground border-border/50 bg-muted/40',
};

export const TaskRow: FC<Props> = ({ task, isSelected, onSelect, onToggleDone }) => {
  const StatusIcon = STATUS_ICON[task.status];
  const isDone = task.status === 'done';
  const isRunning = useTaskStore((s) => s.runningTasks.has(task.id));
  const accept = useTaskStore((s) => s.acceptDraft);
  const dismiss = useTaskStore((s) => s.dismissDraft);
  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      aria-selected={isSelected}
      className={cn(
        'group flex w-full items-center gap-3 rounded-[10px] border border-transparent px-3 py-2 text-left transition-all duration-200',
        'hover:bg-muted/50',
        isSelected && 'border-border/40 bg-card shadow-[0_4px_12px_-8px_rgba(0,0,0,0.25)]',
      )}
    >
      {/* status / tick or accept-dismiss for suggested */}
      {task.status === 'suggested' ? (
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void accept(task.id); }}
            className="grid h-5 w-5 place-items-center rounded-full border border-green-500/30 bg-green-500/10 text-green-600 hover:bg-green-500/20"
            aria-label="Accept draft"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void dismiss(task.id); }}
            className="grid h-5 w-5 place-items-center rounded-full border border-border/50 text-muted-foreground hover:bg-muted/50"
            aria-label="Dismiss draft"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <span
          role="checkbox"
          aria-checked={isDone}
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone(task.id, isDone ? 'queued' : 'done');
          }}
          className={cn(
            'grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground',
            'hover:text-foreground',
            isDone && 'text-green-500',
          )}
        >
          <StatusIcon className="h-4 w-4" />
        </span>
      )}

      {/* title + description preview */}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[13px] font-medium', isDone && 'text-muted-foreground line-through')}>
          {task.title}
        </span>
        {task.description && (
          <span className="block truncate text-[11px] text-muted-foreground">
            {firstLine(task.description)}
          </span>
        )}
      </span>

      {/* priority pill */}
      <span className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
        PRIORITY_STYLE[task.priority],
      )}>
        {task.priority}
      </span>

      {/* pulsing running indicator */}
      {isRunning && (
        <span className="grid h-2 w-2 shrink-0 place-items-center" aria-label="Running">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
        </span>
      )}

      {/* executor glyph */}
      <ExecutorGlyph executor={task.executor} />

      <span className="shrink-0 w-20 text-right text-[10px] tabular-nums text-muted-foreground">
        {relativeTime(task.updated_at)}
      </span>
    </button>
  );
};

const ExecutorGlyph: FC<{ executor: Executor }> = ({ executor }) => (
  <span
    aria-label={executor === 'agent' ? 'Agent executor' : 'Manual executor'}
    className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted/60 text-muted-foreground"
  >
    {executor === 'agent' ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
  </span>
);

function firstLine(s: string): string {
  const idx = s.indexOf('\n');
  return idx === -1 ? s : s.slice(0, idx);
}

function relativeTime(ms: number | bigint): string {
  const diff = Number(Date.now()) - Number(ms);
  const sec = Math.max(1, Math.floor(diff / 1000));
  if (sec < 60)      return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60)      return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24)       return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}
