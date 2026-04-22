/**
 * labelStore — the disk-backed Label catalog.
 *
 * Loads the label list from `labelsApi.list()` on first use. All CRUD routes
 * through the API and patches the Map. External mutations (another window,
 * backend tool call) reach the store via the `labels:changed` BackendEvent;
 * the consuming hook calls `patchFromEvent` with the changed ids.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { labelsApi, type Label, type LabelDraft, type LabelPatch } from '@/lib/tauri/labels';

interface LabelStoreState {
  labels: Map<string, Label>;
  isLoading: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (draft: LabelDraft) => Promise<Label>;
  update: (id: string, patch: LabelPatch) => Promise<Label>;
  remove: (id: string) => Promise<void>;
  patchFromEvent: (ids: readonly string[]) => Promise<void>;
}

export const useLabelStore = create<LabelStoreState>()(
  immer((set, get) => ({
    labels: new Map(),
    isLoading: false,
    error: null,

    load: async () => {
      set((s) => { s.isLoading = true; s.error = null; });
      try {
        const list = await labelsApi.list();
        set((s) => {
          s.labels = new Map(list.map((l) => [l.id, l]));
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => { s.error = String(e); s.isLoading = false; });
      }
    },

    create: async (draft) => {
      const label = await labelsApi.create(draft);
      set((s) => { s.labels.set(label.id, label); });
      return label;
    },

    update: async (id, patch) => {
      const label = await labelsApi.update(id, patch);
      set((s) => { s.labels.set(label.id, label); });
      return label;
    },

    remove: async (id) => {
      await labelsApi.delete(id);
      set((s) => { s.labels.delete(id); });
    },

    patchFromEvent: async (ids) => {
      if (ids.length === 0) {
        await get().load();
        return;
      }
      // Cheap: refetch the whole list. Label sets are small.
      await get().load();
    },
  })),
);
