/**
 * Monaco Editor theme for Solo IDE
 * Uses static colors matching the design system for reliability
 */

import type * as Monaco from 'monaco-editor';

// Dark theme colors (matching index.css dark mode)
const darkColors = {
  background: '#1a1816',
  foreground: '#ede9e3',
  muted: '#252220',
  mutedForeground: '#7a756f',
  border: '#252220',
  primary: '#c8763a',
  accent: '#302c28',
  destructive: '#d4644a',
  // Syntax
  keyword: '#4a9de8',
  string: '#e8924a',
  type: '#2abca8',
  function: '#c8b438',
  variable: '#6aaad4',
  comment: '#6a9c6a',
  number: '#7ab84a',
  control: '#c874d4',
  operator: '#ddd9d4',
  bracket: '#c8a830',
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
      'editor.lineHighlightBackground': '#201e1c',
      'editor.selectionBackground': c.primary + '4D',
      'editor.inactiveSelectionBackground': c.accent + '33',
      'editorLineNumber.foreground': c.mutedForeground,
      'editorLineNumber.activeForeground': c.foreground,
      'editorGutter.background': '#1a1816',
      'editorCursor.foreground': c.foreground,
      'editorBracketMatch.background': c.primary + '40',
      'editorBracketMatch.border': c.primary,
      'editorIndentGuide.background': c.border,
      'editorIndentGuide.activeBackground': c.mutedForeground,
      'scrollbarSlider.background': '#7a756f20',
      'scrollbarSlider.hoverBackground': c.mutedForeground + '40',
      'scrollbarSlider.activeBackground': c.mutedForeground + '60',
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
  background: '#faf8f6',
  foreground: '#2a2520',
  muted: '#f0ece6',
  mutedForeground: '#7a756f',
  border: '#e0dcd6',
  primary: '#c8763a',
  accent: '#f0ece6',
  destructive: '#d4644a',
  // Syntax
  keyword: '#1470b8',
  string: '#c0541e',
  type: '#0a8878',
  function: '#806010',
  variable: '#1e5a94',
  comment: '#5a8a5a',
  number: '#4a8a24',
  control: '#9a4aaa',
  operator: '#4a4540',
  bracket: '#907418',
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
