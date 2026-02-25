/**
 * Singleton git stream listener
 *
 * Listens for git:changes_updated backend events AND file watcher events
 * (file:created, file:changed, file:deleted) to trigger the git store
 * to re-fetch changes. File events are debounced to avoid excessive refreshes.
 *
 * Follows useTerminalStream pattern.
 */

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BackendEvent } from '../bindings/BackendEvent';
import { useGitStore } from '../stores/gitStore';

const FILE_EVENT_DEBOUNCE_MS = 500;

export function useGitStream(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    let fileEventTimer: ReturnType<typeof setTimeout> | null = null;

    const debouncedFetchChanges = () => {
      if (fileEventTimer) clearTimeout(fileEventTimer);
      fileEventTimer = setTimeout(() => {
        useGitStore.getState().fetchChanges();
      }, FILE_EVENT_DEBOUNCE_MS);
    };

    listen<BackendEvent>('backend-event', (event) => {
      const payload = event.payload;

      if (payload.type === 'git:changes_updated') {
        // Explicit git operations: refresh immediately
        useGitStore.getState().fetchChanges();
      } else if (
        payload.type === 'file:created' ||
        payload.type === 'file:changed' ||
        payload.type === 'file:deleted'
      ) {
        // File watcher events: debounced refresh
        debouncedFetchChanges();
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
      if (fileEventTimer) clearTimeout(fileEventTimer);
    };
  }, []);
}
