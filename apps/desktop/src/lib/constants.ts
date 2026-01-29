/**
 * Layout constants for Solo IDE
 * NeuralForge layout system
 */

export const SIDEBAR = {
  collapsed: 0,           // Fully collapsed (activity bar still visible)
  expanded: 256,          // Default expanded width
  min: 180,               // Minimum width when expanded
  max: 400,               // Maximum width
  iconColumnWidth: 48,    // Activity bar width
} as const;

export const HEIGHTS = {
  titlebar: 40,           // Reduced titlebar height
  statusbar: 24,
  tabBar: 35,
  breadcrumbs: 28,
} as const;

export const ACTIVITY_BAR = {
  width: 48,
} as const;

export const TRANSITIONS = {
  sidebar: '200ms cubic-bezier(0.34, 1.56, 0.64, 1)',  // Spring easing
  panel: '150ms ease-out',
} as const;
