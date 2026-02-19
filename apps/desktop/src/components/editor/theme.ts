/**
 * Monaco Editor theme for Solo IDE
 * Uses static colors matching the design system for reliability
 */

import type * as Monaco from 'monaco-editor';

// Dark theme colors (matching index.css dark mode)
const darkColors = {
  background: '#2a2520',
  foreground: '#ede9e3',
  muted: '#3d3732',
  mutedForeground: '#9c9590',
  border: '#3d3732',
  primary: '#c8763a',
  accent: '#47423d',
  destructive: '#d4644a',
  // Syntax
  keyword: '#7eafd4',
  string: '#d4a574',
  type: '#7ed4c4',
  function: '#e8d49c',
  variable: '#b4cce8',
  comment: '#6a9c6a',
  number: '#b4d49c',
  control: '#c49cd4',
  operator: '#ddd9d4',
  bracket: '#e8c46a',
};

/**
 * Build Monaco theme definition
 */
function buildMonacoTheme(): Monaco.editor.IStandaloneThemeData {
  const c = darkColors;

  return {
    base: 'vs-dark',
    inherit: false,
    rules: [
      // Default text
      { token: '', foreground: c.foreground.slice(1) },

      // Keywords
      { token: 'keyword', foreground: c.keyword.slice(1) },
      { token: 'keyword.control', foreground: c.control.slice(1) },
      { token: 'keyword.operator', foreground: c.operator.slice(1) },

      // Literals
      { token: 'string', foreground: c.string.slice(1) },
      { token: 'string.escape', foreground: c.keyword.slice(1) },
      { token: 'number', foreground: c.number.slice(1) },
      { token: 'number.float', foreground: c.number.slice(1) },
      { token: 'number.hex', foreground: c.number.slice(1) },
      { token: 'constant', foreground: c.keyword.slice(1) },

      // Comments
      { token: 'comment', foreground: c.comment.slice(1), fontStyle: 'italic' },

      // Variables and identifiers
      { token: 'variable', foreground: c.variable.slice(1) },
      { token: 'variable.predefined', foreground: c.variable.slice(1) },
      { token: 'identifier', foreground: c.foreground.slice(1) },

      // Types
      { token: 'type', foreground: c.type.slice(1) },
      { token: 'type.identifier', foreground: c.type.slice(1) },

      // Operators and delimiters
      { token: 'delimiter', foreground: c.operator.slice(1) },
      { token: 'delimiter.bracket', foreground: c.bracket.slice(1) },
      { token: 'operator', foreground: c.operator.slice(1) },

      // HTML/JSX
      { token: 'tag', foreground: c.keyword.slice(1) },
      { token: 'attribute.name', foreground: c.variable.slice(1) },
      { token: 'attribute.value', foreground: c.string.slice(1) },
    ],
    colors: {
      'editor.background': c.background,
      'editor.foreground': c.foreground,
      'editor.lineHighlightBackground': c.muted,
      'editor.selectionBackground': c.primary + '4D',
      'editor.inactiveSelectionBackground': c.accent + '33',
      'editorLineNumber.foreground': c.mutedForeground,
      'editorLineNumber.activeForeground': c.foreground,
      'editorGutter.background': c.background,
      'editorCursor.foreground': c.foreground,
      'editorBracketMatch.background': c.primary + '40',
      'editorBracketMatch.border': c.primary,
      'editorIndentGuide.background': c.border,
      'editorIndentGuide.activeBackground': c.mutedForeground,
      'scrollbarSlider.background': c.mutedForeground + '40',
      'scrollbarSlider.hoverBackground': c.mutedForeground + '60',
      'scrollbarSlider.activeBackground': c.mutedForeground + '80',
      'editorWidget.background': c.background,
      'editorWidget.border': c.border,
      'editorSuggestWidget.background': c.background,
      'editorSuggestWidget.border': c.border,
      'editorSuggestWidget.selectedBackground': c.muted,
      'editorHoverWidget.background': c.background,
      'editorHoverWidget.border': c.border,
    },
  };
}

// Light theme colors (matching index.css light mode)
const lightColors = {
  background: '#faf8f5',
  foreground: '#2a2520',
  muted: '#eae6e0',
  mutedForeground: '#7a756f',
  border: '#e0dcd6',
  primary: '#c8763a',
  accent: '#f0ece6',
  destructive: '#d4644a',
  // Syntax
  keyword: '#1a6fa0',
  string: '#b35e2a',
  type: '#1a8a7a',
  function: '#7a6520',
  variable: '#2a5e8a',
  comment: '#5a8a5a',
  number: '#5a8a30',
  control: '#8a5a9a',
  operator: '#4a4540',
  bracket: '#9a7a2a',
};

/**
 * Build Monaco light theme definition
 */
function buildMonacoLightTheme(): Monaco.editor.IStandaloneThemeData {
  const c = lightColors;

  return {
    base: 'vs',
    inherit: false,
    rules: [
      { token: '', foreground: c.foreground.slice(1) },
      { token: 'keyword', foreground: c.keyword.slice(1) },
      { token: 'keyword.control', foreground: c.control.slice(1) },
      { token: 'keyword.operator', foreground: c.operator.slice(1) },
      { token: 'string', foreground: c.string.slice(1) },
      { token: 'string.escape', foreground: c.keyword.slice(1) },
      { token: 'number', foreground: c.number.slice(1) },
      { token: 'number.float', foreground: c.number.slice(1) },
      { token: 'number.hex', foreground: c.number.slice(1) },
      { token: 'constant', foreground: c.keyword.slice(1) },
      { token: 'comment', foreground: c.comment.slice(1), fontStyle: 'italic' },
      { token: 'variable', foreground: c.variable.slice(1) },
      { token: 'variable.predefined', foreground: c.variable.slice(1) },
      { token: 'identifier', foreground: c.foreground.slice(1) },
      { token: 'type', foreground: c.type.slice(1) },
      { token: 'type.identifier', foreground: c.type.slice(1) },
      { token: 'delimiter', foreground: c.operator.slice(1) },
      { token: 'delimiter.bracket', foreground: c.bracket.slice(1) },
      { token: 'operator', foreground: c.operator.slice(1) },
      { token: 'tag', foreground: c.keyword.slice(1) },
      { token: 'attribute.name', foreground: c.variable.slice(1) },
      { token: 'attribute.value', foreground: c.string.slice(1) },
    ],
    colors: {
      'editor.background': c.background,
      'editor.foreground': c.foreground,
      'editor.lineHighlightBackground': c.muted,
      'editor.selectionBackground': c.primary + '30',
      'editor.inactiveSelectionBackground': c.accent,
      'editorLineNumber.foreground': c.mutedForeground,
      'editorLineNumber.activeForeground': c.foreground,
      'editorGutter.background': c.background,
      'editorCursor.foreground': c.foreground,
      'editorBracketMatch.background': c.primary + '30',
      'editorBracketMatch.border': c.primary,
      'editorIndentGuide.background': c.border,
      'editorIndentGuide.activeBackground': c.mutedForeground,
      'scrollbarSlider.background': c.mutedForeground + '30',
      'scrollbarSlider.hoverBackground': c.mutedForeground + '50',
      'scrollbarSlider.activeBackground': c.mutedForeground + '70',
      'editorWidget.background': c.background,
      'editorWidget.border': c.border,
      'editorSuggestWidget.background': c.background,
      'editorSuggestWidget.border': c.border,
      'editorSuggestWidget.selectedBackground': c.muted,
      'editorHoverWidget.background': c.background,
      'editorHoverWidget.border': c.border,
    },
  };
}

let themeRegistered = false;
let lightThemeRegistered = false;

/**
 * Register the Solo dark theme with Monaco
 */
export function registerSoloTheme(monaco: typeof Monaco): void {
  if (themeRegistered) return;

  try {
    const themeData = buildMonacoTheme();
    monaco.editor.defineTheme('solo', themeData);
    themeRegistered = true;
  } catch (err) {
    console.error('Failed to register Monaco theme:', err);
  }
}

/**
 * Register the Solo light theme with Monaco
 */
export function registerSoloLightTheme(monaco: typeof Monaco): void {
  if (lightThemeRegistered) return;

  try {
    const themeData = buildMonacoLightTheme();
    monaco.editor.defineTheme('solo-light', themeData);
    lightThemeRegistered = true;
  } catch (err) {
    console.error('Failed to register Monaco light theme:', err);
  }
}

export const SOLO_THEME_NAME = 'solo';
export const SOLO_LIGHT_THEME_NAME = 'solo-light';
