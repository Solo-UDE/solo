/**
 * cycleStore — the Cycle catalog.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { cyclesApi, type Cycle, type CycleDraft, type CyclePatch } from '@/lib/tauri/cycles';

interface CycleStoreState {
  cycles: Map<string, Cycle>;
  isLoading: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (draft: CycleDraft) => Promise<Cycle>;
  update: (id: string, patch: CyclePatch) => Promise<Cycle>;
  remove: (id: string) => Promise<void>;
  patchFromEvent: (ids: readonly string[]) => Promise<void>;
}

export const useCycleStore = create<CycleStoreState>()(
  immer((set, get) => ({
    cycles: new Map(),
    isLoading: false,
    error: null,

    load: async () => {
      set((s) => { s.isLoading = true; s.error = null; });
      try {
        const list = await cyclesApi.list();
        set((s) => {
          s.cycles = new Map(list.map((c) => [c.id, c]));
          s.isLoading = false;
        });
      } catch (e) {
        set((s) => { s.error = String(e); s.isLoading = false; });
      }
    },

    create: async (draft) => {
      const cycle = await cyclesApi.create(draft);
      set((s) => { s.cycles.set(cycle.id, cycle); });
      return cycle;
    },

    update: async (id, patch) => {
      const cycle = await cyclesApi.update(id, patch);
      set((s) => { s.cycles.set(cycle.id, cycle); });
      return cycle;
    },

    remove: async (id) => {
      await cyclesApi.delete(id);
      set((s) => { s.cycles.delete(id); });
    },

    patchFromEvent: async (ids) => {
      if (ids.length === 0) {
        await get().load();
        return;
      }
      // Refresh the whole list — cycle counts are small.
      await get().load();
    },
  })),
);
