/**
 * VaultEntryList — grouped list of vault entries (V0 skeleton).
 *
 * Groups entries by `kind` bucket with Unsorted pinned to the top.
 */

import { useMemo, type FC } from 'react';
import type { EntryKind } from '@/lib/tauri/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { VaultEntryCard } from './VaultEntryCard';

const BUCKET_ORDER: EntryKind[] = [
  'unsorted',
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
    const map = new Map<EntryKind, typeof entries extends Map<string, infer V> ? V[] : never>();
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

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ kind, label, items }) => (
        <section key={kind} className="flex flex-col gap-1.5">
          <div className="px-1 flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground/70">
              {label}
            </span>
            <span className="text-[9px] text-muted-foreground/40">
              {items.length}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {items.map((entry) => (
              <VaultEntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};
