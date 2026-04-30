import type { FC } from 'react';
import { Search, Plus, Sparkles, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import { GroupByMenu } from './GroupByMenu';
import type { GroupKey } from './groupings';
import { ViewToggle, type ViewKind } from './ViewToggle';

interface Props {
  readonly grouping: GroupKey;
  readonly onGroupingChange: (k: GroupKey) => void;
  readonly view: ViewKind;
  readonly onViewChange: (v: ViewKind) => void;
  readonly onNewTask: () => void;
  readonly onNewPlan: () => void;
  readonly onOpenSettings: () => void;
}

export const FiltersBar: FC<Props> = ({
  grouping,
  onGroupingChange,
  view,
  onViewChange,
  onNewTask,
  onNewPlan,
  onOpenSettings,
}) => {
  const searchQuery = useTaskStore((s) => s.searchQuery);
  const setSearchQuery = useTaskStore((s) => s.setSearchQuery);

  return (
    <div className="flex items-center gap-3 border-b border-border/40 px-3 py-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tasks…"
          className={cn(
            'h-8 w-full rounded-[10px] border border-border/40 bg-muted/40 pl-8 pr-2 text-[12px]',
            'placeholder:text-muted-foreground/50 focus:bg-muted/60 focus:outline-none',
            'focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none',
            'transition-all duration-200',
          )}
        />
      </div>
      <ViewToggle value={view} onChange={onViewChange} />
      <GroupByMenu value={grouping} onChange={onGroupingChange} />
      <button
        type="button"
        onClick={onNewPlan}
        className={cn(
          'flex h-8 items-center gap-1 rounded-[10px] border border-border/40 bg-card px-2.5 text-[12px] font-medium',
          'text-foreground hover:bg-muted/60 active:scale-[0.97] transition-all duration-200',
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        New Plan
      </button>
      <button
        type="button"
        onClick={onNewTask}
        className={cn(
          'flex h-8 items-center gap-1 rounded-[10px] border border-border/40 bg-card px-2.5 text-[12px] font-medium',
          'text-foreground hover:bg-muted/60 active:scale-[0.97] transition-all duration-200',
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
        className="grid h-8 w-8 place-items-center rounded-[10px] text-muted-foreground hover:bg-muted/60 transition-all duration-200"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
