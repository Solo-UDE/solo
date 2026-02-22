/**
 * Layout Persistence Utilities
 * Handles serialization and deserialization of panel layout state
 */

import type { MosaicTree, TileId, TileConfig, PanelInstance, TileTabState } from './types';
import { PERSISTENCE } from './constants';
import { panelRegistry } from './registry';

/** Persisted layout format */
export interface PersistedLayout {
  version: number;
  timestamp: number;
  layout: {
    mosaicTree: MosaicTree;
    tiles: Record<TileId, TileConfig>;
    nextTileId: number;
  };
  tabs: {
    instances: Record<string, SerializedPanelInstance>;
    tileTabs: Record<TileId, TileTabState>;
    nextInstanceId: number;
  };
}

/** Serialized panel instance */
interface SerializedPanelInstance {
  id: string;
  panelType: string;
  title: string;
  icon?: string;
  isDirty: boolean;
  isPinned: boolean;
  data?: Record<string, unknown>;
}

const STORAGE_KEY = 'solo-panel-layout';

/**
 * Serialize panel instance for storage
 */
function serializeInstance(instance: PanelInstance): SerializedPanelInstance {
  const registration = panelRegistry.get(instance.panelType);
  const data = registration?.serializeData?.(instance.data) ?? undefined;

  return {
    id: instance.id,
    panelType: instance.panelType,
    title: instance.title,
    icon: instance.icon,
    isDirty: false, // Don't persist dirty state
    isPinned: instance.isPinned,
    data,
  };
}

/**
 * Deserialize panel instance from storage
 */
function deserializeInstance(serialized: SerializedPanelInstance): PanelInstance {
  const registration = panelRegistry.get(serialized.panelType);
  const data = (registration?.deserializeData && serialized.data)
    ? registration.deserializeData(serialized.data)
    : {};

  return {
    id: serialized.id,
    panelType: serialized.panelType,
    title: serialized.title,
    icon: serialized.icon,
    isDirty: false,
    isPinned: serialized.isPinned,
    data,
  };
}

/**
 * Serialize the current layout state for persistence.
 * Panels whose registration lacks serializeData are ephemeral (e.g. agent,
 * terminal, git-diff) and are excluded — they can't survive app restarts.
 */
export function serializeLayout(
  mosaicTree: MosaicTree,
  tiles: Map<TileId, TileConfig>,
  nextTileId: number,
  instances: Map<string, PanelInstance>,
  tileTabs: Map<TileId, TileTabState>,
  nextInstanceId: number
): PersistedLayout {
  const tilesObj: Record<TileId, TileConfig> = {};
  tiles.forEach((config, id) => {
    tilesObj[id] = config;
  });

  // Identify ephemeral panels (no serializeData → can't survive restart)
  const excludedIds = new Set<string>();
  instances.forEach((instance, id) => {
    const registration = panelRegistry.get(instance.panelType);
    if (!registration?.serializeData) {
      excludedIds.add(id);
    }
  });

  // Serialize only persistable instances
  const instancesObj: Record<string, SerializedPanelInstance> = {};
  instances.forEach((instance, id) => {
    if (!excludedIds.has(id)) {
      instancesObj[id] = serializeInstance(instance);
    }
  });

  // Clean up tileTabs: remove references to excluded instances
  const tileTabsObj: Record<TileId, TileTabState> = {};
  tileTabs.forEach((state, id) => {
    const filteredTabs = state.tabs.filter((tabId) => !excludedIds.has(tabId));
    const activeTabId = (state.activeTabId && excludedIds.has(state.activeTabId))
      ? (filteredTabs[0] ?? null)
      : state.activeTabId;
    tileTabsObj[id] = { tabs: filteredTabs, activeTabId };
  });

  return {
    version: PERSISTENCE.version,
    timestamp: Date.now(),
    layout: {
      mosaicTree,
      tiles: tilesObj,
      nextTileId,
    },
    tabs: {
      instances: instancesObj,
      tileTabs: tileTabsObj,
      nextInstanceId,
    },
  };
}

/**
 * Deserialize layout from storage.
 * Filters out ephemeral panel types (no serializeData) to handle stale
 * localStorage data from before non-persistable panels were excluded.
 */
export function deserializeLayout(persisted: PersistedLayout): {
  mosaicTree: MosaicTree;
  tiles: Map<TileId, TileConfig>;
  nextTileId: number;
  instances: Map<string, PanelInstance>;
  tileTabs: Map<TileId, TileTabState>;
  nextInstanceId: number;
} | null {
  if (persisted.version !== PERSISTENCE.version) {
    console.warn(`Layout version mismatch: expected ${PERSISTENCE.version}, got ${persisted.version}`);
    return null;
  }

  try {
    const tiles = new Map<TileId, TileConfig>();
    Object.entries(persisted.layout.tiles).forEach(([id, config]) => {
      tiles.set(id, config);
    });

    // Deserialize instances, filtering out ephemeral panel types
    const instances = new Map<string, PanelInstance>();
    const excludedIds = new Set<string>();

    Object.entries(persisted.tabs.instances).forEach(([id, serialized]) => {
      const registration = panelRegistry.get(serialized.panelType);
      if (!registration?.serializeData) {
        excludedIds.add(id);
      } else {
        instances.set(id, deserializeInstance(serialized));
      }
    });

    // Clean up tileTabs: remove references to excluded instances
    const tileTabs = new Map<TileId, TileTabState>();
    Object.entries(persisted.tabs.tileTabs).forEach(([id, state]) => {
      const filteredTabs = state.tabs.filter((tabId) => !excludedIds.has(tabId));
      const activeTabId = (state.activeTabId && excludedIds.has(state.activeTabId))
        ? (filteredTabs[0] ?? null)
        : state.activeTabId;
      tileTabs.set(id, { tabs: filteredTabs, activeTabId });
    });

    return {
      mosaicTree: persisted.layout.mosaicTree,
      tiles,
      nextTileId: persisted.layout.nextTileId,
      instances,
      tileTabs,
      nextInstanceId: persisted.tabs.nextInstanceId,
    };
  } catch (error) {
    console.error('Failed to deserialize layout:', error);
    return null;
  }
}

/**
 * Save layout to localStorage
 */
export function saveLayout(layout: PersistedLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch (error) {
    console.error('Failed to save layout:', error);
  }
}

/**
 * Load layout from localStorage
 */
export function loadLayout(): PersistedLayout | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    return JSON.parse(stored) as PersistedLayout;
  } catch (error) {
    console.error('Failed to load layout:', error);
    return null;
  }
}

/**
 * Clear persisted layout
 */
export function clearLayout(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear layout:', error);
  }
}

/**
 * Create a debounced save function
 */
export function createDebouncedSave(delay: number = PERSISTENCE.saveDebounceMs): {
  save: (layout: PersistedLayout) => void;
  cancel: () => void;
} {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return {
    save: (layout: PersistedLayout) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        saveLayout(layout);
        timeoutId = null;
      }, delay);
    },
    cancel: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}
