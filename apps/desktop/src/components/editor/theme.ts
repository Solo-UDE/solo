/**
 * CodeMirror dark theme matching SoloIDE UI
 * VS Code-inspired colors on #1e1e1e background
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Editor chrome colors
const colors = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  selection: '#264f78',
  cursor: '#aeafad',
  lineHighlight: '#2a2a2a',
  lineNumbers: '#6e7681',
  lineNumbersActive: '#c6c6c6',
  gutterBorder: '#2d2d2d',
  matchingBracket: '#0d6939',
};

// Syntax colors (VS Code Dark+ inspired)
const syntax = {
  keyword: '#569cd6',
  controlKeyword: '#c586c0',
  operator: '#d4d4d4',
  string: '#ce9178',
  number: '#b5cea8',
  boolean: '#569cd6',
  null: '#569cd6',
  comment: '#6a9955',
  punctuation: '#d4d4d4',
  bracket: '#ffd700',
  function: '#dcdcaa',
  variableName: '#9cdcfe',
  propertyName: '#9cdcfe',
  typeName: '#4ec9b0',
  className: '#4ec9b0',
  namespace: '#4ec9b0',
  macroName: '#569cd6',
  labelName: '#c8c8c8',
  attributeName: '#9cdcfe',
  attributeValue: '#ce9178',
  tag: '#569cd6',
  heading: '#569cd6',
  link: '#3794ff',
  emphasis: '#d4d4d4',
  strong: '#569cd6',
  invalid: '#f44747',
};

/**
 * Editor view theme - controls editor chrome (gutters, selections, etc.)
 */
export const soloEditorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: colors.background,
      color: colors.foreground,
      height: '100%',
    },
    '.cm-content': {
      caretColor: colors.cursor,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '13px',
      lineHeight: '22px',
      padding: '0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: colors.cursor,
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: colors.selection,
      },
    '.cm-activeLine': {
      backgroundColor: colors.lineHighlight,
    },
    '.cm-selectionMatch': {
      backgroundColor: '#515c6a',
    },
    '.cm-matchingBracket': {
      backgroundColor: colors.matchingBracket,
      outline: '1px solid #888',
    },
    '.cm-nonmatchingBracket': {
      backgroundColor: '#4b1818',
    },
    '.cm-gutters': {
      backgroundColor: colors.background,
      borderRight: `1px solid ${colors.gutterBorder}`,
      color: colors.lineNumbers,
    },
    '.cm-activeLineGutter': {
      backgroundColor: colors.lineHighlight,
      color: colors.lineNumbersActive,
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 16px 0 16px',
      minWidth: '48px',
    },
    '.cm-foldGutter .cm-gutterElement': {
      padding: '0 4px',
    },
    '.cm-line': {
      padding: '0 4px 0 4px',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
    '.cm-tooltip': {
      backgroundColor: '#252526',
      border: '1px solid #454545',
      color: colors.foreground,
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': {
        backgroundColor: '#04395e',
        color: colors.foreground,
      },
    },
    '.cm-searchMatch': {
      backgroundColor: '#515c6a',
      outline: '1px solid #74879f',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: '#613214',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-placeholder': {
      color: '#6e7681',
    },
  },
  { dark: true }
);

/**
 * Syntax highlighting theme
 */
const soloHighlightStyle = HighlightStyle.define([
  // Keywords
  { tag: t.keyword, color: syntax.keyword },
  { tag: t.controlKeyword, color: syntax.controlKeyword },
  { tag: t.operatorKeyword, color: syntax.controlKeyword },
  { tag: t.definitionKeyword, color: syntax.keyword },
  { tag: t.moduleKeyword, color: syntax.controlKeyword },

  // Literals
  { tag: t.string, color: syntax.string },
  { tag: t.special(t.string), color: syntax.string },
  { tag: t.regexp, color: syntax.string },
  { tag: t.escape, color: syntax.keyword },
  { tag: t.number, color: syntax.number },
  { tag: t.integer, color: syntax.number },
  { tag: t.float, color: syntax.number },
  { tag: t.bool, color: syntax.boolean },
  { tag: t.null, color: syntax.null },

  // Comments
  { tag: t.comment, color: syntax.comment, fontStyle: 'italic' },
  { tag: t.lineComment, color: syntax.comment, fontStyle: 'italic' },
  { tag: t.blockComment, color: syntax.comment, fontStyle: 'italic' },
  { tag: t.docComment, color: syntax.comment, fontStyle: 'italic' },

  // Names
  { tag: t.variableName, color: syntax.variableName },
  { tag: t.definition(t.variableName), color: syntax.variableName },
  { tag: t.propertyName, color: syntax.propertyName },
  { tag: t.definition(t.propertyName), color: syntax.function },
  { tag: t.function(t.variableName), color: syntax.function },
  { tag: t.function(t.propertyName), color: syntax.function },

  // Types
  { tag: t.typeName, color: syntax.typeName },
  { tag: t.className, color: syntax.className },
  { tag: t.namespace, color: syntax.namespace },
  { tag: t.macroName, color: syntax.macroName },
  { tag: t.labelName, color: syntax.labelName },

  // Operators and punctuation
  { tag: t.operator, color: syntax.operator },
  { tag: t.punctuation, color: syntax.punctuation },
  { tag: t.bracket, color: syntax.bracket },
  { tag: t.paren, color: colors.foreground },
  { tag: t.brace, color: colors.foreground },
  { tag: t.squareBracket, color: colors.foreground },
  { tag: t.angleBracket, color: colors.foreground },
  { tag: t.separator, color: syntax.punctuation },
  { tag: t.derefOperator, color: syntax.operator },

  // HTML/XML
  { tag: t.tagName, color: syntax.tag },
  { tag: t.attributeName, color: syntax.attributeName },
  { tag: t.attributeValue, color: syntax.attributeValue },
  { tag: t.angleBracket, color: '#808080' },
  { tag: t.documentMeta, color: syntax.comment },

  // Markdown
  { tag: t.heading, color: syntax.heading, fontWeight: 'bold' },
  { tag: t.heading1, color: syntax.heading, fontWeight: 'bold', fontSize: '1.4em' },
  { tag: t.heading2, color: syntax.heading, fontWeight: 'bold', fontSize: '1.2em' },
  { tag: t.link, color: syntax.link, textDecoration: 'underline' },
  { tag: t.url, color: syntax.link },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, color: syntax.string },
  { tag: t.quote, color: syntax.string },

  // Meta
  { tag: t.meta, color: syntax.keyword },
  { tag: t.annotation, color: syntax.function },
  { tag: t.processingInstruction, color: syntax.keyword },

  // Invalid
  { tag: t.invalid, color: syntax.invalid },
]);

export const soloSyntaxHighlighting = syntaxHighlighting(soloHighlightStyle);

/**
 * Combined theme (editor chrome + syntax highlighting)
 */
export const soloTheme = [soloEditorTheme, soloSyntaxHighlighting];
