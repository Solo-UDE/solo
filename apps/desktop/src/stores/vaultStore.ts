/**
 * Vault Store — agent memory state.
 *
 * Source of truth for vault entries surfaced in the panel. Uses a Map keyed
 * by entry id for O(1) lookup/update.
 *
 * V1.2 adds:
 *  - `searchMode` — persisted Fts/Semantic toggle
 *  - `backfill`   — progress state for the rebuild-embeddings run
 *  - `pendingEmbeddings` — badge count on the Rebuild button
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  vaultList,
  vaultSetPinned,
  vaultDelete,
  vaultUnsortedCount,
  vaultSearch,
  vaultBackfillEmbeddings,
  vaultPendingEmbeddingsCount,
  type VaultEntry,
  type VaultScope,
  type VaultListFilters,
  type VaultSearchMode,
  type VaultSearchResult,
} from '@/lib/tauri/vault';

// Local-storage key for the search mode toggle.
const SEARCH_MODE_STORAGE_KEY = 'solo.vault.searchMode';

function loadInitialSearchMode(): VaultSearchMode {
  try {
    const raw = localStorage.getItem(SEARCH_MODE_STORAGE_KEY);
    if (raw === 'semantic' || raw === 'fts') return raw;
  } catch {
    /* localStorage unavailable */
  }
  return 'fts';
}

interface BackfillState {
  running: boolean;
  total: number;
  completed: number;
  failed: number;
  elapsedMs: number;
  /**
   * Set to `Date.now()` when a run finishes so the UI can choose how long to
   * display the completion state before hiding the toast.
   */
  finishedAt: number | null;
}

const EMPTY_BACKFILL: BackfillState = {
  running: false,
  total: 0,
  completed: 0,
  failed: 0,
  elapsedMs: 0,
  finishedAt: null,
};

interface VaultState {
  entries: Map<string, VaultEntry>;
  unsortedCount: number;
  activeScope: VaultScope;
  filters: VaultListFilters;
  searchQuery: string;
  searchMode: VaultSearchMode;
  searchResults: VaultSearchResult[];
  isLoading: boolean;
  isSearching: boolean;
  error: string | null;
  backfill: BackfillState;
  pendingEmbeddings: number;
}

interface VaultActions {
  setScope: (scope: VaultScope) => void;
  setFilter: (patch: Partial<VaultListFilters>) => void;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: VaultSearchMode) => void;
  fetchEntries: () => Promise<void>;
  fetchUnsortedCount: () => Promise<void>;
  fetchPendingEmbeddings: () => Promise<void>;
  upsertEntry: (entry: VaultEntry) => void;
  removeEntry: (entryId: string) => void;
  togglePinned: (entryId: string) => Promise<void>;
  deleteEntry: (entryId: string, alsoRemote: boolean) => Promise<void>;
  runSearch: (mode?: VaultSearchMode) => Promise<void>;
  clearSearch: () => void;
  // V1.2 — backfill
  runBackfill: () => Promise<void>;
  updateBackfillProgress: (update: {
    total: number;
    completed: number;
    failed: number;
    elapsedMs: number;
    done: boolean;
  }) => void;
  dismissBackfillToast: () => void;
}

const initialScope: VaultScope = { type: 'global' };
const initialFilters: VaultListFilters = {
  kind: null,
  pinned: null,
  unsorted: null,
  query: null,
};

export const useVaultStore = create<VaultState & VaultActions>()(
  immer((set, get) => ({
    entries: new Map(),
    unsortedCount: 0,
    activeScope: initialScope,
    filters: initialFilters,
    searchQuery: '',
    searchMode: loadInitialSearchMode(),
    searchResults: [],
    isLoading: false,
    isSearching: false,
    error: null,
    backfill: EMPTY_BACKFILL,
    pendingEmbeddings: 0,

    setScope: (scope) =>
      set((s) => {
        s.activeScope = scope;
      }),

    setFilter: (patch) =>
      set((s) => {
        s.filters = { ...s.filters, ...patch };
      }),

    setSearchQuery: (query) =>
      set((s) => {
        s.searchQuery = query;
      }),

    setSearchMode: (mode) => {
      set((s) => {
        s.searchMode = mode;
      });
      try {
        localStorage.setItem(SEARCH_MODE_STORAGE_KEY, mode);
      } catch {
        /* non-fatal */
      }
    },

    fetchEntries: async () => {
      set((s) => {
        s.isLoading = true;
        s.error = null;
      });
      try {
        const list = await vaultList(get().activeScope, get().filters);
        set((s) => {
          s.entries = new Map(list.map((e) => [e.id, e]));
          s.isLoading = false;
        });
      } catch (err) {
        set((s) => {
          s.isLoading = false;
          s.error = String(err);
        });
      }
    },

    fetchUnsortedCount: async () => {
      try {
        const count = await vaultUnsortedCount();
        set((s) => {
          s.unsortedCount = count;
        });
      } catch {
        // Non-fatal: badge just won't update
      }
    },

    fetchPendingEmbeddings: async () => {
      try {
        const n = await vaultPendingEmbeddingsCount();
        // bigint → number (u64 serialized as BigInt in TS bindings)
        const count = typeof n === 'bigint' ? Number(n) : n;
        set((s) => {
          s.pendingEmbeddings = Number.isFinite(count) ? count : 0;
        });
      } catch {
        // Non-fatal
      }
    },

    upsertEntry: (entry) =>
      set((s) => {
        s.entries.set(entry.id, entry);
      }),

    removeEntry: (entryId) =>
      set((s) => {
        s.entries.delete(entryId);
      }),

    togglePinned: async (entryId) => {
      const existing = get().entries.get(entryId);
      if (!existing) return;
      const updated = await vaultSetPinned(entryId, !existing.pinned);
      if (updated) {
        set((s) => {
          s.entries.set(updated.id, updated);
        });
      }
    },

    deleteEntry: async (entryId, alsoRemote) => {
      await vaultDelete(entryId, alsoRemote);
      set((s) => {
        s.entries.delete(entryId);
      });
    },

    runSearch: async (mode) => {
      const { searchQuery, activeScope, searchMode } = get();
      if (!searchQuery.trim()) {
        set((s) => {
          s.searchResults = [];
          s.isSearching = false;
        });
        return;
      }
      const effectiveMode = mode ?? searchMode;
      set((s) => {
        s.isSearching = true;
        s.error = null;
      });
      const started = performance.now();
      try {
        const results = await vaultSearch(searchQuery, activeScope, 20, effectiveMode);
        const elapsed = Math.round(performance.now() - started);
        // Dev-console breadcrumb so we can compare modes at a glance.
        // eslint-disable-next-line no-console
        console.debug(
          `[vault.search] mode=${effectiveMode} q="${searchQuery.slice(0, 40)}" ` +
            `n=${results.length} ${elapsed}ms ` +
            `top=${results[0]?.score?.toFixed(3) ?? 'n/a'}`,
        );
        set((s) => {
          s.searchResults = results;
          s.isSearching = false;
        });
      } catch (err) {
        set((s) => {
          s.searchResults = [];
          s.isSearching = false;
          s.error = String(err);
        });
      }
    },

    clearSearch: () =>
      set((s) => {
        s.searchQuery = '';
        s.searchResults = [];
        s.isSearching = false;
      }),

    runBackfill: async () => {
      if (get().backfill.running) return;
      set((s) => {
        s.backfill = {
          running: true,
          total: 0,
          completed: 0,
          failed: 0,
          elapsedMs: 0,
          finishedAt: null,
        };
      });
      try {
        const result = await vaultBackfillEmbeddings();
        // Stream ticks will have already set completion, but the final invoke
        // resolution is authoritative — overwrite with reported totals.
        set((s) => {
          s.backfill = {
            running: false,
            total: Number(result.total),
            completed: Number(result.embedded),
            failed: Number(result.failed),
            elapsedMs: Number(result.totalMs),
            finishedAt: Date.now(),
          };
          s.pendingEmbeddings = Math.max(0, Number(result.total) - Number(result.embedded));
        });
      } catch (err) {
        set((s) => {
          s.backfill = {
            ...s.backfill,
            running: false,
            finishedAt: Date.now(),
          };
          s.error = String(err);
        });
      }
    },

    updateBackfillProgress: ({ total, completed, failed, elapsedMs, done }) =>
      set((s) => {
        s.backfill = {
          running: !done,
          total,
          completed,
          failed,
          elapsedMs,
          finishedAt: done ? Date.now() : null,
        };
        if (done) {
          s.pendingEmbeddings = Math.max(0, total - completed);
        }
      }),

    dismissBackfillToast: () =>
      set((s) => {
        s.backfill = EMPTY_BACKFILL;
      }),
  })),
);
