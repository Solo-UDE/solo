import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BackendEvent } from '@/bindings/BackendEvent';
import { useTaskStore } from '@/stores/taskStore';
import { useLabelStore } from '@/stores/labelStore';
import { useProjectStore } from '@/stores/projectStore';
import { useCycleStore } from '@/stores/cycleStore';

/**
 * Subscribes the task, label, project, and cycle stores to their respective
 * `BackendEvent` streams. A single `backend-event` listener fan-outs to the
 * stores via their `patchFromEvent` actions.
 */
export function useTaskStream(): void {
  const patchFromEvent = useTaskStore((s) => s.patchFromEvent);
  const markRunning = useTaskStore((s) => s.markRunning);
  const openReview = useTaskStore((s) => s.openReview);
  const patchLabels = useLabelStore((s) => s.patchFromEvent);
  const patchProjects = useProjectStore((s) => s.patchFromEvent);
  const patchCycles = useCycleStore((s) => s.patchFromEvent);

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
          case 'tasks:review_ready':
            openReview({
              taskId: ev.payload.task_id,
              runId: ev.payload.run_id,
              worktreeId: ev.payload.worktree_id,
              diffSummary: ev.payload.diff_summary,
            });
            void patchFromEvent([ev.payload.task_id]);
            break;
          case 'labels:changed':
            void patchLabels(ev.payload.label_ids);
            break;
          case 'projects:changed':
            void patchProjects(ev.payload.project_ids);
            break;
          case 'cycles:changed':
            void patchCycles(ev.payload.cycle_ids);
            break;
          default:
            break;
        }
      });
    };
    void setup();
    return () => { unlisten?.(); };
  }, [patchFromEvent, markRunning, openReview, patchLabels, patchProjects, patchCycles]);
}
