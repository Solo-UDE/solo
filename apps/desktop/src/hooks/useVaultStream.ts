/**
 * Singleton vault stream listener.
 *
 * Listens for vault:* BackendEvent variants and mirrors them into the vault
 * store. Mount once at the app root.
 */

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BackendEvent } from '../bindings/BackendEvent';
import { useVaultStore } from '../stores/vaultStore';
import { vaultGet } from '../lib/tauri/vault';

export function useVaultStream(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<BackendEvent>('backend-event', async (event) => {
      const evt = event.payload;
      const store = useVaultStore.getState();

      switch (evt.type) {
        case 'vault:entry_added':
        case 'vault:entry_updated': {
          const entry = await vaultGet(evt.payload.entry_id).catch(() => null);
          if (entry) store.upsertEntry(entry);
          break;
        }
        case 'vault:entry_deleted': {
          store.removeEntry(evt.payload.entry_id);
          break;
        }
        case 'vault:index_progress': {
          const existing = useVaultStore.getState().entries.get(evt.payload.entry_id);
          if (existing) {
            void vaultGet(evt.payload.entry_id).then((entry) => {
              if (entry) store.upsertEntry(entry);
            });
          }
          break;
        }
        case 'vault:cloud_sync_updated': {
          const existing = useVaultStore.getState().entries.get(evt.payload.entry_id);
          if (existing) {
            store.upsertEntry({ ...existing, cloud_sync_state: evt.payload.state });
          }
          break;
        }
        case 'vault:unsorted_count_changed': {
          useVaultStore.setState({ unsortedCount: evt.payload.count });
          break;
        }
        default:
          break;
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
        console.error('Failed to listen to vault events:', err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
