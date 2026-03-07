import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';
import { toast } from 'sonner';
import type { BackendEvent } from '@/bindings/BackendEvent';
import { checkForUpdate, installUpdate } from '@/lib/tauri/update';

export function useUpdateStream(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    listen<BackendEvent>('backend-event', (event) => {
      const payload = event.payload;

      if (payload.type === 'update:available') {
        const { version } = payload.payload;
        toast('New update available', {
          description: 'Restart to use the latest.',
          duration: Infinity,
          action: {
            label: 'Restart',
            onClick: () => {
              toast.promise(installUpdate(), {
                loading: 'Downloading update...',
                success: 'Update installed! Restarting...',
                error: 'Failed to install update',
              });
            },
          },
          cancel: {
            label: 'See changes',
            onClick: () => {
              open(`https://github.com/Solo-UDE/solo/releases/tag/v${version}`);
            },
          },
        });
      }

      if (payload.type === 'update:error') {
        console.error('Update error:', payload.payload.error);
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
        console.error('Failed to listen to update events:', err);
      });

    // Check for updates after a short delay to let the app fully initialize
    const timer = setTimeout(() => {
      if (!cancelled) {
        checkForUpdate().catch((err) => {
          console.debug('Update check skipped:', err);
        });
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, []);
}
