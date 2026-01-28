/**
 * useSyncedScroll - Bidirectional scroll synchronization between Monaco editor and preview pane
 * Uses scroll percentage (scrollTop / maxScroll) to sync both sides proportionally.
 */

import { useEffect, useRef, useCallback, type RefObject } from 'react';
import type * as Monaco from 'monaco-editor';

interface UseSyncedScrollOptions {
  editorRef: RefObject<Monaco.editor.IStandaloneCodeEditor | null>;
  previewRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}

export function useSyncedScroll({
  editorRef,
  previewRef,
  enabled,
}: UseSyncedScrollOptions) {
  // Track which pane initiated the current scroll to prevent feedback loops
  const scrollSourceRef = useRef<'editor' | 'preview' | null>(null);
  const scrollTimeoutRef = useRef<number | null>(null);

  // Sync preview scroll position when editor scrolls
  const syncPreviewToEditor = useCallback(() => {
    if (!enabled || scrollSourceRef.current === 'preview') return;

    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;

    scrollSourceRef.current = 'editor';

    const scrollTop = editor.getScrollTop();
    const scrollHeight = editor.getScrollHeight();
    const clientHeight = editor.getLayoutInfo().height;
    const maxScroll = scrollHeight - clientHeight;

    if (maxScroll <= 0) return;

    const ratio = scrollTop / maxScroll;
    const previewMaxScroll = preview.scrollHeight - preview.clientHeight;
    preview.scrollTop = ratio * previewMaxScroll;

    // Reset scroll source after scroll settles
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = window.setTimeout(() => {
      scrollSourceRef.current = null;
    }, 150);
  }, [enabled, editorRef, previewRef]);

  // Sync editor scroll position when preview scrolls
  const syncEditorToPreview = useCallback(() => {
    if (!enabled || scrollSourceRef.current === 'editor') return;

    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;

    scrollSourceRef.current = 'preview';

    const maxScroll = preview.scrollHeight - preview.clientHeight;
    if (maxScroll <= 0) return;

    const ratio = preview.scrollTop / maxScroll;
    const editorMaxScroll = editor.getScrollHeight() - editor.getLayoutInfo().height;
    editor.setScrollTop(ratio * editorMaxScroll);

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = window.setTimeout(() => {
      scrollSourceRef.current = null;
    }, 150);
  }, [enabled, editorRef, previewRef]);

  // Subscribe to editor scroll events
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !enabled) return;

    const disposable = editor.onDidScrollChange(() => {
      requestAnimationFrame(syncPreviewToEditor);
    });

    return () => disposable.dispose();
  }, [enabled, syncPreviewToEditor, editorRef]);

  // Subscribe to preview scroll events
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !enabled) return;

    const handler = () => requestAnimationFrame(syncEditorToPreview);
    preview.addEventListener('scroll', handler, { passive: true });

    return () => preview.removeEventListener('scroll', handler);
  }, [enabled, syncEditorToPreview, previewRef]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);
}
