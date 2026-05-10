/**
 * VaultPanel — Studio-sidebar surface for the agent memory vault.
 *
 * V1.2: adds a Fts/Semantic/Hybrid mode toggle next to the search input, a
 * "Rebuild embeddings" button (with pending-count badge) in the header,
 * and a backfill progress toast at the bottom.
 */

import { useEffect, useRef, type FC } from 'react';
import {
  Vault as VaultIcon,
  Pin,
  Search,
  X,
  RefreshCw,
  Sparkles,
  Type,
  FileSearch,
  Cloud,
  HardDrive,
  Layers,
} from 'lucide-react';
import { useVaultStore } from '@/stores/vaultStore';
import { useVaultDragDrop } from '@/hooks/useVaultDragDrop';
import { cn } from '@/lib/utils';
import { VaultScopeToggle } from './VaultScopeToggle';
import { VaultDropZone } from './VaultDropZone';
import { VaultEntryList } from './VaultEntryList';
import { VaultEmptyState } from './VaultEmptyState';
import { VaultSearchResults } from './VaultSearchResults';
import { VaultUnsortedTray } from './VaultUnsortedTray';
import { VaultEntryDrawer } from './VaultEntryDrawer';

export const VaultPanel: FC = () => {
  const entries = useVaultStore((s) => s.entries);
  const unsortedCount = useVaultStore((s) => s.unsortedCount);
  const searchQuery = useVaultStore((s) => s.searchQuery);
  const searchMode = useVaultStore((s) => s.searchMode);
  const retrievalSource = useVaultStore((s) => s.retrievalSource);
  const searchResults = useVaultStore((s) => s.searchResults);
  const setSearchQuery = useVaultStore((s) => s.setSearchQuery);
  const setSearchMode = useVaultStore((s) => s.setSearchMode);
  const setRetrievalSource = useVaultStore((s) => s.setRetrievalSource);
  const fetchEntries = useVaultStore((s) => s.fetchEntries);
  const fetchUnsortedCount = useVaultStore((s) => s.fetchUnsortedCount);
  const fetchPendingEmbeddings = useVaultStore((s) => s.fetchPendingEmbeddings);
  const fetchPendingReextract = useVaultStore((s) => s.fetchPendingReextract);
  const runSearch = useVaultStore((s) => s.runSearch);
  const clearSearch = useVaultStore((s) => s.clearSearch);
  const runBackfill = useVaultStore((s) => s.runBackfill);
  const runReextract = useVaultStore((s) => s.runReextract);
  const dismissBackfillToast = useVaultStore((s) => s.dismissBackfillToast);
  const dismissReextractToast = useVaultStore((s) => s.dismissReextractToast);
  const activeScope = useVaultStore((s) => s.activeScope);
  const pendingEmbeddings = useVaultStore((s) => s.pendingEmbeddings);
  const pendingReextract = useVaultStore((s) => s.pendingReextract);
  const backfill = useVaultStore((s) => s.backfill);
  const reextract = useVaultStore((s) => s.reextract);
  const isSearchingState = useVaultStore((s) => s.isSearching);
  const selectedEntryId = useVaultStore((s) => s.selectedEntryId);
  const setSelectedEntry = useVaultStore((s) => s.setSelectedEntry);

  // V1.3: native Finder drag-drop forwarding. The panelRef defines the
  // "in-bounds" region; drops outside fall through to other listeners
  // (e.g. the agent input).
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { isNativeDragOver } = useVaultDragDrop({ targetRef: panelRef });

  useEffect(() => {
    void fetchEntries();
    void fetchUnsortedCount();
    void fetchPendingEmbeddings();
    void fetchPendingReextract();
  }, [
    activeScope,
    fetchEntries,
    fetchUnsortedCount,
    fetchPendingEmbeddings,
    fetchPendingReextract,
  ]);

  // Auto-dismiss the backfill toast ~5s after completion.
  useEffect(() => {
    if (!backfill.finishedAt || backfill.running) return;
    const id = window.setTimeout(() => {
      dismissBackfillToast();
    }, 5000);
    return () => window.clearTimeout(id);
  }, [backfill.finishedAt, backfill.running, dismissBackfillToast]);

  useEffect(() => {
    if (!reextract.finishedAt || reextract.running) return;
    const id = window.setTimeout(() => {
      dismissReextractToast();
    }, 5000);
    return () => window.clearTimeout(id);
  }, [reextract.finishedAt, reextract.running, dismissReextractToast]);

  const hasEntries = entries.size > 0;
  const isSearching = searchQuery.trim().length > 0 && searchResults.length >= 0;

  const pct =
    backfill.total > 0
      ? Math.min(100, Math.round((backfill.completed / backfill.total) * 100))
      : 0;
  const reextractPct =
    reextract.total > 0
      ? Math.min(100, Math.round((reextract.completed / reextract.total) * 100))
      : 0;

  const selectedEntry = selectedEntryId ? entries.get(selectedEntryId) ?? null : null;

  return (
    <div
      ref={panelRef}
      className={cn(
        'h-full flex flex-col min-h-0 relative transition-colors duration-200',
        isNativeDragOver && 'bg-primary/5',
      )}
    >
      {/* Native drag-drop hint overlay */}
      {isNativeDragOver && (
        <div
          className="absolute inset-2 rounded-2xl ring-2 ring-primary/40 ring-offset-0 bg-primary/5 pointer-events-none z-20 flex items-center justify-center"
          aria-hidden="true"
        >
          <span className="text-xs font-medium text-primary bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm">
            Drop to remember
          </span>
        </div>
      )}

      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center gap-2 shrink-0">
        <VaultIcon className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium">Vault</span>

        <div className="ml-auto flex items-center gap-1.5">
          {unsortedCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {unsortedCount} unsorted
            </span>
          )}

          {/* Rebuild embeddings button — only when there's work to do */}
          {pendingReextract > 0 && !reextract.running && (
            <button
              type="button"
              onClick={() => void runReextract()}
              title={`Recover ${pendingReextract} legacy entr${pendingReextract === 1 ? 'y' : 'ies'}`}
              className="h-6 px-2 rounded-md bg-muted/40 hover:bg-muted/60 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-all duration-150 active:scale-[0.97]"
            >
              <FileSearch className="w-3 h-3" />
              <span>{pendingReextract}</span>
            </button>
          )}

          {pendingEmbeddings > 0 && !backfill.running && (
            <button
              type="button"
              onClick={() => void runBackfill()}
              title={`Rebuild ${pendingEmbeddings} missing embedding${pendingEmbeddings === 1 ? '' : 's'}`}
              className="h-6 px-2 rounded-md bg-muted/40 hover:bg-muted/60 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-all duration-150 active:scale-[0.97]"
            >
              <RefreshCw className="w-3 h-3" />
              <span>{pendingEmbeddings}</span>
            </button>
          )}
        </div>
      </div>

      {/* Scope toggle */}
      <div className="px-3 pb-2 shrink-0">
        <VaultScopeToggle />
      </div>

      {/* Search + mode toggle */}
      <div className="px-3 pb-2 shrink-0 flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
              if (e.key === 'Escape') clearSearch();
            }}
            placeholder={
              searchMode === 'hybrid'
                ? 'Hybrid vault search…'
                : searchMode === 'semantic'
                ? 'Semantic search…'
                : 'Search vault memory…'
            }
            className="w-full h-8 pl-7 pr-7 rounded-lg bg-muted/40 border-none text-xs focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 focus:outline-none transition-colors duration-150 placeholder:text-muted-foreground/50"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-sm flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 transition-colors duration-150"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Fts / Semantic / Hybrid toggle */}
        <div className="flex items-center bg-muted/40 rounded-lg p-0.5 h-8">
          <button
            type="button"
            onClick={() => setSearchMode('fts')}
            title="Lexical (BM25) — matches exact keywords"
            className={`h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 active:scale-[0.94] ${
              searchMode === 'fts'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground/70 hover:text-foreground'
            }`}
            aria-label="FTS mode"
          >
            <Type className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setSearchMode('semantic')}
            title="Semantic — cosine similarity over local MiniLM embeddings (runs on-device, no API key)"
            className={`h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 active:scale-[0.94] ${
              searchMode === 'semantic'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground/70 hover:text-foreground'
            }`}
            aria-label="Semantic mode"
          >
            <Sparkles
              className={cn('w-3.5 h-3.5', searchMode === 'semantic' && 'fill-current')}
            />
          </button>
          <button
            type="button"
            onClick={() => setSearchMode('hybrid')}
            title="Hybrid — fuses keyword and semantic ranks"
            className={`h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 active:scale-[0.94] ${
              searchMode === 'hybrid'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground/70 hover:text-foreground'
            }`}
            aria-label="Hybrid mode"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="px-3 pb-2 shrink-0 flex items-center gap-1.5">
        <div className="flex items-center bg-muted/35 rounded-lg p-0.5 h-7">
          <button
            type="button"
            onClick={() => setRetrievalSource('local')}
            title="Local retrieval only"
            className={`h-6 px-2 rounded-md flex items-center gap-1 text-[10px] transition-all duration-150 active:scale-[0.97] ${
              retrievalSource === 'local'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground/70 hover:text-foreground'
            }`}
            aria-label="Local retrieval"
          >
            <HardDrive className="w-3 h-3" />
            <span>Local</span>
          </button>
          <button
            type="button"
            onClick={() => setRetrievalSource('hybrid')}
            title="Hybrid retrieval uses local results first and sends the query to cloud when signed in"
            className={`h-6 px-2 rounded-md flex items-center gap-1 text-[10px] transition-all duration-150 active:scale-[0.97] ${
              retrievalSource === 'hybrid'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground/70 hover:text-foreground'
            }`}
            aria-label="Hybrid retrieval"
          >
            <Layers className="w-3 h-3" />
            <span>Hybrid</span>
          </button>
          <button
            type="button"
            onClick={() => setRetrievalSource('cloud')}
            title="Cloud retrieval sends the search query to the cloud"
            className={`h-6 px-2 rounded-md flex items-center gap-1 text-[10px] transition-all duration-150 active:scale-[0.97] ${
              retrievalSource === 'cloud'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground/70 hover:text-foreground'
            }`}
            aria-label="Cloud retrieval"
          >
            <Cloud className="w-3 h-3" />
            <span>Cloud</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden px-3 pb-3 flex flex-col gap-3">
        {/* Drop zone always available */}
        <VaultDropZone />

        {/* Unsorted review tray — only renders when there are unsorted items */}
        <VaultUnsortedTray />

        {isSearching ? (
          <VaultSearchResults />
        ) : hasEntries ? (
          <VaultEntryList />
        ) : (
          <VaultEmptyState />
        )}
      </div>

      {/* Pinned indicator footer */}
      <div className="px-3 py-2 border-t border-border/30 shrink-0 flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
        <Pin className="w-3 h-3" />
        <span>Pin sources of truth to force-inject them into the agent.</span>
      </div>

      {/* Backfill progress toast */}
      {(backfill.running || backfill.finishedAt) && (
        <div
          className="absolute bottom-2 left-2 right-2 rounded-lg bg-card/95 backdrop-blur-md shadow-xl p-3 flex flex-col gap-2"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-xs">
            {backfill.running ? (
              <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />
            ) : backfill.failed > 0 ? (
              <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-current" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-primary fill-current" />
            )}
            <span className="font-medium">
              {backfill.running
                ? 'Rebuilding embeddings…'
                : backfill.failed > 0
                  ? `Finished with ${backfill.failed} failed`
                  : 'Embeddings rebuilt'}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {backfill.completed} / {backfill.total}
            </span>
            {!backfill.running && (
              <button
                type="button"
                onClick={dismissBackfillToast}
                className="w-4 h-4 rounded-sm flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 transition-colors duration-150"
                aria-label="Dismiss"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground/70 flex justify-between">
            <span>{pct}%</span>
            <span>{(backfill.elapsedMs / 1000).toFixed(1)}s elapsed</span>
          </div>
        </div>
      )}

      {(reextract.running || reextract.finishedAt) && (
        <div
          className={cn(
            'absolute left-2 right-2 rounded-lg bg-card/95 backdrop-blur-md shadow-xl p-3 flex flex-col gap-2',
            backfill.running || backfill.finishedAt ? 'bottom-[104px]' : 'bottom-2',
          )}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-xs">
            {reextract.running ? (
              <FileSearch className="w-3.5 h-3.5 text-primary animate-pulse" />
            ) : reextract.failed > 0 ? (
              <FileSearch className="w-3.5 h-3.5 text-amber-500" />
            ) : (
              <FileSearch className="w-3.5 h-3.5 text-primary" />
            )}
            <span className="font-medium">
              {reextract.running
                ? 'Recovering documents…'
                : reextract.failed > 0
                  ? `${reextract.recovered} recovered, ${reextract.failed} failed`
                  : 'Documents recovered'}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {reextract.completed} / {reextract.total}
            </span>
            {!reextract.running && (
              <button
                type="button"
                onClick={dismissReextractToast}
                className="w-4 h-4 rounded-sm flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 transition-colors duration-150"
                aria-label="Dismiss"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: `${reextractPct}%` }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground/70 flex justify-between">
            <span>{reextractPct}%</span>
            <span>{(reextract.elapsedMs / 1000).toFixed(1)}s elapsed</span>
          </div>
        </div>
      )}

      {isSearchingState && (
        <span className="sr-only" role="status">
          Searching vault…
        </span>
      )}

      {/* Entry detail drawer — slides over the whole panel */}
      {selectedEntry && (
        <VaultEntryDrawer
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </div>
  );
};
