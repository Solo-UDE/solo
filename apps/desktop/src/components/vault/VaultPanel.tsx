/**
 * VaultPanel — Studio-sidebar surface for the agent memory vault.
 *
 * V1.2: adds a Fts/Semantic mode toggle next to the search input, a
 * "Rebuild embeddings" button (with pending-count badge) in the header,
 * and a backfill progress toast at the bottom.
 */

import { useEffect, type FC } from 'react';
import {
  Vault as VaultIcon,
  PushPin,
  MagnifyingGlass,
  X,
  ArrowsClockwise,
  Sparkle,
  TextAa,
} from '@phosphor-icons/react';
import { useVaultStore } from '@/stores/vaultStore';
import { VaultScopeToggle } from './VaultScopeToggle';
import { VaultDropZone } from './VaultDropZone';
import { VaultEntryList } from './VaultEntryList';
import { VaultEmptyState } from './VaultEmptyState';
import { VaultSearchResults } from './VaultSearchResults';

export const VaultPanel: FC = () => {
  const entries = useVaultStore((s) => s.entries);
  const unsortedCount = useVaultStore((s) => s.unsortedCount);
  const searchQuery = useVaultStore((s) => s.searchQuery);
  const searchMode = useVaultStore((s) => s.searchMode);
  const searchResults = useVaultStore((s) => s.searchResults);
  const setSearchQuery = useVaultStore((s) => s.setSearchQuery);
  const setSearchMode = useVaultStore((s) => s.setSearchMode);
  const fetchEntries = useVaultStore((s) => s.fetchEntries);
  const fetchUnsortedCount = useVaultStore((s) => s.fetchUnsortedCount);
  const fetchPendingEmbeddings = useVaultStore((s) => s.fetchPendingEmbeddings);
  const runSearch = useVaultStore((s) => s.runSearch);
  const clearSearch = useVaultStore((s) => s.clearSearch);
  const runBackfill = useVaultStore((s) => s.runBackfill);
  const dismissBackfillToast = useVaultStore((s) => s.dismissBackfillToast);
  const activeScope = useVaultStore((s) => s.activeScope);
  const pendingEmbeddings = useVaultStore((s) => s.pendingEmbeddings);
  const backfill = useVaultStore((s) => s.backfill);
  const isSearchingState = useVaultStore((s) => s.isSearching);

  useEffect(() => {
    void fetchEntries();
    void fetchUnsortedCount();
    void fetchPendingEmbeddings();
  }, [activeScope, fetchEntries, fetchUnsortedCount, fetchPendingEmbeddings]);

  // Auto-dismiss the backfill toast ~5s after completion.
  useEffect(() => {
    if (!backfill.finishedAt || backfill.running) return;
    const id = window.setTimeout(() => {
      dismissBackfillToast();
    }, 5000);
    return () => window.clearTimeout(id);
  }, [backfill.finishedAt, backfill.running, dismissBackfillToast]);

  const hasEntries = entries.size > 0;
  const isSearching = searchQuery.trim().length > 0 && searchResults.length >= 0;

  const pct =
    backfill.total > 0
      ? Math.min(100, Math.round((backfill.completed / backfill.total) * 100))
      : 0;

  return (
    <div className="h-full flex flex-col min-h-0 relative">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center gap-2 shrink-0">
        <VaultIcon className="w-4 h-4 text-muted-foreground" weight="fill" />
        <span className="text-xs font-medium">Vault</span>

        <div className="ml-auto flex items-center gap-1.5">
          {unsortedCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {unsortedCount} unsorted
            </span>
          )}

          {/* Rebuild embeddings button — only when there's work to do */}
          {pendingEmbeddings > 0 && !backfill.running && (
            <button
              type="button"
              onClick={() => void runBackfill()}
              title={`Rebuild ${pendingEmbeddings} missing embedding${pendingEmbeddings === 1 ? '' : 's'}`}
              className="h-6 px-2 rounded-md bg-muted/40 hover:bg-muted/60 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-all duration-150 active:scale-[0.97]"
            >
              <ArrowsClockwise className="w-3 h-3" />
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
          <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
              if (e.key === 'Escape') clearSearch();
            }}
            placeholder={
              searchMode === 'semantic'
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

        {/* Fts / Semantic toggle */}
        <div className="flex items-center bg-muted/40 rounded-lg p-0.5 h-8">
          <button
            type="button"
            onClick={() => setSearchMode('fts')}
            title="Lexical (BM25) — matches exact keywords"
            className={`h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 active:scale-[0.94] ${
              searchMode === 'fts'
                ? 'bg-background shadow-[0_1px_3px_rgba(0,0,0,0.08)] text-foreground'
                : 'text-muted-foreground/70 hover:text-foreground'
            }`}
            aria-label="FTS mode"
          >
            <TextAa className="w-3.5 h-3.5" weight={searchMode === 'fts' ? 'fill' : 'regular'} />
          </button>
          <button
            type="button"
            onClick={() => setSearchMode('semantic')}
            title="Semantic — cosine similarity over OpenAI embeddings"
            className={`h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 active:scale-[0.94] ${
              searchMode === 'semantic'
                ? 'bg-background shadow-[0_1px_3px_rgba(0,0,0,0.08)] text-foreground'
                : 'text-muted-foreground/70 hover:text-foreground'
            }`}
            aria-label="Semantic mode"
          >
            <Sparkle
              className="w-3.5 h-3.5"
              weight={searchMode === 'semantic' ? 'fill' : 'regular'}
            />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-3 flex flex-col gap-3">
        {/* Drop zone always available */}
        <VaultDropZone />

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
        <PushPin className="w-3 h-3" />
        <span>Pin sources of truth to force-inject them into the agent.</span>
      </div>

      {/* Backfill progress toast */}
      {(backfill.running || backfill.finishedAt) && (
        <div
          className="absolute bottom-2 left-2 right-2 rounded-[12px] bg-card/95 backdrop-blur-md shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)] p-3 flex flex-col gap-2"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-xs">
            {backfill.running ? (
              <ArrowsClockwise className="w-3.5 h-3.5 text-primary animate-spin" />
            ) : backfill.failed > 0 ? (
              <Sparkle className="w-3.5 h-3.5 text-amber-500" weight="fill" />
            ) : (
              <Sparkle className="w-3.5 h-3.5 text-primary" weight="fill" />
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

      {isSearchingState && (
        <span className="sr-only" role="status">
          Searching vault…
        </span>
      )}
    </div>
  );
};
