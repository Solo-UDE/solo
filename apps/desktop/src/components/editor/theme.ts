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

let themeRegistered = false;

/**
 * Register the Solo theme with Monaco
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

export const SOLO_THEME_NAME = 'solo';
