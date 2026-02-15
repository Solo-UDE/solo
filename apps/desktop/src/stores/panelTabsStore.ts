/**
 * Panel Tabs Store
 * Manages tab state for each tile, including open panels, active tabs, and dirty state
 */

import { useRef } from 'react';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { TileId, PanelInstanceId, PanelInstance, TileTabState } from '@/lib/panels/types';
import { panelRegistry } from '@/lib/panels/registry';
import { DEFAULT_TILES } from '@/lib/panels/constants';

enableMapSet();

interface PanelTabsState {
  /** All panel instances */
  instances: Map<PanelInstanceId, PanelInstance>;
  /** Tabs per tile */
  tileTabs: Map<TileId, TileTabState>;
  /** Counter for generating unique panel instance IDs */
  nextInstanceId: number;
  /** Save callbacks registered by panel components */
  saveCallbacks: Map<PanelInstanceId, () => Promise<void>>;
}

interface PanelTabsActions {
  /** Open a panel in a tile */
  openPanel: (
    panelType: string,
    data?: Record<string, unknown>,
    targetTileId?: TileId
  ) => PanelInstanceId;

  /** Close a panel instance */
  closePanel: (instanceId: PanelInstanceId) => void;

  /** Close a panel from a specific tile */
  closePanelInTile: (instanceId: PanelInstanceId, tileId: TileId) => void;

  /** Set the active tab in a tile */
  setActiveTab: (tileId: TileId, instanceId: PanelInstanceId) => void;

  /** Reorder tabs within a tile */
  reorderTabs: (tileId: TileId, fromIndex: number, toIndex: number) => void;

  /** Move a tab to a different tile */
  moveTabToTile: (
    instanceId: PanelInstanceId,
    fromTileId: TileId,
    toTileId: TileId,
    index?: number
  ) => void;

  /** Update dirty state */
  setDirty: (instanceId: PanelInstanceId, isDirty: boolean) => void;

  /** Update pinned state */
  setPinned: (instanceId: PanelInstanceId, isPinned: boolean) => void;

  /** Update panel title */
  updateTitle: (instanceId: PanelInstanceId, title: string) => void;

  /** Update panel data */
  updateData: (instanceId: PanelInstanceId, data: Record<string, unknown>) => void;

  /** Initialize a tile's tab state */
  initializeTile: (tileId: TileId) => void;

  /** Clean up a tile's tab state */
  cleanupTile: (tileId: TileId) => void;

  /** Get tabs for a tile */
  getTabsForTile: (tileId: TileId) => PanelInstance[];

  /** Get active panel for a tile */
  getActivePanel: (tileId: TileId) => PanelInstance | null;

  /** Close all panels in a tile */
  closeAllInTile: (tileId: TileId) => void;

  /** Close other panels in a tile (keep the specified one) */
  closeOthersInTile: (tileId: TileId, keepInstanceId: PanelInstanceId) => void;

  /** Find the tile containing a panel instance */
  findTileForPanel: (instanceId: PanelInstanceId) => TileId | null;

  /** Activate the next tab in a tile (wraps around) */
  activateNextTab: (tileId: TileId) => void;

  /** Activate the previous tab in a tile (wraps around) */
  activatePrevTab: (tileId: TileId) => void;

  /** Activate a tab by index (0-based) */
  activateTabByIndex: (tileId: TileId, index: number) => void;

  /** Close the active tab in a tile */
  closeActiveTab: (tileId: TileId) => void;

  /** Close all panels across all tiles */
  closeAll: () => void;

  /** Register a save callback for a panel (for autosave) */
  registerSaveCallback: (instanceId: PanelInstanceId, saveFn: (() => Promise<void>) | undefined) => void;

  /** Check if any panels have unsaved changes */
  hasDirtyPanels: () => boolean;

  /** Get dirty panels with their save callbacks */
  getDirtyPanelsWithSave: () => { instanceId: PanelInstanceId; save: () => Promise<void> }[];
}

type PanelTabsStore = PanelTabsState & PanelTabsActions;

const initialState: PanelTabsState = {
  instances: new Map(),
  tileTabs: new Map(),
  nextInstanceId: 1,
  saveCallbacks: new Map(),
};

export const usePanelTabsStore = create<PanelTabsStore>()(
  immer((set, get) => ({
    ...initialState,

    openPanel: (
      panelType: string,
      data: Record<string, unknown> = {},
      targetTileId?: TileId
    ): PanelInstanceId => {
      const registration = panelRegistry.get(panelType);
      if (!registration) {
        console.error(`Panel type "${panelType}" is not registered`);
        return '';
      }

      // Check if we should reuse an existing instance (for non-multiple panels)
      if (!registration.allowMultiple) {
        const existing = Array.from(get().instances.values()).find(
          (inst) => inst.panelType === panelType
        );
        if (existing) {
          // Activate the existing panel
          const tileId = get().findTileForPanel(existing.id);
          if (tileId) {
            get().setActiveTab(tileId, existing.id);
          }
          return existing.id;
        }
      }

      const id = `panel-${get().nextInstanceId}`;
      const title = registration.getDefaultTitle?.(data) ?? registration.displayName;

      // Determine target tile
      const tileId = targetTileId ?? DEFAULT_TILES.editor;

      set((state) => {
        state.nextInstanceId += 1;

        // Create the panel instance
        state.instances.set(id, {
          id,
          panelType,
          title,
          icon: registration.defaultIcon,
          isDirty: false,
          isPinned: false,
          data,
        });

        // Ensure tile has tab state
        if (!state.tileTabs.has(tileId)) {
          state.tileTabs.set(tileId, { tabs: [], activeTabId: null });
        }

        // Add to tile's tabs
        const tileState = state.tileTabs.get(tileId)!;
        tileState.tabs.push(id);
        tileState.activeTabId = id;
      });

      return id;
    },

    closePanel: (instanceId: PanelInstanceId) => {
      const tileId = get().findTileForPanel(instanceId);
      if (tileId) {
        get().closePanelInTile(instanceId, tileId);
      }
    },

    closePanelInTile: (instanceId: PanelInstanceId, tileId: TileId) => {
      set((state) => {
        const tileState = state.tileTabs.get(tileId);
        if (!tileState) return;

        const tabIndex = tileState.tabs.indexOf(instanceId);
        if (tabIndex === -1) return;

        // Remove from tile's tabs
        tileState.tabs.splice(tabIndex, 1);

        // Update active tab if necessary
        if (tileState.activeTabId === instanceId) {
          if (tileState.tabs.length > 0) {
            // Activate the tab to the left, or the first tab
            const newActiveIndex = Math.max(0, tabIndex - 1);
            tileState.activeTabId = tileState.tabs[newActiveIndex];
          } else {
            tileState.activeTabId = null;
          }
        }

        // Check if instance is used in any other tile
        const isUsedElsewhere = Array.from(state.tileTabs.values()).some(
          (ts) => ts.tabs.includes(instanceId)
        );

        // Remove the instance if not used elsewhere
        if (!isUsedElsewhere) {
          state.instances.delete(instanceId);
        }
      });
    },

    setActiveTab: (tileId: TileId, instanceId: PanelInstanceId) => {
      set((state) => {
        const tileState = state.tileTabs.get(tileId);
        if (tileState && tileState.tabs.includes(instanceId)) {
          tileState.activeTabId = instanceId;
        }
      });
    },

    reorderTabs: (tileId: TileId, fromIndex: number, toIndex: number) => {
      set((state) => {
        const tileState = state.tileTabs.get(tileId);
        if (!tileState) return;

        const [movedTab] = tileState.tabs.splice(fromIndex, 1);
        tileState.tabs.splice(toIndex, 0, movedTab);
      });
    },

    moveTabToTile: (
      instanceId: PanelInstanceId,
      fromTileId: TileId,
      toTileId: TileId,
      index?: number
    ) => {
      if (fromTileId === toTileId) return;

      set((state) => {
        const fromState = state.tileTabs.get(fromTileId);
        if (!fromState) return;

        // Ensure target tile has tab state
        if (!state.tileTabs.has(toTileId)) {
          state.tileTabs.set(toTileId, { tabs: [], activeTabId: null });
        }
        const toState = state.tileTabs.get(toTileId)!;

        // Remove from source
        const tabIndex = fromState.tabs.indexOf(instanceId);
        if (tabIndex === -1) return;
        fromState.tabs.splice(tabIndex, 1);

        // Update source active tab
        if (fromState.activeTabId === instanceId) {
          if (fromState.tabs.length > 0) {
            const newActiveIndex = Math.max(0, tabIndex - 1);
            fromState.activeTabId = fromState.tabs[newActiveIndex];
          } else {
            fromState.activeTabId = null;
          }
        }

        // Add to target
        if (index !== undefined && index >= 0 && index <= toState.tabs.length) {
          toState.tabs.splice(index, 0, instanceId);
        } else {
          toState.tabs.push(instanceId);
        }
        toState.activeTabId = instanceId;
      });
    },

    setDirty: (instanceId: PanelInstanceId, isDirty: boolean) => {
      set((state) => {
        const instance = state.instances.get(instanceId);
        if (instance) {
          instance.isDirty = isDirty;
        }
      });
    },

    setPinned: (instanceId: PanelInstanceId, isPinned: boolean) => {
      set((state) => {
        const instance = state.instances.get(instanceId);
        if (instance) {
          instance.isPinned = isPinned;
        }
      });
    },

    updateTitle: (instanceId: PanelInstanceId, title: string) => {
      set((state) => {
        const instance = state.instances.get(instanceId);
        if (instance) {
          instance.title = title;
        }
      });
    },

    updateData: (instanceId: PanelInstanceId, data: Record<string, unknown>) => {
      set((state) => {
        const instance = state.instances.get(instanceId);
        if (instance) {
          instance.data = data;
        }
      });
    },

    initializeTile: (tileId: TileId) => {
      set((state) => {
        if (!state.tileTabs.has(tileId)) {
          state.tileTabs.set(tileId, { tabs: [], activeTabId: null });
        }
      });
    },

    cleanupTile: (tileId: TileId) => {
      set((state) => {
        const tileState = state.tileTabs.get(tileId);
        if (tileState) {
          // Remove instances that are only in this tile
          for (const instanceId of tileState.tabs) {
            const isUsedElsewhere = Array.from(state.tileTabs.entries()).some(
              ([id, ts]) => id !== tileId && ts.tabs.includes(instanceId)
            );
            if (!isUsedElsewhere) {
              state.instances.delete(instanceId);
            }
          }
          state.tileTabs.delete(tileId);
        }
      });
    },

    getTabsForTile: (tileId: TileId): PanelInstance[] => {
      const tileState = get().tileTabs.get(tileId);
      if (!tileState) return [];

      return tileState.tabs
        .map((id) => get().instances.get(id))
        .filter((inst): inst is PanelInstance => inst !== undefined);
    },

    getActivePanel: (tileId: TileId): PanelInstance | null => {
      const tileState = get().tileTabs.get(tileId);
      if (!tileState || !tileState.activeTabId) return null;

      return get().instances.get(tileState.activeTabId) ?? null;
    },

    closeAllInTile: (tileId: TileId) => {
      const tileState = get().tileTabs.get(tileId);
      if (!tileState) return;

      // Close all tabs (copy array since we'll be modifying it)
      const tabsToClose = [...tileState.tabs];
      for (const instanceId of tabsToClose) {
        get().closePanelInTile(instanceId, tileId);
      }
    },

    closeOthersInTile: (tileId: TileId, keepInstanceId: PanelInstanceId) => {
      const tileState = get().tileTabs.get(tileId);
      if (!tileState) return;

      // Close all tabs except the one to keep
      const tabsToClose = tileState.tabs.filter((id) => id !== keepInstanceId);
      for (const instanceId of tabsToClose) {
        get().closePanelInTile(instanceId, tileId);
      }
    },

    findTileForPanel: (instanceId: PanelInstanceId): TileId | null => {
      for (const [tileId, tileState] of get().tileTabs.entries()) {
        if (tileState.tabs.includes(instanceId)) {
          return tileId;
        }
      }
      return null;
    },

    activateNextTab: (tileId: TileId) => {
      const tileState = get().tileTabs.get(tileId);
      if (!tileState || tileState.tabs.length === 0) return;

      const currentIndex = tileState.activeTabId
        ? tileState.tabs.indexOf(tileState.activeTabId)
        : -1;
      const nextIndex = (currentIndex + 1) % tileState.tabs.length;
      get().setActiveTab(tileId, tileState.tabs[nextIndex]);
    },

    activatePrevTab: (tileId: TileId) => {
      const tileState = get().tileTabs.get(tileId);
      if (!tileState || tileState.tabs.length === 0) return;

      const currentIndex = tileState.activeTabId
        ? tileState.tabs.indexOf(tileState.activeTabId)
        : 0;
      const prevIndex = (currentIndex - 1 + tileState.tabs.length) % tileState.tabs.length;
      get().setActiveTab(tileId, tileState.tabs[prevIndex]);
    },

    activateTabByIndex: (tileId: TileId, index: number) => {
      const tileState = get().tileTabs.get(tileId);
      if (!tileState || tileState.tabs.length === 0) return;

      // Clamp index to valid range
      const validIndex = Math.min(index, tileState.tabs.length - 1);
      if (validIndex >= 0) {
        get().setActiveTab(tileId, tileState.tabs[validIndex]);
      }
    },

    closeActiveTab: (tileId: TileId) => {
      const tileState = get().tileTabs.get(tileId);
      if (!tileState?.activeTabId) return;

      get().closePanelInTile(tileState.activeTabId, tileId);
    },

    closeAll: () => {
      // Close all panels in every tile
      for (const tileId of get().tileTabs.keys()) {
        get().closeAllInTile(tileId);
      }
      set((state) => {
        state.instances = new Map();
        state.tileTabs = new Map();
        state.saveCallbacks = new Map();
      });
    },

    registerSaveCallback: (instanceId: PanelInstanceId, saveFn: (() => Promise<void>) | undefined) => {
      set((state) => {
        if (saveFn) {
          state.saveCallbacks.set(instanceId, saveFn);
        } else {
          state.saveCallbacks.delete(instanceId);
        }
      });
    },

    hasDirtyPanels: () => {
      for (const instance of get().instances.values()) {
        if (instance.isDirty) return true;
      }
      return false;
    },

    getDirtyPanelsWithSave: () => {
      const result: { instanceId: PanelInstanceId; save: () => Promise<void> }[] = [];
      const callbacks = get().saveCallbacks;
      for (const instance of get().instances.values()) {
        if (instance.isDirty) {
          const save = callbacks.get(instance.id);
          if (save) {
            result.push({ instanceId: instance.id, save });
          }
        }
      }
      return result;
    },
  }))
);

// Empty array constant to avoid creating new references
const EMPTY_TABS: PanelInstance[] = [];

// Selector hooks using useShallow for stable references with derived data
export function useTabsForTile(tileId: TileId): PanelInstance[] {
  // Use useRef to cache the previous result and avoid recreating arrays unnecessarily
  const prevRef = useRef<{ tabIds: string[]; result: PanelInstance[] }>({
    tabIds: [],
    result: EMPTY_TABS,
  });

  return usePanelTabsStore((state) => {
    const tileState = state.tileTabs.get(tileId);
    if (!tileState || tileState.tabs.length === 0) {
      prevRef.current = { tabIds: [], result: EMPTY_TABS };
      return EMPTY_TABS;
    }

    // Check if tab IDs changed
    const tabIds = tileState.tabs;
    const prevTabIds = prevRef.current.tabIds;

    // If tab IDs are the same, check if instances changed
    if (
      tabIds.length === prevTabIds.length &&
      tabIds.every((id, i) => id === prevTabIds[i])
    ) {
      // Check if any instance has changed
      const allSame = prevRef.current.result.every(
        (inst, i) => inst === state.instances.get(tabIds[i])
      );
      if (allSame) {
        return prevRef.current.result;
      }
    }

    // Compute new result
    const result = tabIds
      .map((id) => state.instances.get(id))
      .filter((inst): inst is PanelInstance => inst !== undefined);

    prevRef.current = { tabIds: [...tabIds], result };
    return result;
  });
}

export function useActiveTabId(tileId: TileId): PanelInstanceId | null {
  return usePanelTabsStore(
    (state) => state.tileTabs.get(tileId)?.activeTabId ?? null
  );
}

export function useActivePanel(tileId: TileId): PanelInstance | null {
  const prevRef = useRef<PanelInstance | null>(null);

  return usePanelTabsStore((state) => {
    const tileState = state.tileTabs.get(tileId);
    if (!tileState?.activeTabId) {
      prevRef.current = null;
      return null;
    }

    const instance = state.instances.get(tileState.activeTabId) ?? null;

    // Return cached value if it's the same instance
    if (instance === prevRef.current) {
      return prevRef.current;
    }

    prevRef.current = instance;
    return instance;
  });
}

export function usePanelInstance(instanceId: PanelInstanceId): PanelInstance | null {
  return usePanelTabsStore(
    (state) => state.instances.get(instanceId) ?? null
  );
}
