/**
 * useAppZoom - Applies the current zoomLevel from uiStore to the Tauri webview.
 *
 * Uses Tauri v2's WebviewWindow.setZoom (native, scales every pixel including px-based
 * layout constants) and falls back to CSS `zoom` on documentElement if the Tauri call
 * fails (e.g., during browser-only dev or older WKWebView builds).
 */

import { useEffect } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useUIStore } from '@/stores/uiStore';

export function useAppZoom(): void {
  const zoomLevel = useUIStore((s) => s.zoomLevel);

  useEffect(() => {
    let cancelled = false;

    const apply = async (): Promise<void> => {
      try {
        await getCurrentWebview().setZoom(zoomLevel);
      } catch {
        // Fallback for non-Tauri contexts or when the API rejects.
        if (!cancelled) {
          (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom =
            String(zoomLevel);
        }
      }
    };

    void apply();
    return () => {
      cancelled = true;
    };
  }, [zoomLevel]);
}
