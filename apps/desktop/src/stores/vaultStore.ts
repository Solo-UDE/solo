/**
 * Vault Store — agent memory state.
 *
 * Source of truth for vault entries surfaced in the panel. Uses a Map keyed
 * by entry id for O(1) lookup/update.
 *
 * V1.2 adds:
 *  - `searchMode` — persisted Fts/Semantic/Hybrid toggle
 *  - `retrievalSource` — persisted Local/Cloud/Hybrid source selector
 *  - `backfill`   — progress state for the rebuild-embeddings run
 *  - `pendingEmbeddings` — badge count on the Rebuild button
 *  - `reextract` — progress state for legacy document recovery
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  vaultList,
  vaultSetPinned,
  vaultDelete,
  vaultSyncEntry,
  vaultUnsortedCount,
  vaultSearch,
  vaultBackfillEmbeddings,
  vaultPendingEmbeddingsCount,
  vaultReextract,
  vaultPendingReextractCount,
  type VaultEntry,
  type VaultScope,
  type VaultListFilters,
  type VaultRetrievalSource,
  type VaultSearchMode,
  type VaultSearchResult,
} from '@/lib/tauri/vault';

// Local-storage key for the search mode toggle.
const SEARCH_MODE_STORAGE_KEY = 'solo.vault.searchMode';
const RETRIEVAL_SOURCE_STORAGE_KEY = 'solo.vault.retrievalSource';
const SYNC_TO_CLOUD_STORAGE_KEY = 'solo.vault.syncToCloud';

function loadInitialSearchMode(): VaultSearchMode {
  try {
    const raw = localStorage.getItem(SEARCH_MODE_STORAGE_KEY);
    if (raw === 'semantic' || raw === 'fts' || raw === 'hybrid') return raw;
  } catch {
    /* localStorage unavailable */
  }
  return 'hybrid';
}

function loadInitialRetrievalSource(): VaultRetrievalSource {
  try {
    const raw = localStorage.getItem(RETRIEVAL_SOURCE_STORAGE_KEY);
    if (raw === 'local' || raw === 'cloud' || raw === 'hybrid') return raw;
  } catch {
    /* localStorage unavailable */
  }
  return 'hybrid';
}

function loadInitialSyncToCloud(): boolean {
  try {
    const raw = localStorage.getItem(SYNC_TO_CLOUD_STORAGE_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    /* localStorage unavailable */
  }
  return true;
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

interface ReextractState {
  running: boolean;
  total: number;
  completed: number;
  recovered: number;
  failed: number;
  elapsedMs: number;
  finishedAt: number | null;
}

const EMPTY_REEXTRACT: ReextractState = {
  running: false,
  total: 0,
  completed: 0,
  recovered: 0,
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
  retrievalSource: VaultRetrievalSource;
  syncToCloud: boolean;
  searchResults: VaultSearchResult[];
  isLoading: boolean;
  isSearching: boolean;
  error: string | null;
  retrievalWarning: string | null;
  backfill: BackfillState;
  reextract: ReextractState;
  pendingEmbeddings: number;
  pendingReextract: number;
  /** Entry currently open in the detail drawer, or null when closed. */
  selectedEntryId: string | null;
}

interface VaultActions {
  setScope: (scope: VaultScope) => void;
  setFilter: (patch: Partial<VaultListFilters>) => void;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: VaultSearchMode) => void;
  setRetrievalSource: (source: VaultRetrievalSource) => void;
  setSyncToCloud: (enabled: boolean) => void;
  setRetrievalWarning: (message: string | null) => void;
  setSelectedEntry: (id: string | null) => void;
  fetchEntries: () => Promise<void>;
  fetchUnsortedCount: () => Promise<void>;
  fetchPendingEmbeddings: () => Promise<void>;
  fetchPendingReextract: () => Promise<void>;
  upsertEntry: (entry: VaultEntry) => void;
  removeEntry: (entryId: string) => void;
  togglePinned: (entryId: string) => Promise<void>;
  deleteEntry: (entryId: string, alsoRemote: boolean) => Promise<void>;
  syncEntry: (entryId: string) => Promise<void>;
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
  runReextract: () => Promise<void>;
  updateReextractProgress: (update: {
    total: number;
    completed: number;
    recovered: number;
    failed: number;
    elapsedMs: number;
    done: boolean;
  }) => void;
  dismissReextractToast: () => void;
}

const initialScope: VaultScope = { type: 'global' };
const initialFilters: VaultListFilters = {
  kind: null,
  pinned: null,
  unsorted: null,
  expired: null,
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
    retrievalSource: loadInitialRetrievalSource(),
    syncToCloud: loadInitialSyncToCloud(),
    searchResults: [],
    isLoading: false,
    isSearching: false,
    error: null,
    retrievalWarning: null,
    backfill: EMPTY_BACKFILL,
    reextract: EMPTY_REEXTRACT,
    pendingEmbeddings: 0,
    pendingReextract: 0,
    selectedEntryId: null,

    setScope: (scope) =>
      set((s) => {
        s.activeScope = scope;
      }),

    setSelectedEntry: (id) =>
      set((s) => {
        s.selectedEntryId = id;
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

    setRetrievalSource: (source) => {
      set((s) => {
        s.retrievalSource = source;
      });
      try {
        localStorage.setItem(RETRIEVAL_SOURCE_STORAGE_KEY, source);
      } catch {
        /* non-fatal */
      }
    },

    setSyncToCloud: (enabled) => {
      set((s) => {
        s.syncToCloud = enabled;
      });
      try {
        localStorage.setItem(SYNC_TO_CLOUD_STORAGE_KEY, String(enabled));
      } catch {
        /* non-fatal */
      }
    },

    setRetrievalWarning: (message) =>
      set((s) => {
        s.retrievalWarning = message;
      }),

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

    fetchPendingReextract: async () => {
      try {
        const n = await vaultPendingReextractCount();
        const count = typeof n === 'bigint' ? Number(n) : n;
        set((s) => {
          s.pendingReextract = Number.isFinite(count) ? count : 0;
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
        // Close the drawer if it was showing the deleted entry.
        if (s.selectedEntryId === entryId) {
          s.selectedEntryId = null;
        }
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
        if (s.selectedEntryId === entryId) {
          s.selectedEntryId = null;
        }
      });
    },

    syncEntry: async (entryId) => {
      const updated = await vaultSyncEntry(entryId);
      if (updated) {
        set((s) => {
          s.entries.set(updated.id, updated);
        });
      }
    },

    runSearch: async (mode) => {
      const { searchQuery, activeScope, searchMode, retrievalSource, filters } = get();
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
        s.retrievalWarning = null;
      });
      const started = performance.now();
      try {
        const results = await vaultSearch(
          searchQuery,
          activeScope,
          20,
          effectiveMode,
          retrievalSource,
          filters.expired === true,
        );
        const elapsed = Math.round(performance.now() - started);
        // Dev-console breadcrumb so we can compare modes at a glance.
        // eslint-disable-next-line no-console
        console.debug(
          `[vault.search] mode=${effectiveMode} q="${searchQuery.slice(0, 40)}" ` +
            `source=${retrievalSource} ` +
            `n=${results.length} ${elapsed}ms ` +
            `top=${results[0]?.score?.toFixed(3) ?? 'n/a'}`,
        );
        set((s) => {
          s.searchResults = results;
          for (const result of results) {
            s.entries.set(result.entry.id, result.entry);
          }
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

    runReextract: async () => {
      if (get().reextract.running) return;
      set((s) => {
        s.reextract = {
          running: true,
          total: 0,
          completed: 0,
          recovered: 0,
          failed: 0,
          elapsedMs: 0,
          finishedAt: null,
        };
      });
      try {
        const result = await vaultReextract();
        set((s) => {
          s.reextract = {
            running: false,
            total: Number(result.total),
            completed: Number(result.total),
            recovered: Number(result.recovered),
            failed: Number(result.failed),
            elapsedMs: Number(result.totalMs),
            finishedAt: Date.now(),
          };
          s.pendingReextract = 0;
          s.pendingEmbeddings = Math.max(
            0,
            s.pendingEmbeddings + Number(result.recovered) - Number(result.embedded),
          );
        });
        await get().fetchEntries();
      } catch (err) {
        set((s) => {
          s.reextract = {
            ...s.reextract,
            running: false,
            finishedAt: Date.now(),
          };
          s.error = String(err);
        });
      }
    },

    updateReextractProgress: ({ total, completed, recovered, failed, elapsedMs, done }) =>
      set((s) => {
        s.reextract = {
          running: !done,
          total,
          completed,
          recovered,
          failed,
          elapsedMs,
          finishedAt: done ? Date.now() : null,
        };
        if (done) {
          s.pendingReextract = 0;
        }
      }),

    dismissReextractToast: () =>
      set((s) => {
        s.reextract = EMPTY_REEXTRACT;
      }),
  })),
);
