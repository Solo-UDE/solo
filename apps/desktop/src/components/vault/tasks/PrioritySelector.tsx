import { useState, type FC } from 'react';
import { Check } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { TaskPriority } from '@/bindings/TaskPriority';
import {
  PriorityIcon,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  PRIORITY_CLASSNAME,
} from './icons/PriorityIcon';

interface Props {
  value: TaskPriority;
  onChange: (next: TaskPriority) => void;
  compact?: boolean;
  disabled?: boolean;
}

/**
 * Linear-style priority selector. Companion to `StatusSelector` — same
 * popover + filterable list composition, keyed to `TaskPriority`.
 */
export const PrioritySelector: FC<Props> = ({
  value,
  onChange,
  compact = false,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = query
    ? PRIORITY_ORDER.filter((p) => PRIORITY_LABEL[p].toLowerCase().includes(query.toLowerCase()))
    : PRIORITY_ORDER;

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
            PRIORITY_CLASSNAME[value],
            disabled && 'opacity-50 cursor-not-allowed',
          )}
          aria-label={`Priority: ${PRIORITY_LABEL[value]}`}
        >
          <PriorityIcon priority={value} size={14} />
          {!compact && <span className="text-foreground">{PRIORITY_LABEL[value]}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-1" align="start">
        <div className="mb-1 px-1.5 pt-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Change priority..."
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex flex-col">
          {filtered.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onChange(p);
                setOpen(false);
                setQuery('');
              }}
              className={cn(
                'flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12px] text-left',
                'hover:bg-muted/70',
                PRIORITY_CLASSNAME[p],
              )}
            >
              <PriorityIcon priority={p} size={14} />
              <span className="flex-1 text-foreground">{PRIORITY_LABEL[p]}</span>
              {p === value && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
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
