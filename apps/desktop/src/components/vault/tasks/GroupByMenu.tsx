import { useState, type FC } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { GroupKey } from './groupings';
import { GROUPING_LABELS } from './groupings';

interface Props {
  readonly value: GroupKey;
  readonly onChange: (k: GroupKey) => void;
}

const OPTIONS: GroupKey[] = [
  'status',
  'priority',
  'executor',
  'cadence',
  'context_anchor',
  'agent_fingerprint',
  'last_run_health',
  'none',
];

/**
 * Circle-style grouping picker — popover trigger with the current label,
 * opens a compact list of grouping dimensions.
 */
export const GroupByMenu: FC<Props> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-[10px] border border-border/40 bg-card px-2.5 text-[12px] font-medium',
            'text-foreground hover:bg-muted/60 transition-all duration-200',
          )}
        >
          <span className="text-muted-foreground">Group by</span>
          <span>{GROUPING_LABELS[value]}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-1" align="end">
        <div className="flex flex-col">
          {OPTIONS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                onChange(k);
                setOpen(false);
              }}
              className={cn(
                'flex items-center justify-between rounded-[6px] px-1.5 py-1 text-left text-[12px]',
                'hover:bg-muted/70',
              )}
            >
              <span>{GROUPING_LABELS[k]}</span>
              {k === value && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
