import type { FC } from 'react';
import { Search, Plus, Sparkles, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import { GroupByMenu } from './GroupByMenu';
import type { GroupKey } from './groupings';

interface Props {
  readonly grouping: GroupKey;
  readonly onGroupingChange: (k: GroupKey) => void;
  readonly onNewTask: () => void;
  readonly onNewPlan: () => void;
  readonly onOpenSettings: () => void;
}

export const FiltersBar: FC<Props> = ({
  grouping,
  onGroupingChange,
  onNewTask,
  onNewPlan,
  onOpenSettings,
}) => {
  const searchQuery = useTaskStore((s) => s.searchQuery);
  const setSearchQuery = useTaskStore((s) => s.setSearchQuery);

  return (
    <div className="flex items-center gap-3 border-b border-border/50 px-3 py-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tasks…"
          className={cn(
            'w-full rounded-md border border-border/60 bg-background pl-8 pr-2 py-1.5 text-[12px]',
            'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border',
          )}
        />
      </div>
      <GroupByMenu value={grouping} onChange={onGroupingChange} />
      <button
        type="button"
        onClick={onNewPlan}
        className={cn(
          'flex items-center gap-1 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-[12px] font-medium',
          'text-foreground hover:bg-muted/60',
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        New Plan
      </button>
      <button
        type="button"
        onClick={onNewTask}
        className={cn(
          'flex items-center gap-1 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-[12px] font-medium',
          'text-foreground hover:bg-muted/60',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        New task
      </button>
      <button
        type="button"
        onClick={onOpenSettings}
        title="Tasks settings"
        aria-label="Tasks settings"
        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted/50"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
