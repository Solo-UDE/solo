import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BackendEvent } from '@/bindings/BackendEvent';
import { useTaskStore } from '@/stores/taskStore';

export function useTaskStream(): void {
  const patchFromEvent = useTaskStore((s) => s.patchFromEvent);
  const markRunning = useTaskStore((s) => s.markRunning);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    const setup = async () => {
      unlisten = await listen<BackendEvent>('backend-event', (e) => {
        const ev = e.payload;
        switch (ev.type) {
          case 'tasks:changed':
            void patchFromEvent(ev.payload.task_ids);
            break;
          case 'tasks:run_started':
            markRunning(ev.payload.task_id, true);
            void patchFromEvent([ev.payload.task_id]);
            break;
          case 'tasks:run_progress':
            void patchFromEvent([ev.payload.task_id]);
            break;
          case 'tasks:run_ended':
            markRunning(ev.payload.task_id, false);
            void patchFromEvent([ev.payload.task_id]);
            break;
          default:
            break;
        }
      });
    };
    void setup();
    return () => { unlisten?.(); };
  }, [patchFromEvent, markRunning]);
}
