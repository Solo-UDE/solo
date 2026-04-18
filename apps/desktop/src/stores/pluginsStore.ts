/**
 * Plugins Store
 *
 * Wraps the `pluginsApi` Tauri commands in a Zustand store. Plugins come
 * from three sources (Solo cache, Claude adapter, Codex adapter) merged
 * with a first-wins collision rule by the backend loader. Per-plugin
 * enable/disable state lives in `~/.solo/plugins/toggles.json`.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  pluginsApi,
  type PluginDetail,
  type PluginId,
  type PluginListOutcome,
  type PluginLoadError,
  type PluginSummary,
} from '../lib/tauri/plugins';

interface PluginsState {
  /** All discovered plugins, sorted enabled-first then alphabetical. */
  plugins: PluginSummary[];
  /** Per-plugin manifest load errors (non-fatal, surfaced in UI). */
  errors: PluginLoadError[];
  /** True once `list(...)` has completed once. */
  loaded: boolean;
  /** Currently open detail view (null = drawer closed). */
  detail: PluginDetail | null;
  /** Whether the detail drawer is open. */
  detailOpen: boolean;
  /** In-flight mutation key — used to disable tile controls during updates. */
  mutating: string | null;
  /** Most recent user-facing error (toast). */
  lastError: string | null;
}

interface PluginsActions {
  list: (cwd: string) => Promise<void>;
  openDetail: (cwd: string, id: PluginId) => Promise<void>;
  closeDetail: () => void;
  setEnabled: (cwd: string, id: PluginId, enabled: boolean) => Promise<void>;
  installLocal: (cwd: string, sourcePath: string) => Promise<void>;
  uninstall: (cwd: string, id: PluginId) => Promise<void>;
  clearError: () => void;
}

type PluginsStore = PluginsState & PluginsActions;

function idKey(id: PluginId): string {
  return `${id.marketplace}/${id.name}`;
}

function applyOutcome(state: PluginsState, outcome: PluginListOutcome): void {
  state.plugins = outcome.plugins;
  state.errors = outcome.errors;
  state.loaded = true;
}

export const usePluginsStore = create<PluginsStore>()(
  immer((set, get) => ({
    plugins: [],
    errors: [],
    loaded: false,
    detail: null,
    detailOpen: false,
    mutating: null,
    lastError: null,

    list: async (cwd) => {
      try {
        const outcome = await pluginsApi.list(cwd);
        set((state) => {
          applyOutcome(state, outcome);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[PluginsStore] list failed:', err);
        set((state) => {
          state.lastError = message;
          state.loaded = true;
        });
      }
    },

    openDetail: async (cwd, id) => {
      try {
        const detail = await pluginsApi.getDetail(cwd, id);
        set((state) => {
          state.detail = detail;
          state.detailOpen = true;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set((state) => {
          state.lastError = message;
        });
      }
    },

    closeDetail: () => {
      set((state) => {
        state.detailOpen = false;
      });
    },

    setEnabled: async (cwd, id, enabled) => {
      const key = idKey(id);
      set((state) => {
        state.mutating = key;
      });
      try {
        const updated = await pluginsApi.setEnabled(cwd, id, enabled);
        set((state) => {
          const idx = state.plugins.findIndex((p) => idKey(p.id) === key);
          if (idx >= 0) state.plugins[idx] = updated;
          if (state.detail && idKey(state.detail.id) === key) {
            state.detail.enabled = enabled;
          }
        });
        // Re-list to pick up the new sort order (enabled-first).
        await get().list(cwd);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set((state) => {
          state.lastError = message;
        });
      } finally {
        set((state) => {
          state.mutating = null;
        });
      }
    },

    installLocal: async (cwd, sourcePath) => {
      set((state) => {
        state.mutating = 'install';
      });
      try {
        await pluginsApi.installLocal(sourcePath);
        await get().list(cwd);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set((state) => {
          state.lastError = message;
        });
      } finally {
        set((state) => {
          state.mutating = null;
        });
      }
    },

    uninstall: async (cwd, id) => {
      const key = idKey(id);
      set((state) => {
        state.mutating = key;
      });
      try {
        await pluginsApi.uninstall(id);
        set((state) => {
          if (state.detail && idKey(state.detail.id) === key) {
            state.detail = null;
            state.detailOpen = false;
          }
        });
        await get().list(cwd);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set((state) => {
          state.lastError = message;
        });
      } finally {
        set((state) => {
          state.mutating = null;
        });
      }
    },

    clearError: () => {
      set((state) => {
        state.lastError = null;
      });
    },
  })),
);
