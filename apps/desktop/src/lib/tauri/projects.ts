import { invoke } from '@tauri-apps/api/core';
import type { Project } from '@/bindings/Project';
import type { ProjectDraft } from '@/bindings/ProjectDraft';
import type { ProjectPatch } from '@/bindings/ProjectPatch';

export type { Project, ProjectDraft, ProjectPatch };
export type { ProjectStatus } from '@/bindings/ProjectStatus';
export type { ProjectHealth } from '@/bindings/ProjectHealth';

export const projectsApi = {
  list:   ()                                    => invoke<Project[]>('project_list'),
  get:    (id: string)                          => invoke<Project>('project_get',    { id }),
  create: (draft: ProjectDraft)                 => invoke<Project>('project_create', { draft }),
  update: (id: string, patch: ProjectPatch)     => invoke<Project>('project_update', { id, patch }),
  delete: (id: string)                          => invoke<void>('project_delete',    { id }),
};
