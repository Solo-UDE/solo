import type { FC } from 'react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Task, AgentConfig, AgentPermissionMode, ExecutionLocation } from '@/lib/tauri/tasks';
import { SelectDropdown } from '@/components/settings/controls/SelectDropdown';

interface Props { readonly task: Task }

const DEFAULT_CFG: AgentConfig = {
  permission_mode: 'ask',
  execution_location: 'main_workspace',
  deny_list: [],
};

export const AgentConfigTab: FC<Props> = ({ task }) => {
  const update = useTaskStore((s) => s.update);
  const cfg: AgentConfig = task.agent_config ?? DEFAULT_CFG;

  const patch = (changes: Partial<AgentConfig>) => {
    void update(task.id, { agent_config: { ...cfg, ...changes } });
  };

  // Safety rule (UI mirror of Rust-side): Bypass only valid in Worktree
  const invalidCombo = cfg.permission_mode === 'bypass' && cfg.execution_location === 'main_workspace';

  return (
    <div className="flex flex-col gap-4 p-4 text-[12px]">
      <label className="flex flex-col gap-1 text-muted-foreground">
        Execution location
        <SelectDropdown
          value={cfg.execution_location}
          options={[
            { label: 'Main workspace', value: 'main_workspace' as ExecutionLocation },
            { label: 'Isolated worktree', value: 'worktree' as ExecutionLocation },
          ]}
          onChange={(v) => patch({ execution_location: v })}
        />
      </label>

      <label className="flex flex-col gap-1 text-muted-foreground">
        Permission mode
        <SelectDropdown
          value={cfg.permission_mode}
          options={[
            { label: 'Ask (manual confirm each tool)', value: 'ask' as AgentPermissionMode },
            { label: 'Plan (no execution)', value: 'plan' as AgentPermissionMode },
            { label: 'Accept edits', value: 'accept_edits' as AgentPermissionMode },
            { label: 'Bypass (worktree only)', value: 'bypass' as AgentPermissionMode },
          ]}
          onChange={(v) => patch({ permission_mode: v })}
        />
        {invalidCombo && (
          <span className={cn('mt-0.5 text-red-500')}>
            Bypass requires isolated worktree — executor will reject this combo server-side.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-muted-foreground">
        Extra deny-list patterns (one per line)
        <textarea
          rows={4}
          value={cfg.deny_list.join('\n')}
          onChange={(e) => patch({ deny_list: e.target.value.split('\n').filter(Boolean) })}
          className="rounded-md border border-border/60 bg-background px-2 py-1.5 font-mono text-[12px] text-foreground"
          placeholder={'rm -rf /tmp\ngit push --force'}
        />
        <span className="mt-0.5 text-[10px]">Merged with the global deny-list.</span>
      </label>
    </div>
  );
};
