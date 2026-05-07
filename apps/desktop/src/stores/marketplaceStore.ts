/**
 * Marketplace Store
 *
 * Caches the registry.json fetched from `solo/skills-registry`, tracks
 * per-turn search suggestions for the input-banner, and exposes install/
 * uninstall actions. Session-scoped dismissals prevent re-suggesting a
 * skill the user has already skipped this session.
 *
 * The `skillStore` still owns the installed catalog — this store is
 * strictly about the remote marketplace and its derived state.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import * as api from '../lib/tauri/marketplace';
import type { Registry, RegistryEntry, SkillSuggestion } from '../lib/tauri/marketplace';

enableMapSet();

interface MarketplaceState {
  /** Cached registry.json. `null` before first fetch. */
  registry: Registry | null;
  /** Next skills.sh leaderboard page to fetch. */
  nextPage: number | null;
  /** True while more skills.sh pages are available. */
  hasMore: boolean;
  /** True while a fetch is in-flight. */
  loading: boolean;
  /** True while an additional page is in-flight. */
  loadingMore: boolean;
  /** Last fetch error, if any. UI should still show cached `registry` when set. */
  error: string | null;
  /** Current active suggestions for the chat banner. */
  suggestions: SkillSuggestion[];
  /** Skill ids the user has dismissed this session; never re-suggested. */
  dismissedIds: Set<string>;
}

interface MarketplaceActions {
  refreshRegistry: (force?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  setSuggestions: (list: SkillSuggestion[]) => void;
  dismissSuggestion: (id: string) => void;
  clearSuggestions: () => void;
  install: (entry: RegistryEntry) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
}

type MarketplaceStore = MarketplaceState & MarketplaceActions;

export const useMarketplaceStore = create<MarketplaceStore>()(
  immer((set, get) => ({
    registry: null,
    nextPage: null,
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: null,
    suggestions: [],
    dismissedIds: new Set<string>(),

    refreshRegistry: async (force = false) => {
      set((s) => {
        s.loading = true;
        s.error = null;
      });
      try {
        const reg = await api.fetchRegistry(force);
        set((s) => {
          s.registry = reg;
          s.nextPage = reg.next_page ?? null;
          s.hasMore = reg.has_more;
          s.loading = false;
        });
      } catch (e: unknown) {
        set((s) => {
          s.loading = false;
          s.error = e instanceof Error ? e.message : String(e);
        });
      }
    },

    loadMore: async () => {
      const { nextPage, hasMore, loadingMore, loading } = get();
      if (!hasMore || nextPage === null || loadingMore || loading) return;
      set((s) => {
        s.loadingMore = true;
        s.error = null;
      });
      try {
        const reg = await api.fetchRegistryPage('all-time', nextPage);
        set((s) => {
          if (s.registry) {
            s.registry.skills.push(...reg.skills);
            s.registry.has_more = reg.has_more;
            s.registry.next_page = reg.next_page ?? null;
            s.registry.total_skills = reg.total_skills || s.registry.total_skills;
          } else {
            s.registry = reg;
          }
          s.nextPage = reg.next_page ?? null;
          s.hasMore = reg.has_more;
          s.loadingMore = false;
        });
      } catch (e: unknown) {
        set((s) => {
          s.loadingMore = false;
          s.error = e instanceof Error ? e.message : String(e);
        });
      }
    },

    setSuggestions: (list) =>
      set((s) => {
        s.suggestions = list.filter((x) => !s.dismissedIds.has(x.entry.id));
      }),

    dismissSuggestion: (id) =>
      set((s) => {
        s.dismissedIds.add(id);
        s.suggestions = s.suggestions.filter((x) => x.entry.id !== id);
      }),

    clearSuggestions: () =>
      set((s) => {
        s.suggestions = [];
      }),

    install: async (entry) => {
      await api.installSkill(entry);
      set((s) => {
        s.suggestions = s.suggestions.filter((x) => x.entry.id !== entry.id);
      });
    },

    uninstall: async (id) => {
      await api.uninstallSkill(id);
    },
  })),
);
