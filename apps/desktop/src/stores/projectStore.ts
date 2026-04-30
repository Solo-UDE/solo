/**
 * projectStore — the Project catalog.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  projectsApi,
  type Project,
  type ProjectDraft,
  type ProjectPatch,
} from '@/lib/tauri/projects';

interface ProjectStoreState {
  projects: Map<string, Project>;
  isLoading: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (draft: ProjectDraft) => Promise<Project>;
  update: (id: string, patch: ProjectPatch) => Promise<Project>;
  remove: (id: string) => Promise<void>;
  patchFromEvent: (ids: readonly string[]) => Promise<void>;
}

export const useProjectStore = create<ProjectStoreState>()(
  immer((set, get) => ({
    projects: new Map(),
    isLoading: false,
    error: null,

    load: async () => {
      set((s) => { s.isLoading = true; s.error = null; });
      try {
        const list = await projectsApi.list();
        set((s) => {
          s.projects = new Map(list.map((p) => [p.id, p]));
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => { s.error = String(e); s.isLoading = false; });
      }
    },

    create: async (draft) => {
      const project = await projectsApi.create(draft);
      set((s) => { s.projects.set(project.id, project); });
      return project;
    },

    update: async (id, patch) => {
      const project = await projectsApi.update(id, patch);
      set((s) => { s.projects.set(project.id, project); });
      return project;
    },

    remove: async (id) => {
      await projectsApi.delete(id);
      set((s) => { s.projects.delete(id); });
    },

    patchFromEvent: async (ids) => {
      if (ids.length === 0) {
        await get().load();
        return;
      }
      for (const id of ids) {
        try {
          const project = await projectsApi.get(id);
          set((s) => { s.projects.set(id, project); });
        } catch {
          set((s) => { s.projects.delete(id); });
        }
      }
    },
  })),
);
