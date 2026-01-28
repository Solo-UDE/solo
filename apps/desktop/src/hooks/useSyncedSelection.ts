/**
 * useSyncedSelection - Sync text selection from preview pane to Monaco editor
 * When text is selected in the preview, finds and selects matching text in the source.
 */

import { useEffect, useCallback, type RefObject } from 'react';
import type * as Monaco from 'monaco-editor';

interface UseSyncedSelectionOptions {
  editorRef: RefObject<Monaco.editor.IStandaloneCodeEditor | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}

export function useSyncedSelection({
  editorRef,
  previewRef,
  enabled,
}: UseSyncedSelectionOptions) {
  const syncSelectionToEditor = useCallback(() => {
    if (!enabled) return;

    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    // Check if selection is within the preview pane
    const range = selection.getRangeAt(0);
    if (!preview.contains(range.commonAncestorContainer)) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Find the selected text in the editor source
    const model = editor.getModel();
    if (!model) return;

    const sourceText = model.getValue();

    // Try to find an exact match first
    let matchIndex = sourceText.indexOf(selectedText);

    // If no exact match, try normalized whitespace matching
    if (matchIndex === -1) {
      const normalizedSelected = selectedText.replace(/\s+/g, ' ');
      const normalizedSource = sourceText.replace(/\s+/g, ' ');
      const normalizedIndex = normalizedSource.indexOf(normalizedSelected);

      if (normalizedIndex !== -1) {
        // Map back to original source position (approximate)
        let sourcePos = 0;
        let normalizedPos = 0;
        while (normalizedPos < normalizedIndex && sourcePos < sourceText.length) {
          if (/\s/.test(sourceText[sourcePos])) {
            // Skip extra whitespace in source
            while (sourcePos < sourceText.length - 1 && /\s/.test(sourceText[sourcePos + 1])) {
              sourcePos++;
            }
          }
          sourcePos++;
          normalizedPos++;
        }
        matchIndex = sourcePos;
      }
    }

    if (matchIndex === -1) return;

    // Convert string index to line/column position
    const startPosition = model.getPositionAt(matchIndex);
    const endPosition = model.getPositionAt(matchIndex + selectedText.length);

    // Select the text in the editor
    editor.setSelection({
      startLineNumber: startPosition.lineNumber,
      startColumn: startPosition.column,
      endLineNumber: endPosition.lineNumber,
      endColumn: endPosition.column,
    });

    // Reveal the selection in the editor
    editor.revealRangeInCenter({
      startLineNumber: startPosition.lineNumber,
      startColumn: startPosition.column,
      endLineNumber: endPosition.lineNumber,
      endColumn: endPosition.column,
    });

    // Focus the editor so the selection is visible
    editor.focus();
  }, [enabled, editorRef, previewRef]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !enabled) return;

    // Use mouseup to detect when selection is complete
    const handleMouseUp = () => {
      // Small delay to ensure selection is finalized
      requestAnimationFrame(() => {
        syncSelectionToEditor();
      });
    };

    preview.addEventListener('mouseup', handleMouseUp);

    return () => {
      preview.removeEventListener('mouseup', handleMouseUp);
    };
  }, [enabled, syncSelectionToEditor, previewRef]);
}
