/**
 * TasksSection — Task Allocator (Phase 1: manual tasks).
 *
 * Replaces the previous `VaultSectionShell` stub with the real task board:
 * search + group-by filters, Plane-styled grouped list, side drawer for
 * detail editing, and a "New task" creation dialog. Agent runs, scheduling,
 * and LLM-driven planning land in Phases 2-5.
 */

import { useEffect, useState, type FC } from 'react';
import { useTaskStream } from '@/hooks/useTaskStream';
import { useTaskStore } from '@/stores/taskStore';
import { FiltersBar } from '@/components/vault/tasks/FiltersBar';
import { TaskListView } from '@/components/vault/tasks/TaskListView';
import { TaskDrawer } from '@/components/vault/tasks/TaskDrawer';
import { NewTaskDialog } from '@/components/vault/tasks/NewTaskDialog';
import { ReviewModal } from '@/components/vault/tasks/ReviewModal';
import type { GroupKey } from '@/components/vault/tasks/groupings';

export const TasksSection: FC = () => {
  useTaskStream();
  const load = useTaskStore((s) => s.load);

  const [grouping, setGrouping] = useState<GroupKey>('status');
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FiltersBar
        grouping={grouping}
        onGroupingChange={setGrouping}
        onNewTask={() => setNewOpen(true)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TaskListView grouping={grouping} />
      </div>
      <TaskDrawer />
      <NewTaskDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <ReviewModal />
    </div>
  );
};
