/**
 * Tab Type Visual Signatures
 * Returns visual metadata (language dot, border style, title class) for each panel type
 * so different tab types are instantly distinguishable without reading the title.
 */

import type { PanelInstance } from './types';
import { BUILTIN_PANEL_TYPES } from './constants';

export interface TabTypeVisuals {
  /** Colored dot for file extension languages (CSS color string, null if not a file) */
  languageDot: string | null;
  /** Left-border style for special tab types */
  borderStyle: 'streaming' | 'idle-agent' | 'diff' | null;
  /** Extra CSS class applied to the title text */
  titleClass: string | null;
}

// File extension to dot color mapping (popular languages)
const EXTENSION_COLORS: Record<string, string> = {
  ts: '#3178C6',
  tsx: '#3178C6',
  js: '#F7DF1E',
  jsx: '#F7DF1E',
  rs: '#DEA584',
  py: '#3776AB',
  rb: '#CC342D',
  go: '#00ADD8',
  java: '#ED8B00',
  kt: '#A97BFF',
  swift: '#FA7343',
  c: '#A8B9CC',
  cpp: '#00599C',
  h: '#A8B9CC',
  css: '#264DE4',
  scss: '#CF649A',
  html: '#E34F26',
  json: '#6D6D6D',
  md: '#6D6D6D',
  yml: '#CB171E',
  yaml: '#CB171E',
  toml: '#9C4121',
  sql: '#336791',
  sh: '#4EAA25',
  bash: '#4EAA25',
  zsh: '#4EAA25',
  vue: '#4FC08D',
  svelte: '#FF3E00',
};

function getFileExtension(title: string): string | null {
  const lastDot = title.lastIndexOf('.');
  if (lastDot === -1 || lastDot === title.length - 1) return null;
  return title.slice(lastDot + 1).toLowerCase();
}

export function getTabTypeVisuals(
  instance: PanelInstance,
  isStreaming: boolean,
): TabTypeVisuals {
  const panelType = instance.panelType;

  // Agent tabs - pulsing border when streaming, dim border when idle
  if (panelType === BUILTIN_PANEL_TYPES.AGENT) {
    return {
      languageDot: null,
      borderStyle: isStreaming ? 'streaming' : 'idle-agent',
      titleClass: null,
    };
  }

  // Terminal tabs - monospace title
  if (panelType === BUILTIN_PANEL_TYPES.TERMINAL) {
    return {
      languageDot: null,
      borderStyle: null,
      titleClass: 'font-mono text-[12px]',
    };
  }

  // Diff tabs - split border
  if (
    panelType === BUILTIN_PANEL_TYPES.GIT_DIFF ||
    panelType === BUILTIN_PANEL_TYPES.WORKTREE_DIFF ||
    panelType === BUILTIN_PANEL_TYPES.BRANCH_DIFF
  ) {
    return {
      languageDot: null,
      borderStyle: 'diff',
      titleClass: null,
    };
  }

  // File tabs - language-colored dot
  if (panelType === BUILTIN_PANEL_TYPES.FILE_VIEWER) {
    const ext = getFileExtension(instance.title);
    const color = ext ? EXTENSION_COLORS[ext] ?? null : null;
    return {
      languageDot: color,
      borderStyle: null,
      titleClass: null,
    };
  }

  // All other panel types - no special visuals
  return {
    languageDot: null,
    borderStyle: null,
    titleClass: null,
  };
}
