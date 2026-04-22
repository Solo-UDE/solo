import type { FC } from 'react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Task, AgentConfig, AgentPermissionMode, ExecutionLocation } from '@/lib/tauri/tasks';

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
        <select
          value={cfg.execution_location}
          onChange={(e) => patch({ execution_location: e.target.value as ExecutionLocation })}
          className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground"
        >
          <option value="main_workspace">Main workspace</option>
          <option value="worktree">Isolated worktree</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-muted-foreground">
        Permission mode
        <select
          value={cfg.permission_mode}
          onChange={(e) => patch({ permission_mode: e.target.value as AgentPermissionMode })}
          className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground"
        >
          <option value="ask">Ask (manual confirm each tool)</option>
          <option value="plan">Plan (no execution)</option>
          <option value="accept_edits">Accept edits</option>
          <option value="bypass">Bypass (worktree only)</option>
        </select>
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
