import { invoke } from '@tauri-apps/api/core';
import type { Task } from '@/bindings/Task';
import type { TaskDraft } from '@/bindings/TaskDraft';
import type { TaskPatch } from '@/bindings/TaskPatch';
import type { TaskListFilters } from '@/bindings/TaskListFilters';

export type { Task, TaskDraft, TaskPatch, TaskListFilters };
export type { TaskStatus } from '@/bindings/TaskStatus';
export type { Executor } from '@/bindings/Executor';
export type { TaskPriority } from '@/bindings/TaskPriority';
export type { TaskOrigin } from '@/bindings/TaskOrigin';
export type { TaskRun } from '@/bindings/TaskRun';
export type { RunOutcome } from '@/bindings/RunOutcome';
export type { ContextAnchor } from '@/bindings/ContextAnchor';

export const tasksApi = {
  list:   (filter?: TaskListFilters)               => invoke<Task[]>('task_list',   { filter }),
  get:    (id: string)                             => invoke<Task>('task_get',     { id }),
  create: (draft: TaskDraft)                       => invoke<Task>('task_create',  { draft }),
  update: (id: string, patch: TaskPatch)           => invoke<Task>('task_update',  { id, patch }),
  delete: (id: string)                             => invoke<void>('task_delete',  { id }),
  search: (query: string)                          => invoke<Task[]>('task_search', { query }),
};
