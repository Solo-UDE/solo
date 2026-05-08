/**
 * VaultEntryCard — compact row for a single vault entry.
 */

import { useState, type FC, type KeyboardEvent } from 'react';
import {
  Pin,
  CloudCheck,
  CloudUpload,
  CloudOff,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import type { VaultEntry, CloudSyncState } from '@/lib/tauri/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

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
  const deleteEntry = useVaultStore((s) => s.deleteEntry);
  const syncEntry = useVaultStore((s) => s.syncEntry);
  const fetchUnsortedCount = useVaultStore((s) => s.fetchUnsortedCount);
  const setSelectedEntry = useVaultStore((s) => s.setSelectedEntry);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSyncingEntry, setIsSyncingEntry] = useState(false);
  const SyncIcon = SYNC_ICON[entry.cloud_sync_state];
  const canSync = entry.cloud_sync_state !== 'synced';
  const deleteRemote = entry.cloud_sync_state !== 'offline';
  const deleteLabel = deleteRemote ? 'Delete everywhere' : 'Delete from Vault';
  const syncLabel =
    entry.cloud_sync_state === 'failed'
      ? 'Retry cloud sync'
      : entry.cloud_sync_state === 'offline'
        ? 'Sync to cloud'
        : 'Refresh cloud sync';

  const openEntry = () => setSelectedEntry(entry.id);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openEntry();
    }
  };

  const requestDelete = async () => {
    if (isDeleting) return;
    const confirmed = window.confirm(`${deleteLabel}?\n\n${entry.title}`);
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await deleteEntry(entry.id, deleteRemote);
      await fetchUnsortedCount();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vault] delete entry failed:', err);
      setIsDeleting(false);
    }
  };

  const requestSync = async () => {
    if (!canSync || isSyncingEntry) return;
    setIsSyncingEntry(true);
    try {
      await syncEntry(entry.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vault] sync entry failed:', err);
    } finally {
      setIsSyncingEntry(false);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={openEntry}
          onKeyDown={onKey}
          className={cn(
            'group flex items-center gap-2 h-9 px-2 rounded-lg transition-all duration-150 text-left w-full cursor-pointer select-none',
            'hover:bg-muted/60 hover:scale-[1.01] active:scale-[0.995]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40',
            entry.pinned && 'bg-primary/5',
            isDeleting && 'opacity-60 pointer-events-none',
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              void togglePinned(entry.id);
            }}
            className={cn(
              'w-5 h-5 rounded-md flex items-center justify-center transition-all duration-150',
              entry.pinned
                ? 'text-primary hover:bg-primary/10'
                : 'text-muted-foreground/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-muted/80 hover:text-foreground',
            )}
            title={entry.pinned ? 'Unpin' : 'Pin as source of truth'}
            aria-label={entry.pinned ? 'Unpin' : 'Pin as source of truth'}
          >
            <Pin className={cn('w-3 h-3', entry.pinned && 'fill-current')} />
          </button>

          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium truncate">{entry.title}</div>
            {entry.tags.length > 0 && (
              <div className="text-[9px] text-muted-foreground/60 truncate">
                {entry.tags.join(' · ')}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void requestSync();
            }}
            disabled={!canSync || isSyncingEntry}
            className={cn(
              'h-6 w-6 rounded-md flex items-center justify-center shrink-0 transition-all duration-150',
              canSync && 'hover:bg-primary/10',
              !canSync && 'cursor-default',
              isSyncingEntry && 'opacity-70',
            )}
            title={canSync ? syncLabel : `Cloud: ${entry.cloud_sync_state}`}
            aria-label={canSync ? syncLabel : `Cloud: ${entry.cloud_sync_state}`}
          >
            <SyncIcon
              className={cn(
                'w-3.5 h-3.5 shrink-0',
                SYNC_TONE[entry.cloud_sync_state],
                isSyncingEntry && 'animate-pulse',
              )}
            />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void requestDelete();
            }}
            disabled={isDeleting}
            className={cn(
              'w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-all duration-150',
              'text-muted-foreground/55 hover:bg-destructive/10 hover:text-destructive',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/30',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
            title={deleteLabel}
            aria-label={deleteLabel}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={openEntry}>
          Open details
        </ContextMenuItem>
        {canSync && (
          <ContextMenuItem onSelect={() => void requestSync()}>
            <CloudUpload className="mr-2 h-3.5 w-3.5" />
            {syncLabel}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => void requestDelete()}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          {deleteLabel}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
