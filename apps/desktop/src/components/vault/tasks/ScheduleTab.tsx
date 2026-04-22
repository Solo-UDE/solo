import type { FC } from 'react';
import { useTaskStore } from '@/stores/taskStore';
import { ScheduleEditor } from './ScheduleEditor';
import type { Task } from '@/lib/tauri/tasks';

interface Props { readonly task: Task }

export const ScheduleTab: FC<Props> = ({ task }) => {
  const update = useTaskStore((s) => s.update);
  return (
    <div className="flex flex-col gap-3 p-1">
      <ScheduleEditor
        value={task.schedule ?? null}
        onChange={(next) => void update(task.id, { schedule: next ?? undefined })}
      />
      <label className="flex items-center gap-2 px-4 text-[12px] text-muted-foreground">
        <input
          type="checkbox"
          checked={task.catch_up_on_launch}
          onChange={(e) => void update(task.id, { catch_up_on_launch: e.target.checked })}
        />
        Catch up on next launch if a fire was missed
      </label>
    </div>
  );
};
