import { useEffect, useMemo, useState, type FC } from 'react';
import { Check, Plus, Tag, Trash2 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useLabelStore } from '@/stores/labelStore';

const DEFAULT_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#0ea5e9', '#6366f1', '#a855f7', '#ec4899',
];

interface Props {
  /** Currently-selected label ids for the task being edited. */
  selected: readonly string[];
  onAdd: (labelId: string) => void | Promise<void>;
  onRemove: (labelId: string) => void | Promise<void>;
  /** Compact: shows only the icon trigger (for cards/rows). */
  compact?: boolean;
}

/**
 * Popover lets the user toggle labels on a task and create new labels inline.
 * Clicking a label in the list toggles its membership; the +Create row
 * appears when the query doesn't match any existing label.
 */
export const LabelSelector: FC<Props> = ({ selected, onAdd, onRemove, compact = false }) => {
  const labels = useLabelStore((s) => s.labels);
  const load = useLabelStore((s) => s.load);
  const create = useLabelStore((s) => s.create);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => { if (open) void load(); }, [open, load]);

  const allLabels = useMemo(() => Array.from(labels.values()), [labels]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? allLabels.filter((l) => l.name.toLowerCase().includes(q))
    : allLabels;
  const noMatchAllowsCreate = q.length > 0 && !allLabels.some(
    (l) => l.name.toLowerCase() === q,
  );

  const handleToggle = async (id: string) => {
    if (selectedSet.has(id)) await onRemove(id);
    else await onAdd(id);
  };

  const handleCreate = async () => {
    const name = query.trim();
    if (!name) return;
    const color = DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];
    const label = await create({ name, color });
    await onAdd(label.id);
    setQuery('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md text-[12px] transition-colors text-muted-foreground',
            compact
              ? 'h-6 w-6 justify-center p-0 hover:bg-muted/60'
              : 'h-7 px-2 hover:bg-muted/60 border border-border/40 bg-muted/30',
          )}
          aria-label="Labels"
        >
          <Tag className="h-3.5 w-3.5" />
          {!compact && <span>Labels{selected.length > 0 && ` · ${selected.length}`}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-1" align="start">
        <div className="mb-1 px-1.5 pt-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter or create label…"
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex max-h-[260px] flex-col overflow-y-auto">
          {filtered.map((l) => {
            const isSelected = selectedSet.has(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => void handleToggle(l.id)}
                className="group flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-[12px] hover:bg-muted/70"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                <span className="flex-1 truncate">{l.name}</span>
                {isSelected && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            );
          })}
          {filtered.length === 0 && !noMatchAllowsCreate && (
            <div className="px-1.5 py-2 text-center text-[11px] text-muted-foreground">
              No labels yet
            </div>
          )}
          {noMatchAllowsCreate && (
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-[12px] hover:bg-muted/70"
            >
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 truncate">
                Create "<strong className="font-semibold">{query.trim()}</strong>"
              </span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/**
 * Companion trash-icon action for the label management modal. Omitted from
 * LabelSelector's popover because the pattern there is "attach/detach", not
 * "delete label from catalog." Exported here for the optional manager UI.
 */
export const LabelDeleteButton: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label="Delete label"
    className="grid h-5 w-5 place-items-center rounded-sm text-muted-foreground/50 hover:text-red-500"
  >
    <Trash2 className="h-3 w-3" />
  </button>
);
