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
import { TaskKanbanView } from '@/components/vault/tasks/TaskKanbanView';
import { TaskCalendarView } from '@/components/vault/tasks/TaskCalendarView';
import { TaskDrawer } from '@/components/vault/tasks/TaskDrawer';
import { NewTaskDialog } from '@/components/vault/tasks/NewTaskDialog';
import { NewPlanDialog } from '@/components/vault/tasks/NewPlanDialog';
import { ReviewModal } from '@/components/vault/tasks/ReviewModal';
import { TasksSettingsModal } from '@/components/vault/tasks/TasksSettingsModal';
import type { GroupKey } from '@/components/vault/tasks/groupings';
import type { ViewKind } from '@/components/vault/tasks/ViewToggle';

export const TasksSection: FC = () => {
  useTaskStream();
  const load = useTaskStore((s) => s.load);

  const [grouping, setGrouping] = useState<GroupKey>('status');
  const [view, setView] = useState<ViewKind>('list');
  const [newOpen, setNewOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <FiltersBar
        grouping={grouping}
        onGroupingChange={setGrouping}
        view={view}
        onViewChange={setView}
        onNewTask={() => setNewOpen(true)}
        onNewPlan={() => setPlanOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'list' && <TaskListView grouping={grouping} />}
        {view === 'kanban' && <TaskKanbanView grouping={grouping} />}
        {view === 'calendar' && <TaskCalendarView />}
      </div>
      <TaskDrawer />
      <NewTaskDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <NewPlanDialog open={planOpen} onClose={() => setPlanOpen(false)} />
      <TasksSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ReviewModal />
    </div>
  );
};
