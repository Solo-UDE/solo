/**
 * usePersistence - Hook for layout persistence
 * Handles loading persisted layout and auto-saving changes
 */

import { useEffect, useRef } from 'react';
import { usePanelLayoutStore } from '@/stores/panelLayoutStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import {
  serializeLayout,
  deserializeLayout,
  loadLayout,
  createDebouncedSave,
} from './persistence';

// Module-level flag: survives component remounts (e.g. settings toggle),
// only resets on full page reload (app restart) when we actually need to
// restore from localStorage.
let persistenceInitialized = false;

/**
 * Hook to handle layout persistence
 * Should be called once at the root of the panel system
 */
export function usePersistence() {
  const debouncedSaveRef = useRef(createDebouncedSave());

  // Load persisted layout on mount (only on first app load, not on view transitions)
  useEffect(() => {
    if (persistenceInitialized) return;
    persistenceInitialized = true;

    const persisted = loadLayout();
    if (!persisted) return;

    const deserialized = deserializeLayout(persisted);
    if (!deserialized) return;

    // Restore layout store state
    usePanelLayoutStore.setState({
      mosaicTree: deserialized.mosaicTree,
      tiles: deserialized.tiles,
      nextTileId: deserialized.nextTileId,
    });

    // Restore tabs store state
    usePanelTabsStore.setState({
      instances: deserialized.instances,
      tileTabs: deserialized.tileTabs,
      nextInstanceId: deserialized.nextInstanceId,
    });
  }, []);

  // Subscribe to store changes and auto-save
  useEffect(() => {
    const unsubscribeLayout = usePanelLayoutStore.subscribe((state) => {
      // Get tab state
      const tabState = usePanelTabsStore.getState();

      const layout = serializeLayout(
        state.mosaicTree,
        state.tiles,
        state.nextTileId,
        tabState.instances,
        tabState.tileTabs,
        tabState.nextInstanceId
      );

      debouncedSaveRef.current.save(layout);
    });

    const unsubscribeTabs = usePanelTabsStore.subscribe((state) => {
      // Get layout state
      const layoutState = usePanelLayoutStore.getState();

      const layout = serializeLayout(
        layoutState.mosaicTree,
        layoutState.tiles,
        layoutState.nextTileId,
        state.instances,
        state.tileTabs,
        state.nextInstanceId
      );

      debouncedSaveRef.current.save(layout);
    });

    // Cleanup
    return () => {
      unsubscribeLayout();
      unsubscribeTabs();
      debouncedSaveRef.current.cancel();
    };
  }, []);
}
