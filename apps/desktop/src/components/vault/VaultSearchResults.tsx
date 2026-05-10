/**
 * VaultSearchResults — renders chunks returned by vault_search.
 *
 * V1 uses FTS5 (lexical). Each result shows the entry title, the matching
 * chunk snippet, and the score.
 */

import type { FC } from 'react';
import { Cloud, HardDrive, Layers, Trash2 } from 'lucide-react';
import { useVaultStore } from '@/stores/vaultStore';
import { VirtualList } from '@/components/ui/virtual-list';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

export const VaultSearchResults: FC = () => {
  const searchResults = useVaultStore((s) => s.searchResults);
  const searchQuery = useVaultStore((s) => s.searchQuery);
  const retrievalWarning = useVaultStore((s) => s.retrievalWarning);
  const setSelectedEntry = useVaultStore((s) => s.setSelectedEntry);
  const deleteEntry = useVaultStore((s) => s.deleteEntry);
  const fetchUnsortedCount = useVaultStore((s) => s.fetchUnsortedCount);

  const requestDelete = async (entryId: string, title: string, deleteRemote: boolean) => {
    const deleteLabel = deleteRemote ? 'Delete everywhere' : 'Delete from Vault';
    const confirmed = window.confirm(`${deleteLabel}?\n\n${title}`);
    if (!confirmed) return;

    try {
      await deleteEntry(entryId, deleteRemote);
      await fetchUnsortedCount();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vault] delete search result entry failed:', err);
    }
  };

  if (searchResults.length === 0) {
    return (
      <div className="flex flex-col gap-2 px-1 py-6 text-center">
        {retrievalWarning && (
          <div className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-300">
            {retrievalWarning}
          </div>
        )}
        <div className="text-[11px] text-muted-foreground/70">
          No matches for &ldquo;{searchQuery}&rdquo;.
        </div>
      </div>
    );
  }

  const sourceMeta = {
    local: { label: 'Local', Icon: HardDrive },
    cloud: { label: 'Cloud', Icon: Cloud },
    hybrid: { label: 'Hybrid', Icon: Layers },
  } as const;

  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-[10px] font-medium text-muted-foreground/70">
        {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}
      </div>
      {retrievalWarning && (
        <div className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-300">
          {retrievalWarning}
        </div>
      )}
      <VirtualList
        items={searchResults}
        estimateSize={() => 84}
        overscan={10}
        className="min-h-[220px] flex-1"
        itemClassName="pb-2"
        getItemKey={(r) => `${r.entry.id}:${r.chunk.chunk_index}:${r.source}`}
        testId="vault-search-results"
        renderItem={(r) => {
          const deleteRemote = r.entry.cloud_sync_state !== 'offline';
          const deleteLabel = deleteRemote ? 'Delete everywhere' : 'Delete from Vault';
          const meta = sourceMeta[r.source];
          const SourceIcon = meta.Icon;
          return (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedEntry(r.entry.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedEntry(r.entry.id);
                    }
                  }}
                  className="group flex flex-col gap-1 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 transition-colors duration-150 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium truncate">{r.entry.title}</span>
                    <span
                      className="inline-flex items-center gap-1 rounded-md bg-background/70 px-1.5 py-0.5 text-[9px] text-muted-foreground/80"
                      title={
                        r.source === 'cloud'
                          ? `Cloud ${r.mode}${r.embedding_model ? ` · ${r.embedding_model}` : ''}`
                          : `${meta.label} ${r.mode}`
                      }
                    >
                      <SourceIcon className="h-2.5 w-2.5" />
                      {meta.label}
                    </span>
                    <span className="ml-auto text-[9px] text-muted-foreground/60">
                      {Math.round(r.score * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void requestDelete(r.entry.id, r.entry.title, deleteRemote);
                      }}
                      className="h-5 w-5 rounded-md flex items-center justify-center text-muted-foreground/55 hover:bg-destructive/10 hover:text-destructive transition-colors duration-150"
                      title={deleteLabel}
                      aria-label={deleteLabel}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/80 leading-snug line-clamp-3">
                    {r.chunk.content}
                  </p>
                </div>
              </ContextMenuTrigger>

              <ContextMenuContent className="w-44">
                <ContextMenuItem onSelect={() => setSelectedEntry(r.entry.id)}>
                  Open details
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() => void requestDelete(r.entry.id, r.entry.title, deleteRemote)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  {deleteLabel}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        }}
      />
    </div>
  );
};
