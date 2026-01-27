/**
 * Panel System Constants
 */

/** Tab bar dimensions */
export const TAB_BAR = {
  /** Height of the tab bar in pixels */
  height: 35,
  /** Minimum tab width in pixels */
  minTabWidth: 80,
  /** Maximum tab width in pixels */
  maxTabWidth: 200,
} as const;

/** Tile constraints */
export const TILE = {
  /** Minimum tile width in pixels */
  minWidth: 200,
  /** Minimum tile height in pixels */
  minHeight: 100,
  /** Minimum size as percentage (for mosaic) */
  minSizePercentage: 10,
} as const;

/** Right sidebar defaults */
export const RIGHT_SIDEBAR = {
  /** Default width as percentage */
  defaultWidth: 25,
  /** Minimum width as percentage */
  minWidth: 15,
  /** Maximum width as percentage */
  maxWidth: 50,
} as const;

/** Layout persistence */
export const PERSISTENCE = {
  /** Current layout schema version */
  version: 1,
  /** Directory name for storing layout */
  directory: '.solo',
  /** Layout filename */
  filename: 'layout.json',
  /** Debounce delay for auto-save in milliseconds */
  saveDebounceMs: 1000,
} as const;

/** Default tile IDs */
export const DEFAULT_TILES = {
  /** Main editor tile */
  editor: 'tile-editor-main',
} as const;
