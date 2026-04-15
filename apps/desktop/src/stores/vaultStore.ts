/**
 * Vault Store — agent memory state.
 *
 * Source of truth for vault entries surfaced in the panel. Uses a Map keyed
 * by entry id for O(1) lookup/update. V0 is wired to stub IPC; V1 will
 * populate entries from the local SQLite store.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  vaultList,
  vaultSetPinned,
  vaultDelete,
  vaultUnsortedCount,
  vaultSearch,
  type VaultEntry,
  type VaultScope,
  type VaultListFilters,
  type VaultSearchMode,
  type VaultSearchResult,
} from '@/lib/tauri/vault';

interface VaultState {
  entries: Map<string, VaultEntry>;
  unsortedCount: number;
  activeScope: VaultScope;
  filters: VaultListFilters;
  searchQuery: string;
  searchResults: VaultSearchResult[];
  isLoading: boolean;
  error: string | null;
}

interface VaultActions {
  setScope: (scope: VaultScope) => void;
  setFilter: (patch: Partial<VaultListFilters>) => void;
  setSearchQuery: (query: string) => void;
  fetchEntries: () => Promise<void>;
  fetchUnsortedCount: () => Promise<void>;
  upsertEntry: (entry: VaultEntry) => void;
  removeEntry: (entryId: string) => void;
  togglePinned: (entryId: string) => Promise<void>;
  deleteEntry: (entryId: string, alsoRemote: boolean) => Promise<void>;
  runSearch: (mode?: VaultSearchMode) => Promise<void>;
  clearSearch: () => void;
}

const initialScope: VaultScope = { type: 'global' };

export const useVaultStore = create<VaultState & VaultActions>()(
  immer((set, get) => ({
    entries: new Map(),
    unsortedCount: 0,
    activeScope: initialScope,
    filters: {},
    searchQuery: '',
    searchResults: [],
    isLoading: false,
    error: null,

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

    runSearch: async (mode = 'semantic') => {
      const { searchQuery, activeScope } = get();
      if (!searchQuery.trim()) {
        set((s) => {
          s.searchResults = [];
        });
        return;
      }
      const results = await vaultSearch(searchQuery, activeScope, 20, mode);
      set((s) => {
        s.searchResults = results;
      });
    },

    clearSearch: () =>
      set((s) => {
        s.searchQuery = '';
        s.searchResults = [];
      }),
  })),
);
