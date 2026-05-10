/**
 * V1.3 — Native Finder drag-drop forwarding for the vault panel.
 *
 * Tauri v2 emits `onDragDropEvent` at the webview level with {type, paths,
 * position}. Position is in webview pixel coords. We compare it against
 * a caller-provided element ref's bounding rect to decide whether the
 * drop actually landed on the vault panel — otherwise we pass through
 * silently so other drop targets (e.g. agent input) still work.
 *
 * Returns `{ isNativeDragOver }` so the caller can animate the drop zone
 * while the user hovers a real OS drag.
 *
 * Only one webview-level listener is registered per component instance;
 * multiple mounts would stack listeners. The vault panel mounts once per
 * app session so this is safe in practice.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';

interface Options {
  /** Element whose bounding rect defines the "valid drop region". */
  targetRef: RefObject<HTMLElement | null>;
  /** Whether the panel is currently visible — skips forwarding when hidden. */
  enabled?: boolean;
}

interface Result {
  /** True while an OS drag is over the target rect. Use for UI feedback. */
  isNativeDragOver: boolean;
}

export function useVaultDragDrop({ targetRef, enabled = true }: Options): Result {
  const [isNativeDragOver, setIsNativeDragOver] = useState(false);
  const enabledRef = useRef(enabled);
  const targetRefInner = useRef(targetRef);

  // Keep refs fresh without forcing the listener to re-register.
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    targetRefInner.current = targetRef;
  }, [targetRef]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const isInsideTarget = (pos: { x: number; y: number }): boolean => {
      const el = targetRefInner.current.current;
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      // Tauri positions come as DIPs on macOS for the webview — same units as
      // DOMRect. Cheap hit test.
      return (
        pos.x >= rect.left &&
        pos.x <= rect.right &&
        pos.y >= rect.top &&
        pos.y <= rect.bottom
      );
    };

    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (!enabledRef.current) return;
        try {
          const payload = event.payload;

          if (payload.type === 'enter' || payload.type === 'over') {
            // Tauri 2 fires `over` continuously. Only update state on
            // transitions across the target boundary to avoid a storm of
            // React re-renders.
            const inside = isInsideTarget(payload.position);
            setIsNativeDragOver((prev) => (prev === inside ? prev : inside));
            return;
          }

          if (payload.type === 'leave') {
            setIsNativeDragOver(false);
            return;
          }

          if (payload.type === 'drop') {
            setIsNativeDragOver(false);
            const inside = isInsideTarget(payload.position);
            if (!inside) return; // not for us — let other panels handle

            const paths = payload.paths ?? [];
            if (paths.length === 0) return;

            window.dispatchEvent(
              new CustomEvent('solo:vault-files-selected', {
                detail: { paths },
              }),
            );
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[vault] onDragDropEvent handler error:', err);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[vault] failed to register drag-drop listener:', err);
      });

    return () => {
      unlisten?.();
    };
    // Deliberately empty deps — we rely on refs for fresh values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isNativeDragOver };
}
