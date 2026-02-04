/**
 * useSyncedSelection - Sync clicks and text selection from preview pane to Monaco editor.
 * Uses data-source-line attributes (set by rehype-source-lines) for precise line mapping,
 * avoiding the fragile indexOf approach that fails on repeated text.
 */

import { useEffect, useCallback, useRef } from 'react';
import type * as Monaco from 'monaco-editor';

interface UseSyncedSelectionOptions {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  previewElement: HTMLDivElement | null;
  enabled: boolean;
}

/** Walk up from target to find the nearest ancestor with a data-source-line attribute. */
function findSourceLine(target: HTMLElement, container: HTMLElement): number | null {
  let el: HTMLElement | null = target;
  while (el && el !== container) {
    const line = el.dataset.sourceLine;
    if (line) return parseInt(line, 10);
    el = el.parentElement;
  }
  return null;
}

function findSourceEndLine(target: HTMLElement, container: HTMLElement): number | null {
  let el: HTMLElement | null = target;
  while (el && el !== container) {
    const line = el.dataset.sourceEndLine;
    if (line) return parseInt(line, 10);
    el = el.parentElement;
  }
  return null;
}

const DECORATION_CLEAR_MS = 3000;

export function useSyncedSelection({
  editor,
  previewElement,
  enabled,
}: UseSyncedSelectionOptions) {
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  const clearDecorations = useCallback(() => {
    if (decorationsRef.current) {
      decorationsRef.current.clear();
      decorationsRef.current = null;
    }
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);

  // Click-to-cursor: jump editor to the source line of the clicked preview element.
  const handleClickToCursor = useCallback(
    (e: MouseEvent) => {
      if (!enabled || !editor || !previewElement) return;

      // Only handle simple clicks (not selection drags)
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;

      const target = e.target as HTMLElement;
      if (!target || !previewElement.contains(target)) return;

      const sourceLine = findSourceLine(target, previewElement);
      if (sourceLine == null) return;

      const model = editor.getModel();
      if (!model) return;

      clearDecorations();

      const position = { lineNumber: sourceLine, column: 1 };
      editor.setPosition(position);
      editor.revealPositionInCenter(position);
      editor.focus();
    },
    [enabled, editor, previewElement, clearDecorations]
  );

  // Selection sync: highlight the matching source range using Monaco decorations.
  const syncSelectionToEditor = useCallback(() => {
    if (!enabled || !editor || !previewElement) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (!previewElement.contains(range.commonAncestorContainer)) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Find source line range from selection start and end containers
    const startNode = range.startContainer instanceof HTMLElement
      ? range.startContainer
      : range.startContainer.parentElement;
    const endNode = range.endContainer instanceof HTMLElement
      ? range.endContainer
      : range.endContainer.parentElement;

    if (!startNode || !endNode) return;

    const startLine = findSourceLine(startNode, previewElement);
    const endLine = findSourceEndLine(endNode, previewElement) ?? findSourceLine(endNode, previewElement);

    if (startLine == null || endLine == null) return;

    const model = editor.getModel();
    if (!model) return;

    // Scoped search: look for selected text only within the source line range
    const lineCount = model.getLineCount();
    const clampedStart = Math.max(1, startLine);
    const clampedEnd = Math.min(lineCount, endLine);

    const rangeText = model.getValueInRange({
      startLineNumber: clampedStart,
      startColumn: 1,
      endLineNumber: clampedEnd,
      endColumn: model.getLineMaxColumn(clampedEnd),
    });

    const matchIndex = rangeText.indexOf(selectedText);

    clearDecorations();

    if (matchIndex !== -1) {
      // Map match back to absolute model position
      const absStart = model.getPositionAt(
        model.getOffsetAt({ lineNumber: clampedStart, column: 1 }) + matchIndex
      );
      const absEnd = model.getPositionAt(
        model.getOffsetAt({ lineNumber: clampedStart, column: 1 }) + matchIndex + selectedText.length
      );

      decorationsRef.current = editor.createDecorationsCollection([
        {
          range: {
            startLineNumber: absStart.lineNumber,
            startColumn: absStart.column,
            endLineNumber: absEnd.lineNumber,
            endColumn: absEnd.column,
          },
          options: {
            className: 'synced-selection-highlight',
            isWholeLine: false,
          },
        },
      ]);

      editor.revealRangeInCenter({
        startLineNumber: absStart.lineNumber,
        startColumn: absStart.column,
        endLineNumber: absEnd.lineNumber,
        endColumn: absEnd.column,
      });
    } else {
      // Fallback: highlight the entire source line range
      decorationsRef.current = editor.createDecorationsCollection([
        {
          range: {
            startLineNumber: clampedStart,
            startColumn: 1,
            endLineNumber: clampedEnd,
            endColumn: model.getLineMaxColumn(clampedEnd),
          },
          options: {
            className: 'synced-selection-highlight',
            isWholeLine: true,
          },
        },
      ]);

      editor.revealLineInCenter(clampedStart);
    }

    // Auto-clear decorations after timeout
    clearTimerRef.current = window.setTimeout(clearDecorations, DECORATION_CLEAR_MS);
  }, [enabled, editor, previewElement, clearDecorations]);

  useEffect(() => {
    if (!previewElement || !enabled) return;

    const handleMouseUp = () => {
      requestAnimationFrame(() => {
        syncSelectionToEditor();
      });
    };

    const handleClick = (e: MouseEvent) => {
      requestAnimationFrame(() => {
        handleClickToCursor(e);
      });
    };

    previewElement.addEventListener('mouseup', handleMouseUp);
    previewElement.addEventListener('click', handleClick);

    return () => {
      previewElement.removeEventListener('mouseup', handleMouseUp);
      previewElement.removeEventListener('click', handleClick);
    };
  }, [enabled, syncSelectionToEditor, handleClickToCursor, previewElement]);

  // Clear decorations on any editor interaction
  useEffect(() => {
    if (!editor || !enabled) return;

    const disposable = editor.onDidChangeCursorPosition(() => {
      clearDecorations();
    });

    return () => disposable.dispose();
  }, [editor, enabled, clearDecorations]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearDecorations();
    };
  }, [clearDecorations]);
}
