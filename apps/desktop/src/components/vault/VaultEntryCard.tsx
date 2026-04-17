/**
 * VaultEntryCard — compact row for a single vault entry.
 */

import type { FC } from 'react';
import {
  Pin,
  CloudCheck,
  CloudUpload,
  CloudOff,
  AlertCircle,
} from 'lucide-react';
import type { VaultEntry, CloudSyncState } from '@/lib/tauri/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { cn } from '@/lib/utils';

interface Props {
  entry: VaultEntry;
}

const SYNC_ICON: Record<CloudSyncState, FC<{ className?: string }>> = {
  offline: CloudOff,
  pending: CloudUpload,
  uploading: CloudUpload,
  indexing_remote: CloudUpload,
  synced: CloudCheck,
  failed: AlertCircle,
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
  const setSelectedEntry = useVaultStore((s) => s.setSelectedEntry);
  const SyncIcon = SYNC_ICON[entry.cloud_sync_state];

  return (
    <button
      type="button"
      onClick={() => setSelectedEntry(entry.id)}
      className={cn(
        'group flex items-center gap-2 h-9 px-2 rounded-lg transition-all duration-150 text-left w-full',
        'hover:bg-muted/60 hover:scale-[1.01] active:scale-[0.995]',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40',
        entry.pinned && 'bg-primary/5',
      )}
    >
      <span
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          // Pin toggle is a nested action — don't open the drawer.
          e.stopPropagation();
          void togglePinned(entry.id);
        }}
        className={cn(
          'w-5 h-5 rounded-md flex items-center justify-center transition-all duration-150 cursor-pointer',
          entry.pinned
            ? 'text-primary hover:bg-primary/10'
            : 'text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:bg-muted/80 hover:text-foreground',
        )}
        title={entry.pinned ? 'Unpin' : 'Pin as source of truth'}
      >
        <Pin className={cn('w-3 h-3', entry.pinned && 'fill-current')} />
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium truncate">{entry.title}</div>
        {entry.tags.length > 0 && (
          <div className="text-[9px] text-muted-foreground/60 truncate">
            {entry.tags.join(' · ')}
          </div>
        )}
      </div>

      <SyncIcon className={cn('w-3.5 h-3.5 shrink-0', SYNC_TONE[entry.cloud_sync_state])} />
    </button>
  );
};
