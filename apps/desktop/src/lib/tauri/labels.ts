import { invoke } from '@tauri-apps/api/core';
import type { Label } from '@/bindings/Label';
import type { LabelDraft } from '@/bindings/LabelDraft';
import type { LabelPatch } from '@/bindings/LabelPatch';
import type { Task } from '@/bindings/Task';

export type { Label, LabelDraft, LabelPatch };

export const labelsApi = {
  list:   ()                                  => invoke<Label[]>('label_list'),
  create: (draft: LabelDraft)                 => invoke<Label>('label_create',  { draft }),
  update: (id: string, patch: LabelPatch)     => invoke<Label>('label_update',  { id, patch }),
  delete: (id: string)                        => invoke<void>('label_delete',   { id }),
  taskAdd:    (taskId: string, labelId: string) =>
    invoke<Task>('task_label_add',    { taskId, labelId }),
  taskRemove: (taskId: string, labelId: string) =>
    invoke<Task>('task_label_remove', { taskId, labelId }),
};
