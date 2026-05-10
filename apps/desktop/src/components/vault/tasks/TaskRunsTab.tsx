import type { FC } from 'react';
import { cn } from '@/lib/utils';
import { VirtualList } from '@/components/ui/virtual-list';
import type { Task, TaskRun } from '@/lib/tauri/tasks';

interface Props {
  readonly task: Task;
}

const OUTCOME_STYLE: Record<TaskRun['outcome'], string> = {
  running:   'bg-blue-500/15   text-blue-500   border-blue-500/30',
  succeeded: 'bg-green-500/15  text-green-500  border-green-500/30',
  failed:    'bg-red-500/15    text-red-500    border-red-500/30',
  cancelled: 'bg-muted/40      text-muted-foreground border-border/50',
};

export const TaskRunsTab: FC<Props> = ({ task }) => {
  if (!task.runs?.length) {
    return (
      <div className="p-4 text-[12px] text-muted-foreground">
        No runs yet. Click <em>Run now</em> to start one.
      </div>
    );
  }
  return (
    <VirtualList
      items={task.runs}
      estimateSize={() => 94}
      overscan={8}
      className="h-full p-3"
      itemClassName="pb-2"
      getItemKey={(run) => run.id}
      testId="task-runs-tab"
      renderItem={(r) => (
        <div className="rounded-md border border-border/50 bg-card p-3">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className={cn(
              'rounded-full border px-2 py-0.5 font-medium uppercase tracking-wider',
              OUTCOME_STYLE[r.outcome],
            )}>
              {r.outcome}
            </span>
            <span className="tabular-nums">
              {fmtTime(r.started_at)}
              {r.ended_at && ` → ${fmtTime(r.ended_at)}`}
            </span>
          </div>
          {r.summary && (
            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[12px] text-foreground">
              {r.summary}
            </p>
          )}
          {r.session_id && (
            <div className="mt-1 text-[10px] text-muted-foreground">
              Session: <code className="rounded bg-muted/40 px-1">{r.session_id}</code>
            </div>
          )}
        </div>
      )}
    />
  );
};

function fmtTime(ms: number | bigint): string {
  const d = new Date(typeof ms === 'bigint' ? Number(ms) : ms);
  return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}
