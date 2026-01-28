/**
 * Layout constants for Solo IDE
 */

export const SIDEBAR = {
  collapsed: 40,
  expanded: 256,
  min: 180,
  max: 400,
  iconColumnWidth: 40,
} as const;

export const HEIGHTS = {
  titlebar: 48,
  statusbar: 24,
} as const;

export const TRANSITIONS = {
  sidebar: '150ms ease-in-out',
} as const;
