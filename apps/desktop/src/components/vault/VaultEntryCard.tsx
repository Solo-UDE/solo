/**
 * VaultEntryCard — compact row for a single vault entry.
 */

import type { FC } from 'react';
import {
  Pushpin,
  PushpinSimpleSlash,
  CloudCheck,
  CloudArrowUp,
  CloudSlash,
  WarningCircle,
} from '@phosphor-icons/react';
import type { VaultEntry, CloudSyncState } from '@/lib/tauri/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { cn } from '@/lib/utils';

interface Props {
  entry: VaultEntry;
}

const SYNC_ICON: Record<CloudSyncState, FC<{ className?: string }>> = {
  offline: CloudSlash,
  pending: CloudArrowUp,
  uploading: CloudArrowUp,
  indexing_remote: CloudArrowUp,
  synced: CloudCheck,
  failed: WarningCircle,
};

const SYNC_TONE: Record<CloudSyncState, string> = {
  offline: 'text-muted-foreground/40',
  pending: 'text-muted-foreground/60',
  uploading: 'text-primary/70',
  indexing_remote: 'text-primary/70',
  synced: 'text-primary',
  failed: 'text-destructive',
};

export const VaultEntryCard: FC<Props> = ({ entry }) => {
  const togglePinned = useVaultStore((s) => s.togglePinned);
  const SyncIcon = SYNC_ICON[entry.cloud_sync_state];

  return (
    <div
      className={cn(
        'group flex items-center gap-2 h-9 px-2 rounded-lg transition-all duration-150',
        'hover:bg-muted/60 hover:scale-[1.01]',
        entry.pinned && 'bg-primary/5',
      )}
    >
      <button
        type="button"
        onClick={() => void togglePinned(entry.id)}
        className={cn(
          'w-5 h-5 rounded-md flex items-center justify-center transition-all duration-150',
          entry.pinned
            ? 'text-primary hover:bg-primary/10'
            : 'text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:bg-muted/80 hover:text-foreground',
        )}
        title={entry.pinned ? 'Unpin' : 'Pin as source of truth'}
      >
        {entry.pinned ? (
          <Pushpin className="w-3 h-3" weight="fill" />
        ) : (
          <PushpinSimpleSlash className="w-3 h-3" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium truncate">{entry.title}</div>
        {entry.tags.length > 0 && (
          <div className="text-[9px] text-muted-foreground/60 truncate">
            {entry.tags.join(' · ')}
          </div>
        )}
      </div>

      <SyncIcon className={cn('w-3.5 h-3.5 shrink-0', SYNC_TONE[entry.cloud_sync_state])} />
    </div>
  );
};
