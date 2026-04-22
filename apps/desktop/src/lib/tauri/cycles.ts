import { invoke } from '@tauri-apps/api/core';
import type { Cycle } from '@/bindings/Cycle';
import type { CycleDraft } from '@/bindings/CycleDraft';
import type { CyclePatch } from '@/bindings/CyclePatch';

export type { Cycle, CycleDraft, CyclePatch };

export const cyclesApi = {
  list:   ()                                => invoke<Cycle[]>('cycle_list'),
  create: (draft: CycleDraft)               => invoke<Cycle>('cycle_create',  { draft }),
  update: (id: string, patch: CyclePatch)   => invoke<Cycle>('cycle_update',  { id, patch }),
  delete: (id: string)                      => invoke<void>('cycle_delete',   { id }),
};
