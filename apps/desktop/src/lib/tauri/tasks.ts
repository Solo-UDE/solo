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
export type { AgentConfig } from '@/bindings/AgentConfig';
export type { AgentPermissionMode } from '@/bindings/AgentPermissionMode';
export type { ExecutionLocation } from '@/bindings/ExecutionLocation';
export type { Schedule } from '@/bindings/Schedule';
export type { PresetKind } from '@/bindings/PresetKind';
export type { EventKind } from '@/bindings/EventKind';

export const tasksApi = {
  list:   (filter?: TaskListFilters)               => invoke<Task[]>('task_list',   { filter }),
  get:    (id: string)                             => invoke<Task>('task_get',     { id }),
  create: (draft: TaskDraft)                       => invoke<Task>('task_create',  { draft }),
  update: (id: string, patch: TaskPatch)           => invoke<Task>('task_update',  { id, patch }),
  delete: (id: string)                             => invoke<void>('task_delete',  { id }),
  search: (query: string)                          => invoke<Task[]>('task_search', { query }),
  run:    (id: string)                             => invoke<string>('task_run',    { id }),
  cancel: (id: string)                             => invoke<void>('task_cancel',  { id }),
  reviewMerge:   (id: string, runId: string)       => invoke<string>('task_review_merge',   { id, runId }),
  reviewDiscard: (id: string, runId: string)       => invoke<void>('task_review_discard',   { id, runId }),
  reviewOpenPr:  (id: string, runId: string)       => invoke<string>('task_review_open_pr', { id, runId }),
  schedulePreview: (schedule: import('@/bindings/Schedule').Schedule) => invoke<number[]>('task_schedule_preview', { schedule }),
};
