/**
 * VaultUnsortedTray — review surface for entries the classifier couldn't
 * confidently place (`kind === 'unsorted'`).
 *
 * Design notes:
 *  - Rendered above the main entry list when there are unsorted items.
 *  - Collapsible so it doesn't dominate the panel on first open.
 *  - Each row exposes a "Move to…" popover with every `EntryKind` so the
 *    user teaches the vault where this file actually belongs.
 *  - Backed by the existing `vault_move_bucket` command — no new IPC.
 */

import { useMemo, useState, type FC } from 'react';
import {
  CaretRight,
  FileText,
  Code,
  Image as ImageIcon,
  PaintBrush,
  Database,
  GearSix,
  Globe,
  NotePencil,
  MusicNote,
  Archive,
  File,
  Check,
} from '@phosphor-icons/react';
import type { EntryKind, VaultEntry } from '@/lib/tauri/vault';
import { vaultMoveBucket } from '@/lib/tauri/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { cn } from '@/lib/utils';

/**
 * Icon + label map for every non-Unsorted kind. `snippet` and `keyvalue`
 * exist in the enum but are unusual targets for a manual move, so we still
 * include them (at the bottom of the popover) for completeness.
 */
const KIND_META: Array<{
  kind: EntryKind;
  label: string;
  Icon: FC<{ className?: string; weight?: 'fill' | 'regular' }>;
}> = [
  { kind: 'document', label: 'Document', Icon: FileText },
  { kind: 'code', label: 'Code', Icon: Code },
  { kind: 'image', label: 'Image', Icon: ImageIcon },
  { kind: 'design', label: 'Design', Icon: PaintBrush },
  { kind: 'data', label: 'Data', Icon: Database },
  { kind: 'config', label: 'Config', Icon: GearSix },
  { kind: 'web', label: 'Web', Icon: Globe },
  { kind: 'note', label: 'Note', Icon: NotePencil },
  { kind: 'audio', label: 'Audio', Icon: MusicNote },
  { kind: 'archive', label: 'Archive', Icon: Archive },
  { kind: 'snippet', label: 'Snippet', Icon: Code },
  { kind: 'keyvalue', label: 'Key/Value', Icon: Database },
];

export const VaultUnsortedTray: FC = () => {
  const entries = useVaultStore((s) => s.entries);
  const [expanded, setExpanded] = useState<boolean>(true);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);

  const unsorted = useMemo(() => {
    // Map preserves insertion order; convert + filter + sort-by-updated-desc.
    // `updated_at` is a ts-rs `u64` which arrives as bigint — coerce to
    // number for arithmetic. Precision loss beyond 2^53 seconds is a
    // non-issue (that's 285M years from the Unix epoch).
    return Array.from(entries.values())
      .filter((e) => e.kind === 'unsorted')
      .sort((a, b) => Number(b.updated_at) - Number(a.updated_at));
  }, [entries]);

  if (unsorted.length === 0) return null;

  return (
    <div className="rounded-[12px] bg-amber-500/[0.06] ring-1 ring-inset ring-amber-500/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-amber-500/[0.04] rounded-t-[12px] transition-colors duration-150"
      >
        <CaretRight
          className={cn(
            'w-3 h-3 text-amber-600/80 transition-transform duration-200',
            expanded && 'rotate-90',
          )}
        />
        <span className="text-[11px] font-medium text-amber-900 dark:text-amber-200">
          Needs review
        </span>
        <span className="text-[10px] text-amber-700/80 dark:text-amber-300/80">
          {unsorted.length}
        </span>
        <span className="ml-auto text-[9px] text-muted-foreground/60">
          Help the classifier learn
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-0.5 px-1 pb-1">
          {unsorted.map((entry) => (
            <UnsortedRow
              key={entry.id}
              entry={entry}
              menuOpen={openMenuFor === entry.id}
              onToggleMenu={() =>
                setOpenMenuFor((curr) => (curr === entry.id ? null : entry.id))
              }
              onMoved={() => setOpenMenuFor(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface RowProps {
  entry: VaultEntry;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onMoved: () => void;
}

const UnsortedRow: FC<RowProps> = ({ entry, menuOpen, onToggleMenu, onMoved }) => {
  const upsertEntry = useVaultStore((s) => s.upsertEntry);
  const fetchUnsortedCount = useVaultStore((s) => s.fetchUnsortedCount);
  const [busy, setBusy] = useState(false);

  const hint = entry.subkind || entry.mime || 'unknown type';

  const moveTo = async (kind: EntryKind) => {
    setBusy(true);
    try {
      const updated = await vaultMoveBucket(entry.id, kind);
      if (updated) upsertEntry(updated);
      await fetchUnsortedCount();
      onMoved();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vault] move bucket failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <div
        className={cn(
          'group flex items-center gap-2 h-9 px-2 rounded-lg transition-all duration-150',
          'hover:bg-amber-500/[0.08]',
          busy && 'opacity-60',
        )}
      >
        <File className="w-3.5 h-3.5 text-amber-700/60 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium truncate">{entry.title}</div>
          <div className="text-[9px] text-muted-foreground/60 truncate">{hint}</div>
        </div>
        <button
          type="button"
          onClick={onToggleMenu}
          disabled={busy}
          className={cn(
            'h-6 px-2 rounded-md text-[10px] font-medium transition-all duration-150 active:scale-[0.97]',
            'bg-amber-500/10 text-amber-900 dark:text-amber-200 hover:bg-amber-500/20',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          Move to…
        </button>
      </div>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={onToggleMenu}
            aria-hidden="true"
          />
          <div
            className="absolute right-2 top-9 z-20 w-44 rounded-[10px] bg-card shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)] ring-1 ring-border/40 overflow-hidden"
            role="menu"
          >
            <div className="max-h-[280px] overflow-y-auto py-1">
              {KIND_META.map(({ kind, label, Icon }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => void moveTo(kind)}
                  disabled={busy}
                  className="w-full px-2.5 py-1.5 flex items-center gap-2 text-[11px] hover:bg-muted/60 disabled:opacity-50 transition-colors duration-150 text-left"
                  role="menuitem"
                >
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="flex-1">{label}</span>
                  {busy && <Check className="w-3 h-3 text-muted-foreground/50" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
