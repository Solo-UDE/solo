import { type FC, type KeyboardEvent } from 'react';
import { Bot, User, Check, X, Play, Trash2, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus, Executor } from '@/lib/tauri/tasks';
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
import { StatusIcon, STATUS_LABEL, STATUS_ORDER } from './icons/StatusIcon';
import { PriorityIcon, PRIORITY_LABEL, PRIORITY_ORDER, PRIORITY_CLASSNAME } from './icons/PriorityIcon';
import { LabelBadge } from './LabelBadge';
import { useLabelStore } from '@/stores/labelStore';
import { useProjectStore } from '@/stores/projectStore';

interface Props {
  readonly task: Task;
  readonly isSelected: boolean;
  readonly onSelect: (id: string) => void;
  readonly onToggleDone: (id: string, next: TaskStatus) => void;
}

export const TaskRow: FC<Props> = ({ task, isSelected, onSelect, onToggleDone }) => {
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

  const completedSubs = task.subtasks.filter((s) => s.completed).length;
  const totalSubs = task.subtasks.length;

  const labels = useLabelStore((s) => s.labels);
  const projects = useProjectStore((s) => s.projects);
  // Show up to 2 labels inline; the rest surface as "+N".
  const visibleLabels = task.label_ids.slice(0, 2).map((id) => labels.get(id)).filter(Boolean);
  const overflowLabels = Math.max(0, task.label_ids.length - visibleLabels.length);
  const project = task.project_id ? projects.get(task.project_id) : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/*
         * Root is a <div role="button"> (not <button>) — WebKit intercepts
         * mousedown on <button> before pragmatic-drag-and-drop can see it.
         * Keyboard a11y preserved via tabIndex + onKeyDown.
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
          {/* Status glyph. Suggested-drafts get Accept/Dismiss inline. */}
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
              title={STATUS_LABEL[task.status]}
              onClick={(e) => {
                e.stopPropagation();
                onToggleDone(task.id, isDone ? 'queued' : 'done');
              }}
              className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full"
            >
              <StatusIcon status={task.status} size={14} />
            </span>
          )}

          {/* Title */}
          <span className={cn(
            'min-w-0 flex-1 truncate text-[13px] font-medium',
            isDone && 'text-muted-foreground line-through',
          )}>
            {task.title}
          </span>

          {/* Project badge */}
          {project && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-[10.5px] text-foreground"
              title={`Project: ${project.name}`}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              <span className="max-w-[80px] truncate">{project.name}</span>
            </span>
          )}

          {/* Label badges */}
          {visibleLabels.map((l) => l && (
            <LabelBadge key={l.id} label={l} className="shrink-0" />
          ))}
          {overflowLabels > 0 && (
            <span className="shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              +{overflowLabels}
            </span>
          )}

          {/* Subtask progress */}
          {totalSubs > 0 && (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-[10.5px] tabular-nums text-muted-foreground',
                completedSubs === totalSubs && 'text-green-600',
              )}
              title={`${completedSubs} of ${totalSubs} subtasks completed`}
            >
              <ListChecks className="h-3 w-3" />
              {completedSubs}/{totalSubs}
            </span>
          )}

          {/* Priority icon */}
          <span
            title={PRIORITY_LABEL[task.priority]}
            className={cn('shrink-0', PRIORITY_CLASSNAME[task.priority])}
          >
            <PriorityIcon priority={task.priority} size={14} />
          </span>

          {/* Pulsing running indicator */}
          {isRunning && (
            <span className="grid h-2 w-2 shrink-0 place-items-center" aria-label="Running">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            </span>
          )}

          <ExecutorGlyph executor={task.executor} />

          <span className="shrink-0 w-16 text-right text-[10px] tabular-nums text-muted-foreground">
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
            <span className="mr-2 inline-grid h-3.5 w-3.5 place-items-center">
              <StatusIcon status={task.status} size={12} />
            </span>
            Change status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {STATUS_ORDER.filter((s) => s !== 'suggested').map((s) => (
              <ContextMenuItem
                key={s}
                disabled={s === task.status}
                onSelect={() => void update(task.id, { status: s })}
              >
                <span className="mr-2 inline-grid h-3.5 w-3.5 place-items-center">
                  <StatusIcon status={s} size={12} />
                </span>
                {STATUS_LABEL[s]}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <span className="mr-2 inline-grid h-3.5 w-3.5 place-items-center">
              <PriorityIcon priority={task.priority} size={12} />
            </span>
            Change priority
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {PRIORITY_ORDER.map((p) => (
              <ContextMenuItem
                key={p}
                disabled={p === task.priority}
                onSelect={() => void update(task.id, { priority: p })}
              >
                <span className="mr-2 inline-grid h-3.5 w-3.5 place-items-center">
                  <PriorityIcon priority={p} size={12} />
                </span>
                {PRIORITY_LABEL[p]}
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
