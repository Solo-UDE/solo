import { useEffect, useMemo, useState, type FC } from 'react';
import { Check, FolderKanban, Plus, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import { NewProjectDialog } from './NewProjectDialog';

interface Props {
  value: string | null;
  onChange: (projectId: string | null) => void | Promise<void>;
  compact?: boolean;
}

export const ProjectSelector: FC<Props> = ({ value, onChange, compact = false }) => {
  const projects = useProjectStore((s) => s.projects);
  const load = useProjectStore((s) => s.load);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => { if (open) void load(); }, [open, load]);

  const current = value ? projects.get(value) : null;
  const list = useMemo(() => Array.from(projects.values()), [projects]);
  const q = query.trim().toLowerCase();
  const filtered = q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;

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
          aria-label="Project"
        >
          {current ? (
            <>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: current.color }}
              />
              <span className="truncate text-foreground">{current.name}</span>
            </>
          ) : (
            <>
              <FolderKanban className="h-3.5 w-3.5" />
              {!compact && <span>No project</span>}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-1" align="start">
        <div className="mb-1 px-1.5 pt-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Change project…"
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex max-h-[260px] flex-col overflow-y-auto">
          <button
            type="button"
            onClick={() => { void onChange(null); setOpen(false); }}
            className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-muted/70"
          >
            <X className="h-3.5 w-3.5" />
            <span className="flex-1">No project</span>
            {value === null && <Check className="h-3.5 w-3.5" />}
          </button>
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { void onChange(p.id); setOpen(false); }}
              className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-[12px] hover:bg-muted/70"
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <span className="flex-1 truncate">{p.name}</span>
              {p.id === value && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-1.5 py-2 text-center text-[11px] text-muted-foreground">
              No projects yet
            </div>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); setCreateOpen(true); }}
            className="mt-1 flex items-center gap-2 rounded-[6px] border-t border-border/40 px-1.5 py-1 pt-2 text-left text-[12px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New project…</span>
          </button>
        </div>
      </PopoverContent>
      <NewProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => void onChange(id)}
      />
    </Popover>
  );
};
