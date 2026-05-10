import { useEffect, useMemo, useState, type FC } from 'react';
import { CalendarClock, Check, Plus, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useCycleStore } from '@/stores/cycleStore';
import { NewCycleDialog } from './NewCycleDialog';
import { VirtualList } from '@/components/ui/virtual-list';

interface Props {
  value: string | null;
  onChange: (cycleId: string | null) => void | Promise<void>;
  compact?: boolean;
}

const fmt = (ms: number | bigint): string =>
  new Date(Number(ms)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const CycleSelector: FC<Props> = ({ value, onChange, compact = false }) => {
  const cycles = useCycleStore((s) => s.cycles);
  const load = useCycleStore((s) => s.load);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => { if (open) void load(); }, [open, load]);

  const current = value ? cycles.get(value) : null;
  const list = useMemo(() => Array.from(cycles.values()), [cycles]);
  const q = query.trim().toLowerCase();
  const filtered = q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md text-[12px] transition-colors text-muted-foreground',
            compact
              ? 'h-6 justify-center px-1 hover:bg-muted/60'
              : 'h-7 px-2 hover:bg-muted/60 border border-border/40 bg-muted/30',
          )}
          aria-label="Cycle"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          {current ? (
            <span className="truncate text-foreground">{current.name}</span>
          ) : !compact && (
            <span>No cycle</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-1" align="start">
        <div className="mb-1 px-1.5 pt-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Change cycle…"
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex max-h-[260px] flex-col">
          <button
            type="button"
            onClick={() => { void onChange(null); setOpen(false); }}
            className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-muted/70"
          >
            <X className="h-3.5 w-3.5" />
            <span className="flex-1">No cycle</span>
            {value === null && <Check className="h-3.5 w-3.5" />}
          </button>
          <VirtualList
            items={filtered}
            estimateSize={() => 38}
            overscan={8}
            className="max-h-[210px]"
            getItemKey={(c) => c.id}
            testId="cycle-selector-options"
            renderItem={(c) => (
              <button
                type="button"
                onClick={() => { void onChange(c.id); setOpen(false); }}
                className="flex w-full items-start gap-2 rounded-[6px] px-1.5 py-1 text-left text-[12px] hover:bg-muted/70"
              >
                <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{c.name}</span>
                  <span className="block text-[10px] tabular-nums text-muted-foreground">
                    {fmt(c.start_at)} – {fmt(c.end_at)}
                  </span>
                </span>
                {c.id === value && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            )}
          />
          {filtered.length === 0 && (
            <div className="px-1.5 py-2 text-center text-[11px] text-muted-foreground">
              No cycles yet
            </div>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); setCreateOpen(true); }}
            className="mt-1 flex items-center gap-2 rounded-[6px] border-t border-border/40 px-1.5 py-1 pt-2 text-left text-[12px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New cycle…</span>
          </button>
        </div>
      </PopoverContent>
      <NewCycleDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => void onChange(id)}
      />
    </Popover>
  );
};
