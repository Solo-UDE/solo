/**
 * Panel Layout Store
 * Manages the mosaic tree structure and tile configurations
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { MosaicNode, MosaicDirection, MosaicBranch } from 'react-mosaic-component';
import { getPathToCorner, updateTree, Corner } from 'react-mosaic-component';
import type { TileId, TileConfig, TileRegion, MosaicTree } from '@/lib/panels/types';
import { DEFAULT_TILES, RIGHT_SIDEBAR } from '@/lib/panels/constants';

enableMapSet();

interface PanelLayoutState {
  /** The mosaic tree structure */
  mosaicTree: MosaicTree;
  /** Map of tile IDs to their configurations */
  tiles: Map<TileId, TileConfig>;
  /** Counter for generating unique tile IDs */
  nextTileId: number;
  /** Right sidebar visibility */
  rightSidebarVisible: boolean;
  /** Right sidebar width as percentage */
  rightSidebarWidth: number;
  /** Currently focused tile for keyboard navigation */
  focusedTileId: TileId | null;
}

interface PanelLayoutActions {
  /** Set the entire mosaic tree */
  setMosaicTree: (tree: MosaicTree) => void;

  /** Create a new tile and return its ID */
  createTile: (region: TileRegion) => TileId;

  /** Remove a tile */
  removeTile: (tileId: TileId) => void;

  /** Split a tile in a direction. If newFirst is true, the new tile appears first (left/top) */
  splitTile: (tileId: TileId, direction: MosaicDirection, newTileId: TileId, newFirst?: boolean) => void;

  /** Add a tile to the tree at a corner */
  addTileToCorner: (tileId: TileId, corner: Corner, direction: MosaicDirection) => void;

  /** Toggle right sidebar visibility */
  toggleRightSidebar: () => void;

  /** Set right sidebar width */
  setRightSidebarWidth: (percentage: number) => void;

  /** Reset to default layout */
  resetLayout: () => void;

  /** Initialize with default layout */
  initializeDefaultLayout: () => void;

  /** Get tile config */
  getTileConfig: (tileId: TileId) => TileConfig | undefined;

  /** Set the focused tile for keyboard navigation */
  setFocusedTile: (tileId: TileId | null) => void;
}

type PanelLayoutStore = PanelLayoutState & PanelLayoutActions;

const initialState: PanelLayoutState = {
  mosaicTree: null,
  tiles: new Map(),
  nextTileId: 1,
  rightSidebarVisible: false,
  rightSidebarWidth: RIGHT_SIDEBAR.defaultWidth,
  focusedTileId: null,
};

export const usePanelLayoutStore = create<PanelLayoutStore>()(
  immer((set, get) => ({
    ...initialState,

    setMosaicTree: (tree: MosaicTree) => {
      set((state) => {
        state.mosaicTree = tree;
      });
    },

    createTile: (region: TileRegion): TileId => {
      const id = `tile-${get().nextTileId}`;
      set((state) => {
        state.nextTileId += 1;
        state.tiles.set(id, { id, region });
      });
      return id;
    },

    removeTile: (tileId: TileId) => {
      set((state) => {
        state.tiles.delete(tileId);
      });
    },

    splitTile: (tileId: TileId, direction: MosaicDirection, newTileId: TileId, newFirst: boolean = false) => {
      const { mosaicTree } = get();
      if (!mosaicTree) return;

      // Find the path to the tile we want to split
      const findPath = (
        node: MosaicNode<TileId>,
        target: TileId,
        path: MosaicBranch[] = []
      ): MosaicBranch[] | null => {
        if (typeof node === 'string') {
          return node === target ? path : null;
        }
        const firstPath = findPath(node.first, target, [...path, 'first']);
        if (firstPath) return firstPath;
        const secondPath = findPath(node.second, target, [...path, 'second']);
        return secondPath;
      };

      const path = findPath(mosaicTree, tileId);
      if (!path) return;

      // Create the new split node
      // If newFirst is true, the new tile appears first (left for row, top for column)
      const newNode: MosaicNode<TileId> = {
        direction,
        first: newFirst ? newTileId : tileId,
        second: newFirst ? tileId : newTileId,
        splitPercentage: 50,
      };

      set((state) => {
        if (path.length === 0) {
          // Splitting the root
          state.mosaicTree = newNode;
        } else {
          // Use updateTree to update at the path
          state.mosaicTree = updateTree(state.mosaicTree!, [
            {
              path,
              spec: { $set: newNode },
            },
          ]);
        }
      });
    },

    addTileToCorner: (tileId: TileId, corner: Corner, direction: MosaicDirection) => {
      const { mosaicTree } = get();

      set((state) => {
        if (!mosaicTree) {
          // If no tree exists, just set the tile as the root
          state.mosaicTree = tileId;
          return;
        }

        // Get path to the corner
        const path = getPathToCorner(mosaicTree, corner);

        // Determine placement based on corner
        const isLeftOrBottom = corner === Corner.TOP_LEFT || corner === Corner.BOTTOM_LEFT;

        const newNode: MosaicNode<TileId> = {
          direction,
          first: isLeftOrBottom ? tileId : mosaicTree,
          second: isLeftOrBottom ? mosaicTree : tileId,
          splitPercentage: isLeftOrBottom ? 25 : 75,
        };

        if (path.length === 0) {
          state.mosaicTree = newNode;
        } else {
          state.mosaicTree = updateTree(state.mosaicTree!, [
            {
              path: [],
              spec: { $set: newNode },
            },
          ]);
        }
      });
    },

    toggleRightSidebar: () => {
      set((state) => {
        state.rightSidebarVisible = !state.rightSidebarVisible;
      });
    },

    setRightSidebarWidth: (percentage: number) => {
      set((state) => {
        state.rightSidebarWidth = Math.max(
          RIGHT_SIDEBAR.minWidth,
          Math.min(RIGHT_SIDEBAR.maxWidth, percentage)
        );
      });
    },

    resetLayout: () => {
      set((state) => {
        state.mosaicTree = null;
        state.tiles = new Map();
        state.nextTileId = 1;
        state.rightSidebarVisible = false;
        state.rightSidebarWidth = RIGHT_SIDEBAR.defaultWidth;
      });
    },

    initializeDefaultLayout: () => {
      set((state) => {
        // Create a single default editor tile
        const editorTileId = DEFAULT_TILES.editor;
        state.tiles.set(editorTileId, { id: editorTileId, region: 'editor' });
        state.mosaicTree = editorTileId;
      });
    },

    getTileConfig: (tileId: TileId) => {
      return get().tiles.get(tileId);
    },

    setFocusedTile: (tileId: TileId | null) => {
      set((state) => {
        state.focusedTileId = tileId;
      });
    },
  }))
);

// Selector hooks
export const useMosaicTree = () => usePanelLayoutStore((state) => state.mosaicTree);
export const useRightSidebarVisible = () => usePanelLayoutStore((state) => state.rightSidebarVisible);
export const useFocusedTileId = () => usePanelLayoutStore((state) => state.focusedTileId);
