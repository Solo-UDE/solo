/**
 * useSyncedScroll - Bidirectional scroll synchronization between Monaco editor and preview pane
 * Uses scroll percentage (scrollTop / maxScroll) to sync both sides proportionally.
 */

import { useEffect, useRef, useCallback } from 'react';
import type * as Monaco from 'monaco-editor';

interface UseSyncedScrollOptions {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  previewElement: HTMLDivElement | null;
  enabled: boolean;
}

export function useSyncedScroll({
  editor,
  previewElement,
  enabled,
}: UseSyncedScrollOptions) {
  // Track which pane initiated the current scroll to prevent feedback loops
  const scrollSourceRef = useRef<'editor' | 'preview' | null>(null);
  const scrollTimeoutRef = useRef<number | null>(null);
  const prevEnabledRef = useRef(false);

  // Sync preview scroll position when editor scrolls
  const syncPreviewToEditor = useCallback(() => {
    if (!enabled || scrollSourceRef.current === 'preview') return;
    if (!editor || !previewElement) return;

    const preview = previewElement;

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
  }, [enabled, editor, previewElement]);

  // Sync editor scroll position when preview scrolls
  const syncEditorToPreview = useCallback(() => {
    if (!enabled || scrollSourceRef.current === 'editor') return;
    if (!editor || !previewElement) return;

    const preview = previewElement;

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
  }, [enabled, editor, previewElement]);

  // Initial sync when enabled transitions to true (delay past split-pane animation)
  useEffect(() => {
    if (!enabled || !editor || !previewElement) {
      prevEnabledRef.current = enabled;
      return;
    }
    if (!prevEnabledRef.current) {
      const timer = window.setTimeout(() => syncPreviewToEditor(), 350);
      prevEnabledRef.current = true;
      return () => clearTimeout(timer);
    }
    prevEnabledRef.current = enabled;
  }, [enabled, editor, previewElement, syncPreviewToEditor]);

  // ResizeObserver: re-sync when preview scroll dimensions change (Shiki load, images, animation)
  useEffect(() => {
    if (!enabled || !previewElement) return;
    const observer = new ResizeObserver(() => {
      if (scrollSourceRef.current === null) {
        requestAnimationFrame(syncPreviewToEditor);
      }
    });
    observer.observe(previewElement);
    return () => observer.disconnect();
  }, [enabled, previewElement, syncPreviewToEditor]);

  // Subscribe to editor scroll events
  useEffect(() => {
    if (!editor || !enabled) return;

    const disposable = editor.onDidScrollChange(() => {
      requestAnimationFrame(syncPreviewToEditor);
    });

    return () => disposable.dispose();
  }, [enabled, syncPreviewToEditor, editor]);

  // Subscribe to preview scroll events
  useEffect(() => {
    if (!previewElement || !enabled) return;

    const handler = () => requestAnimationFrame(syncEditorToPreview);
    previewElement.addEventListener('scroll', handler, { passive: true });

    return () => previewElement.removeEventListener('scroll', handler);
  }, [enabled, syncEditorToPreview, previewElement]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);
}
