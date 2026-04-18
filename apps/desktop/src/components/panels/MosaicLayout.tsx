/**
 * MosaicLayout - Root component for the panel system
 * Wraps react-mosaic with DnD provider and renders TabbedContainers.
 * Global keyboard shortcuts are handled in App.tsx so the shortcut registry,
 * settings UI, and runtime behavior stay aligned.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { MosaicWithoutDragDropContext, MosaicBranch } from 'react-mosaic-component';
import { usePanelLayoutStore } from '@/stores/panelLayoutStore';
import { TabbedContainer } from './TabbedContainer';
import { usePersistence } from '@/lib/panels/usePersistence';
import type { TileId, MosaicTree } from '@/lib/panels/types';

export function MosaicLayout() {
  // Enable layout persistence (load on mount, save on changes)
  usePersistence();

  const mosaicTree = usePanelLayoutStore((state) => state.mosaicTree);

  // Get actions directly from store to avoid selector subscription issues
  const layoutActions = useMemo(() => {
    const state = usePanelLayoutStore.getState();
    return {
      setMosaicTree: state.setMosaicTree,
      initializeDefaultLayout: state.initializeDefaultLayout,
    };
  }, []);

  const { setMosaicTree, initializeDefaultLayout } = layoutActions;

  // Initialize default layout if no tree exists
  useEffect(() => {
    if (mosaicTree === null) {
      initializeDefaultLayout();
    }
  }, [mosaicTree, initializeDefaultLayout]);

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
    <div className="h-full w-full" data-tour="editor">
      <MosaicWithoutDragDropContext<TileId>
        value={mosaicTree}
        onChange={handleChange}
        renderTile={renderTile}
        className="mosaic-solo-theme"
        zeroStateView={<ZeroState />}
      />
    </div>
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
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:brightness-110 transition-[transform,background-color] duration-200"
        >
          Reset Layout
        </button>
      </div>
    </div>
  );
}
