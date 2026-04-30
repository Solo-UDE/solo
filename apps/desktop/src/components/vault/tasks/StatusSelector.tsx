import { useState, type FC } from 'react';
import { Check } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '@/bindings/TaskStatus';
import { StatusIcon, STATUS_LABEL, STATUS_ORDER } from './icons/StatusIcon';

interface Props {
  value: TaskStatus;
  onChange: (next: TaskStatus) => void;
  /** Omit values you don't want to expose (e.g. planner-internal `suggested`). */
  exclude?: TaskStatus[];
  /** Render as bare icon with no label — for row/card use. */
  compact?: boolean;
  disabled?: boolean;
}

/**
 * Linear-style status selector: icon trigger + popover with filterable list.
 * Port of Circle's `issues/status-selector.tsx` composition, built on Solo's
 * local Popover primitive + Tailwind.
 */
export const StatusSelector: FC<Props> = ({
  value,
  onChange,
  exclude = [],
  compact = false,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const options = STATUS_ORDER.filter((s) => !exclude.includes(s));
  const filtered = query
    ? options.filter((s) => STATUS_LABEL[s].toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md text-[12px] transition-colors',
            compact
              ? 'h-6 w-6 justify-center p-0 hover:bg-muted/60'
              : 'h-7 px-2 hover:bg-muted/60 border border-border/40 bg-muted/30',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
          aria-label={`Status: ${STATUS_LABEL[value]}`}
        >
          <StatusIcon status={value} />
          {!compact && <span className="text-foreground">{STATUS_LABEL[value]}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-1" align="start">
        <div className="mb-1 px-1.5 pt-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Change status..."
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex flex-col">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onChange(s);
                setOpen(false);
                setQuery('');
              }}
              className={cn(
                'flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12px] text-left',
                'hover:bg-muted/70',
              )}
            >
              <StatusIcon status={s} />
              <span className="flex-1">{STATUS_LABEL[s]}</span>
              {s === value && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-1.5 py-2 text-center text-[11px] text-muted-foreground">
              No matches
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
