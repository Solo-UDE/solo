import { type FC, type ComponentType, type KeyboardEvent } from 'react';
import { Bot, User, Circle, CircleDot, CheckCircle2, XCircle, Archive, Check, X, Play, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus, TaskPriority, Executor } from '@/lib/tauri/tasks';
import { useTaskStore } from '@/stores/taskStore';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

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

const STATUS_OPTIONS: TaskStatus[] = ['queued', 'running', 'needs_review', 'done', 'failed', 'archived'];
const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const pretty = (v: string) => v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const TaskRow: FC<Props> = ({ task, isSelected, onSelect, onToggleDone }) => {
  const StatusIcon = STATUS_ICON[task.status];
  const isDone = task.status === 'done';
  const isRunning = useTaskStore((s) => s.runningTasks.has(task.id));
  const accept = useTaskStore((s) => s.acceptDraft);
  const dismiss = useTaskStore((s) => s.dismissDraft);
  const update = useTaskStore((s) => s.update);
  const remove = useTaskStore((s) => s.remove);
  const run = useTaskStore((s) => s.run);
  const cancel = useTaskStore((s) => s.cancel);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(task.id);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/*
         * Root is a <div role="button"> instead of <button> — WebKit intercepts
         * mousedown on <button> before the native-drag system can see it, which
         * was killing pragmatic-drag-and-drop on Tauri. Keyboard a11y preserved
         * via tabIndex + onKeyDown (Enter/Space select).
         */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect(task.id)}
          onKeyDown={onKey}
          aria-selected={isSelected}
          className={cn(
            'group flex h-10 w-full cursor-pointer select-none items-center gap-3 rounded-[10px] border border-transparent px-3 text-left outline-none transition-all duration-200',
            'hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary/20',
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
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onToggleDone(task.id, isDone ? 'queued' : 'done');
              }}
              className={cn(
                'grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground',
                'hover:text-foreground',
                isDone && 'text-green-500',
              )}
            >
              <StatusIcon className="h-4 w-4" />
            </span>
          )}

          {/* title — description intentionally omitted from row so heights stay uniform */}
          <span className={cn(
            'min-w-0 flex-1 truncate text-[13px] font-medium',
            isDone && 'text-muted-foreground line-through',
          )}>
            {task.title}
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
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        {task.executor === 'agent' && (
          <>
            <ContextMenuItem
              onSelect={() => { if (isRunning) void cancel(task.id); else void run(task.id); }}
            >
              <Play className="mr-2 h-3.5 w-3.5" />
              {isRunning ? 'Cancel run' : 'Run now'}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <StatusIcon className="mr-2 h-3.5 w-3.5" />
            Change status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {STATUS_OPTIONS.map((s) => (
              <ContextMenuItem
                key={s}
                disabled={s === task.status}
                onSelect={() => void update(task.id, { status: s })}
              >
                {pretty(s)}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <span className={cn('mr-2 inline-block h-2 w-2 rounded-full', dotFor(task.priority))} />
            Change priority
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {PRIORITY_OPTIONS.map((p) => (
              <ContextMenuItem
                key={p}
                disabled={p === task.priority}
                onSelect={() => void update(task.id, { priority: p })}
              >
                <span className={cn('mr-2 inline-block h-2 w-2 rounded-full', dotFor(p))} />
                {pretty(p)}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onSelect(task.id)}>
          Open details
        </ContextMenuItem>
        <ContextMenuItem
          className="text-red-500 focus:text-red-500"
          onSelect={() => void remove(task.id)}
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete task
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

const dotFor = (p: TaskPriority): string => {
  switch (p) {
    case 'urgent': return 'bg-red-500';
    case 'high':   return 'bg-amber-500';
    case 'medium': return 'bg-sky-500';
    case 'low':    return 'bg-muted-foreground/60';
  }
};

const ExecutorGlyph: FC<{ executor: Executor }> = ({ executor }) => (
  <span
    aria-label={executor === 'agent' ? 'Agent executor' : 'Manual executor'}
    className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted/60 text-muted-foreground"
  >
    {executor === 'agent' ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
  </span>
);

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
