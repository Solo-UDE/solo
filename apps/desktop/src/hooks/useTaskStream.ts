import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BackendEvent } from '@/bindings/BackendEvent';
import { useTaskStore } from '@/stores/taskStore';

/**
 * Subscribes to backend-event and patches the task store on TasksChanged.
 * Mount once in the top-level Tasks tab.
 */
export function useTaskStream(): void {
  const patchFromEvent = useTaskStore((s) => s.patchFromEvent);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    const setup = async () => {
      unlisten = await listen<BackendEvent>('backend-event', (e) => {
        const ev = e.payload;
        if (ev.type === 'tasks:changed') {
          void patchFromEvent(ev.payload.task_ids);
        }
      });
    };
    void setup();
    return () => { unlisten?.(); };
  }, [patchFromEvent]);
}
