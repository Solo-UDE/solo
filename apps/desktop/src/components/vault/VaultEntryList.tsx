/**
 * VaultEntryList — grouped list of vault entries by `kind` bucket.
 *
 * V1.3: the `unsorted` bucket is handled by a dedicated `VaultUnsortedTray`
 * rendered above this list, so we exclude it here to avoid duplication.
 */

import { useMemo, type FC } from 'react';
import type { EntryKind, VaultEntry } from '@/lib/tauri/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { VirtualList } from '@/components/ui/virtual-list';
import { VaultEntryCard } from './VaultEntryCard';

const BUCKET_ORDER: EntryKind[] = [
  'document',
  'code',
  'snippet',
  'image',
  'design',
  'data',
  'config',
  'note',
  'keyvalue',
  'web',
  'audio',
  'archive',
];

const BUCKET_LABEL: Record<EntryKind, string> = {
  unsorted: 'Unsorted',
  document: 'Docs',
  code: 'Code',
  snippet: 'Snippets',
  image: 'Evidence',
  design: 'Evidence · Design',
  data: 'Data',
  config: 'Configs',
  note: 'Notes',
  keyvalue: 'Key/Value',
  web: 'Web',
  audio: 'Audio',
  archive: 'Archives',
};

export const VaultEntryList: FC = () => {
  const entries = useVaultStore((s) => s.entries);

  const groups = useMemo(() => {
    const map = new Map<EntryKind, VaultEntry[]>();
    for (const entry of entries.values()) {
      const bucket = entry.kind;
      if (!map.has(bucket)) map.set(bucket, []);
      map.get(bucket)!.push(entry);
    }
    return BUCKET_ORDER.filter((k) => map.has(k)).map((k) => ({
      kind: k,
      label: BUCKET_LABEL[k],
      items: map.get(k)!,
    }));
  }, [entries]);

  const rows = useMemo(() => {
    const next: Array<
      | { kind: 'header'; id: string; label: string; count: number }
      | { kind: 'entry'; id: string; entry: VaultEntry }
    > = [];
    for (const group of groups) {
      next.push({
        kind: 'header',
        id: `header:${group.kind}`,
        label: group.label,
        count: group.items.length,
      });
      for (const entry of group.items) {
        next.push({ kind: 'entry', id: entry.id, entry });
      }
    }
    return next;
  }, [groups]);

  return (
    <VirtualList
      items={rows}
      estimateSize={() => 74}
      overscan={10}
      className="min-h-[220px] flex-1"
      getItemKey={(row) => row.id}
      testId="vault-entry-list"
      renderItem={(row) => (
        row.kind === 'header' ? (
          <div className="flex items-center gap-2 px-1 pb-1 pt-2">
            <span className="text-[10px] font-medium text-muted-foreground/70">
              {row.label}
            </span>
            <span className="text-[9px] text-muted-foreground/40">
              {row.count}
            </span>
          </div>
        ) : (
          <div className="pb-1">
            <VaultEntryCard entry={row.entry} />
          </div>
        )
      )}
    />
  );
};
