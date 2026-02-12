/**
 * Singleton git stream listener
 *
 * Listens for git:changes_updated backend events and triggers
 * the git store to re-fetch changes. Follows useTerminalStream pattern.
 */

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BackendEvent } from '../bindings/BackendEvent';
import { useGitStore } from '../stores/gitStore';

export function useGitStream(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<BackendEvent>('backend-event', (event) => {
      const payload = event.payload;

      if (payload.type === 'git:changes_updated') {
        useGitStore.getState().fetchChanges();
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        console.error('Failed to listen to git events:', err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
