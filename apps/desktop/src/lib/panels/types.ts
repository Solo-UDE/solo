/**
 * Panel System Types
 * Core TypeScript interfaces for the panel system
 */

import type { FC } from 'react';
import type { MosaicNode, MosaicBranch, MosaicDirection } from 'react-mosaic-component';

// =============================================================================
// Core Identifiers
// =============================================================================

/** Unique identifier for a mosaic tile (leaf node in the tree) */
export type TileId = string;

/** Unique identifier for an open panel instance */
export type PanelInstanceId = string;

/** Path in the mosaic tree */
export type MosaicPath = MosaicBranch[];

// =============================================================================
// Tile Types
// =============================================================================

/** Logical region a tile belongs to */
export type TileRegion = 'editor' | 'rightSidebar';

/** Configuration for a tile */
export interface TileConfig {
  id: TileId;
  region: TileRegion;
}

// =============================================================================
// Panel Instance Types
// =============================================================================

/** State of an open panel instance */
export interface PanelInstance {
  id: PanelInstanceId;
  /** Registered panel type ID (e.g., 'file-viewer') */
  panelType: string;
  /** Display title shown in tab */
  title: string;
  /** Icon name */
  icon?: string;
  /** Whether the panel has unsaved changes */
  isDirty: boolean;
  /** Whether the tab is pinned */
  isPinned: boolean;
  /** Panel-specific data passed to the component */
  data: Record<string, unknown>;
  /** Which repo this tab belongs to (null for non-repo panels like Welcome) */
  repoPath?: string;
  /** Which worktree this tab belongs to (null = main worktree) */
  worktreeId?: string | null;
  /** Timestamp of last activation (for recency sorting and ghost tab detection) */
  lastAccessed: number;
}

/** Tab state for a single tile */
export interface TileTabState {
  /** Ordered list of panel instance IDs */
  tabs: PanelInstanceId[];
  /** Currently active tab */
  activeTabId: PanelInstanceId | null;
}

// =============================================================================
// Panel Component Types
// =============================================================================

/** Props passed to every panel component */
export interface PanelProps<TData = Record<string, unknown>> {
  /** Unique instance ID */
  instanceId: PanelInstanceId;
  /** Panel-specific data */
  data: TData;
  /** Whether this panel is currently active/visible */
  isActive: boolean;
  /** Callback to close the panel */
  onClose: () => void;
  /** Callback to update dirty state */
  onDirtyChange: (isDirty: boolean) => void;
  /** Callback to update title */
  onTitleChange: (title: string) => void;
  /** Register a save callback for autosave integration */
  onSaveCallbackChange?: (saveFn: (() => Promise<void>) | undefined) => void;
}

/** Registration for a panel type */
export interface PanelTypeRegistration<TData = Record<string, unknown>> {
  /** Unique identifier for this panel type */
  id: string;
  /** Display name shown in UI */
  displayName: string;
  /** Default icon name */
  defaultIcon?: string;
  /** The React component to render */
  component: FC<PanelProps<TData>>;
  /** Generate default title from data */
  getDefaultTitle?: (data: TData) => string;
  /** Can this panel type be opened multiple times? */
  allowMultiple?: boolean;
  /** Preferred region when opening */
  preferredRegion?: TileRegion;
  /** Serialize data for persistence */
  serializeData?: (data: TData) => Record<string, unknown>;
  /** Deserialize data from persistence */
  deserializeData?: (raw: Record<string, unknown>) => TData;
}

// =============================================================================
// Layout State Types
// =============================================================================

/** Mosaic tree with our tile IDs */
export type MosaicTree = MosaicNode<TileId> | null;

// =============================================================================
// Drag and Drop Types
// =============================================================================

/** Drag item types */
export const DragItemTypes = {
  TAB: 'panel-tab',
  MOSAIC_WINDOW: 'MosaicWindow', // react-mosaic's internal type
} as const;

/** Tab drag item */
export interface TabDragItem {
  type: typeof DragItemTypes.TAB;
  instanceId: PanelInstanceId;
  sourceTileId: TileId;
  panelType: string;
}

// =============================================================================
// Re-exports from react-mosaic
// =============================================================================

export type { MosaicNode, MosaicBranch, MosaicDirection };
