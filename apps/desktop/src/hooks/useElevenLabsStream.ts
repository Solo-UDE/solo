/**
 * Singleton ElevenLabs event stream listener
 *
 * Sets up ONE Tauri event listener for all elevenlabs:* events.
 * Dispatches to the ElevenLabs store's handlers.
 *
 * Follows the same ref-based proxy pattern as useAgentStream.ts.
 */

import { useEffect, useRef } from 'react';
import { useElevenLabsStore } from '@/stores/elevenlabsStore';
import {
  listenToElevenLabsEvents,
  type ElevenLabsEventHandlers,
} from '@/lib/tauri/elevenlabs';

interface UseElevenLabsStreamOptions {
  enabled?: boolean;
}

export function useElevenLabsStream(
  options: UseElevenLabsStreamOptions = {},
): void {
  const { enabled = true } = options;

  const handlersRef = useRef<ElevenLabsEventHandlers>({});

  // Update ref on every render to always point to latest store actions
  handlersRef.current = {
    onSttPartial: useElevenLabsStore((s) => s.handleSttPartial),
    onSttCommitted: useElevenLabsStore((s) => s.handleSttCommitted),
    onSttStatus: useElevenLabsStore((s) => s.handleSttStatus),
    onTtsAudio: useElevenLabsStore((s) => s.handleTtsAudio),
    onTtsStatus: useElevenLabsStore((s) => s.handleTtsStatus),
  };

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    // Proxy delegates through ref for latest store actions
    const proxy: ElevenLabsEventHandlers = {
      onSttPartial: (event) => handlersRef.current.onSttPartial?.(event),
      onSttCommitted: (event) => handlersRef.current.onSttCommitted?.(event),
      onSttStatus: (event) => handlersRef.current.onSttStatus?.(event),
      onTtsAudio: (event) => handlersRef.current.onTtsAudio?.(event),
      onTtsStatus: (event) => handlersRef.current.onTtsStatus?.(event),
    };

    listenToElevenLabsEvents(proxy)
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch((error) => {
        console.error('Failed to listen to ElevenLabs events:', error);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);
}
