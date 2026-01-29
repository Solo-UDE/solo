/**
 * Monaco Editor theme for Solo IDE
 * NeuralForge "Deep Field" aesthetic with high-contrast syntax highlighting
 */

import type * as Monaco from 'monaco-editor';

// NeuralForge Dark theme colors
const darkColors = {
  // Editor chrome (Deep Field hierarchy)
  background: '#0D0D0D',       // --bg-base
  foreground: '#EDEDED',       // Near-white text
  muted: '#161616',            // --bg-surface-1
  mutedForeground: '#4D4D4D',  // Subdued text (line numbers)
  border: '#262626',           // --border-subtle
  primary: '#A8E6CF',          // Solo mint green
  accent: '#1F1F1F',           // --bg-surface-2
  destructive: '#FF6B6B',      // Error red

  // NeuralForge Syntax Palette
  keyword: '#FF5E1E',          // Orange - keywords, control flow
  string: '#E6DB74',           // Yellow - strings
  type: '#66D9EF',             // Cyan - types
  function: '#66D9EF',         // Cyan - functions
  variable: '#CFCFC2',         // Off-white - variables
  comment: '#75715E',          // Olive grey - comments
  number: '#AE81FF',           // Purple - numbers
  control: '#FF5E1E',          // Orange - control keywords
  operator: '#F8F8F2',         // Light - operators
  bracket: '#F8F8F2',          // Light - brackets/delimiters
  tagName: '#F92672',          // Pink - HTML/JSX tags
  attribute: '#A6E22E',        // Green - attributes
  constant: '#AE81FF',         // Purple - constants/booleans
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

      // Keywords (orange)
      { token: 'keyword', foreground: c.keyword.slice(1) },
      { token: 'keyword.control', foreground: c.control.slice(1) },
      { token: 'keyword.operator', foreground: c.operator.slice(1) },
      { token: 'keyword.flow', foreground: c.keyword.slice(1) },

      // Literals
      { token: 'string', foreground: c.string.slice(1) },
      { token: 'string.escape', foreground: c.constant.slice(1) },
      { token: 'string.key', foreground: c.string.slice(1) },
      { token: 'number', foreground: c.number.slice(1) },
      { token: 'number.float', foreground: c.number.slice(1) },
      { token: 'number.hex', foreground: c.number.slice(1) },
      { token: 'constant', foreground: c.constant.slice(1) },
      { token: 'constant.language', foreground: c.constant.slice(1) },
      { token: 'constant.language.boolean', foreground: c.constant.slice(1) },

      // Comments (olive grey, italic)
      { token: 'comment', foreground: c.comment.slice(1), fontStyle: 'italic' },
      { token: 'comment.doc', foreground: c.comment.slice(1), fontStyle: 'italic' },

      // Variables and identifiers
      { token: 'variable', foreground: c.variable.slice(1) },
      { token: 'variable.predefined', foreground: c.type.slice(1) },
      { token: 'variable.parameter', foreground: c.variable.slice(1), fontStyle: 'italic' },
      { token: 'identifier', foreground: c.foreground.slice(1) },

      // Types (cyan)
      { token: 'type', foreground: c.type.slice(1) },
      { token: 'type.identifier', foreground: c.type.slice(1) },
      { token: 'support.type', foreground: c.type.slice(1) },

      // Functions (cyan)
      { token: 'entity.name.function', foreground: c.function.slice(1) },
      { token: 'support.function', foreground: c.function.slice(1) },

      // Operators and delimiters
      { token: 'delimiter', foreground: c.operator.slice(1) },
      { token: 'delimiter.bracket', foreground: c.bracket.slice(1) },
      { token: 'delimiter.parenthesis', foreground: c.bracket.slice(1) },
      { token: 'delimiter.array', foreground: c.bracket.slice(1) },
      { token: 'operator', foreground: c.operator.slice(1) },
      { token: 'punctuation', foreground: c.operator.slice(1) },

      // HTML/JSX (pink tags, green attributes)
      { token: 'tag', foreground: c.tagName.slice(1) },
      { token: 'tag.open', foreground: c.operator.slice(1) },
      { token: 'tag.close', foreground: c.operator.slice(1) },
      { token: 'metatag', foreground: c.tagName.slice(1) },
      { token: 'metatag.content', foreground: c.tagName.slice(1) },
      { token: 'attribute.name', foreground: c.attribute.slice(1) },
      { token: 'attribute.value', foreground: c.string.slice(1) },

      // Decorators/Annotations
      { token: 'annotation', foreground: c.type.slice(1) },
      { token: 'meta.decorator', foreground: c.type.slice(1) },

      // RegExp
      { token: 'regexp', foreground: c.string.slice(1) },
      { token: 'regexp.escape', foreground: c.constant.slice(1) },

      // Markdown
      { token: 'markup.heading', foreground: c.keyword.slice(1), fontStyle: 'bold' },
      { token: 'markup.bold', fontStyle: 'bold' },
      { token: 'markup.italic', fontStyle: 'italic' },
      { token: 'markup.inline.raw', foreground: c.string.slice(1) },
    ],
    colors: {
      // Editor background (Deep Field)
      'editor.background': c.background,
      'editor.foreground': c.foreground,

      // Line highlighting
      'editor.lineHighlightBackground': '#161616',
      'editor.lineHighlightBorder': '#00000000',

      // Selection
      'editor.selectionBackground': c.primary + '33',
      'editor.inactiveSelectionBackground': '#333333',
      'editor.selectionHighlightBackground': c.primary + '1A',

      // Word highlight
      'editor.wordHighlightBackground': '#3A3A3A',
      'editor.wordHighlightStrongBackground': '#4A4A4A',

      // Find match
      'editor.findMatchBackground': c.keyword + '40',
      'editor.findMatchHighlightBackground': c.keyword + '20',

      // Line numbers (subdued)
      'editorLineNumber.foreground': c.mutedForeground,
      'editorLineNumber.activeForeground': '#888888',

      // Gutter
      'editorGutter.background': c.background,
      'editorGutter.addedBackground': '#A6E22E',
      'editorGutter.modifiedBackground': '#E6DB74',
      'editorGutter.deletedBackground': '#F92672',

      // Cursor
      'editorCursor.foreground': c.foreground,

      // Bracket matching (orange border)
      'editorBracketMatch.background': c.keyword + '30',
      'editorBracketMatch.border': c.keyword,

      // Indent guides
      'editorIndentGuide.background': '#262626',
      'editorIndentGuide.activeBackground': '#3A3A3A',

      // Bracket pair colorization
      'editorBracketHighlight.foreground1': '#FFD700',
      'editorBracketHighlight.foreground2': '#DA70D6',
      'editorBracketHighlight.foreground3': '#87CEEB',

      // Scrollbar
      'scrollbarSlider.background': '#4D4D4D40',
      'scrollbarSlider.hoverBackground': '#4D4D4D60',
      'scrollbarSlider.activeBackground': '#4D4D4D80',

      // Widgets
      'editorWidget.background': '#161616',
      'editorWidget.border': c.border,
      'editorWidget.resizeBorder': c.primary,

      // Suggest/Autocomplete widget
      'editorSuggestWidget.background': '#161616',
      'editorSuggestWidget.border': c.border,
      'editorSuggestWidget.foreground': c.foreground,
      'editorSuggestWidget.selectedBackground': '#2A2A2A',
      'editorSuggestWidget.highlightForeground': c.primary,

      // Hover widget
      'editorHoverWidget.background': '#161616',
      'editorHoverWidget.border': c.border,

      // Error/Warning squiggles
      'editorError.foreground': '#FF6B6B',
      'editorWarning.foreground': '#E6DB74',
      'editorInfo.foreground': '#66D9EF',

      // Minimap
      'minimap.background': c.background,
      'minimap.selectionHighlight': c.primary + '80',
      'minimap.findMatchHighlight': c.keyword + '80',

      // Peek view
      'peekView.border': c.primary,
      'peekViewEditor.background': '#161616',
      'peekViewResult.background': '#0D0D0D',
      'peekViewTitle.background': '#161616',
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
