/**
 * taskStore — Task Allocator state (Phase 1: manual tasks only).
 *
 * Mirrors the `vaultStore` shape: `Map` keyed by id for O(1) lookup/update,
 * `filter`/`searchQuery` as top-level state, actions that call the Tauri
 * wrapper and patch the map with Immer.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { tasksApi, type Task, type TaskDraft, type TaskPatch, type TaskListFilters } from '@/lib/tauri/tasks';

interface TaskStoreState {
  tasks: Map<string, Task>;
  filter: TaskListFilters;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  selectedTaskId: string | null;
  runningTasks: Set<string>;
  pendingReview: { taskId: string; runId: string; worktreeId: string; diffSummary: string } | null;

  // actions
  load: () => Promise<void>;
  create: (draft: TaskDraft) => Promise<Task>;
  update: (id: string, patch: TaskPatch) => Promise<Task>;
  remove: (id: string) => Promise<void>;
  setFilter: (f: Partial<TaskListFilters>) => void;
  setSearchQuery: (q: string) => void;
  select: (id: string | null) => void;
  /** Called by the event hook on BackendEvent::TasksChanged. */
  patchFromEvent: (taskIds: readonly string[]) => Promise<void>;
  run: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  markRunning: (id: string, running: boolean) => void;
  openReview: (payload: { taskId: string; runId: string; worktreeId: string; diffSummary: string }) => void;
  closeReview: () => void;
  reviewMerge: () => Promise<string>;
  reviewDiscard: () => Promise<void>;
  reviewOpenPr: () => Promise<string>;
  planFromGoal: (goal: string, contextOverride?: string[]) => Promise<string[]>;
  acceptDraft: (id: string) => Promise<void>;
  dismissDraft: (id: string) => Promise<void>;
}

export const useTaskStore = create<TaskStoreState>()(
  immer((set, get) => ({
    tasks: new Map(),
    filter: {},
    searchQuery: '',
    isLoading: false,
    error: null,
    selectedTaskId: null,
    runningTasks: new Set(),
    pendingReview: null,

    load: async () => {
      set((s) => { s.isLoading = true; s.error = null; });
      try {
        const { filter, searchQuery } = get();
        const effective: TaskListFilters = searchQuery
          ? { ...filter, query: searchQuery }
          : filter;
        const list = await tasksApi.list(effective);
        set((s) => {
          s.tasks = new Map(list.map((t) => [t.id, t]));
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => { s.error = String(e); s.isLoading = false; });
      }
    },

    create: async (draft) => {
      const task = await tasksApi.create(draft);
      set((s) => { s.tasks.set(task.id, task); });
      return task;
    },

    update: async (id, patch) => {
      const task = await tasksApi.update(id, patch);
      set((s) => { s.tasks.set(task.id, task); });
      return task;
    },

    remove: async (id) => {
      await tasksApi.delete(id);
      set((s) => {
        s.tasks.delete(id);
        if (s.selectedTaskId === id) s.selectedTaskId = null;
      });
    },

    setFilter: (f) => {
      set((s) => { s.filter = { ...s.filter, ...f }; });
      void get().load();
    },

    setSearchQuery: (q) => {
      set((s) => { s.searchQuery = q; });
      void get().load();
    },

    select: (id) => set((s) => { s.selectedTaskId = id; }),

    patchFromEvent: async (taskIds) => {
      if (taskIds.length === 0) {
        void get().load();
        return;
      }
      // Refetch changed tasks individually so we don't drop filter state.
      for (const id of taskIds) {
        try {
          const task = await tasksApi.get(id);
          set((s) => { s.tasks.set(id, task); });
        } catch {
          set((s) => { s.tasks.delete(id); }); // presumably deleted
        }
      }
    },

    run: async (id) => {
      await tasksApi.run(id);
      // Store will be patched by TaskRunStarted event hook
    },

    cancel: async (id) => {
      await tasksApi.cancel(id);
    },

    markRunning: (id, running) => {
      set((s) => {
        if (running) s.runningTasks.add(id);
        else s.runningTasks.delete(id);
      });
    },

    openReview: (payload) => {
      set((s) => { s.pendingReview = payload; });
    },

    closeReview: () => {
      set((s) => { s.pendingReview = null; });
    },

    reviewMerge: async () => {
      const r = get().pendingReview;
      if (!r) return '';
      const branch = await tasksApi.reviewMerge(r.taskId, r.runId);
      set((s) => { s.pendingReview = null; });
      return branch;
    },

    reviewDiscard: async () => {
      const r = get().pendingReview;
      if (!r) return;
      await tasksApi.reviewDiscard(r.taskId, r.runId);
      set((s) => { s.pendingReview = null; });
    },

    reviewOpenPr: async () => {
      const r = get().pendingReview;
      if (!r) return '';
      return await tasksApi.reviewOpenPr(r.taskId, r.runId);
    },

    planFromGoal: async (goal, contextOverride) => {
      return await tasksApi.planFromGoal(goal, contextOverride);
    },

    acceptDraft: async (id) => {
      await tasksApi.planAcceptDraft(id);
    },

    dismissDraft: async (id) => {
      await tasksApi.planDismissDraft(id);
    },
  })),
);
