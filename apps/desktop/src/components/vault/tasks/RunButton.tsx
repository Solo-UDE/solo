import { useState, type FC } from 'react';
import { Play, Square, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Task } from '@/lib/tauri/tasks';

interface Props {
  readonly task: Task;
}

export const RunButton: FC<Props> = ({ task }) => {
  const run = useTaskStore((s) => s.run);
  const cancel = useTaskStore((s) => s.cancel);
  const isRunning = useTaskStore((s) => s.runningTasks.has(task.id));
  const [busy, setBusy] = useState(false);

  if (task.executor !== 'agent') return null;

  const onClick = async () => {
    setBusy(true);
    try {
      if (isRunning) await cancel(task.id);
      else await run(task.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium',
        'border border-border/60 bg-card hover:bg-muted/60 disabled:opacity-50',
        isRunning ? 'text-red-500' : 'text-foreground',
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
       isRunning ? <Square className="h-3.5 w-3.5" /> :
                   <Play className="h-3.5 w-3.5" />}
      <span>{isRunning ? 'Cancel run' : 'Run now'}</span>
    </button>
  );
};
