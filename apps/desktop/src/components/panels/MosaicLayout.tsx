/**
 * MosaicLayout - Root component for the panel system
 * Wraps react-mosaic with DnD provider and renders TabbedContainers
 */

import { useCallback, useEffect, useMemo } from 'react';
import { Mosaic, MosaicBranch } from 'react-mosaic-component';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { usePanelLayoutStore, useFocusedTileId } from '@/stores/panelLayoutStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { TabbedContainer } from './TabbedContainer';
import { usePersistence } from '@/lib/panels/usePersistence';
import type { TileId, MosaicTree } from '@/lib/panels/types';
import { DEFAULT_TILES } from '@/lib/panels/constants';

export function MosaicLayout() {
  // Enable layout persistence (load on mount, save on changes)
  usePersistence();

  const mosaicTree = usePanelLayoutStore((state) => state.mosaicTree);
  const focusedTileId = useFocusedTileId();

  // Get actions directly from store to avoid selector subscription issues
  const layoutActions = useMemo(() => {
    const state = usePanelLayoutStore.getState();
    return {
      setMosaicTree: state.setMosaicTree,
      initializeDefaultLayout: state.initializeDefaultLayout,
    };
  }, []);

  const tabActions = useMemo(() => {
    const state = usePanelTabsStore.getState();
    return {
      activateNextTab: state.activateNextTab,
      activatePrevTab: state.activatePrevTab,
      activateTabByIndex: state.activateTabByIndex,
      closeActiveTab: state.closeActiveTab,
    };
  }, []);

  const { setMosaicTree, initializeDefaultLayout } = layoutActions;
  const { activateNextTab, activatePrevTab, activateTabByIndex, closeActiveTab } = tabActions;

  // Initialize default layout if no tree exists
  useEffect(() => {
    if (mosaicTree === null) {
      initializeDefaultLayout();
    }
  }, [mosaicTree, initializeDefaultLayout]);

  // Keyboard navigation handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Determine the target tile (focused or default)
      const targetTile = focusedTileId || DEFAULT_TILES.editor;

      // Cmd+W - Close active tab
      if (e.metaKey && e.key === 'w') {
        e.preventDefault();
        closeActiveTab(targetTile);
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab - Next/Previous tab
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          activatePrevTab(targetTile);
        } else {
          activateNextTab(targetTile);
        }
        return;
      }

      // Cmd+1-9 - Switch to tab by index
      if (e.metaKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1; // Convert to 0-based index
        activateTabByIndex(targetTile, index);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [focusedTileId, activateNextTab, activatePrevTab, activateTabByIndex, closeActiveTab]);

  // Handle tree changes from mosaic (e.g., resize, drag)
  const handleChange = useCallback(
    (newTree: MosaicTree) => {
      setMosaicTree(newTree);
    },
    [setMosaicTree]
  );

  // Render a tile - this returns the content for each leaf node
  // NOTE: Do NOT call state mutations here - they must be in useEffect
  const renderTile = useCallback(
    (tileId: TileId, path: MosaicBranch[]) => {
      return <TabbedContainer tileId={tileId} path={path} />;
    },
    []
  );

  // Don't render anything if tree is null (during initialization)
  if (mosaicTree === null) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="h-full w-full">
        <Mosaic<TileId>
          value={mosaicTree}
          onChange={handleChange}
          renderTile={renderTile}
          className="mosaic-solo-theme"
          zeroStateView={<ZeroState />}
        />
      </div>
    </DndProvider>
  );
}

/**
 * ZeroState - Shown when no tiles exist
 */
function ZeroState() {
  const handleResetLayout = useCallback(() => {
    usePanelLayoutStore.getState().initializeDefaultLayout();
  }, []);

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center space-y-4">
        <p className="text-muted-foreground">No panels open</p>
        <button
          onClick={handleResetLayout}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:brightness-110 transition-all"
        >
          Reset Layout
        </button>
      </div>
    </div>
  );
}
