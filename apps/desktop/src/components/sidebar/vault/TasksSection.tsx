/**
 * TasksSection — Vault sub-tab for Linear-style assignable tasks.
 *
 * The idea is to let users queue work items for the agent that outlive any
 * single session. The agent-bridge has a TaskCreate / TaskUpdate surface
 * for in-session tracking; this Vault tab will host the cross-session
 * backlog that a team can share.
 */

import type { FC } from 'react';
import { ListChecks } from 'lucide-react';
import { VaultSectionShell } from './VaultSectionShell';

export const TasksSection: FC = () => (
  <VaultSectionShell
    icon={ListChecks}
    title="Tasks"
    description="Assignable work items that persist across sessions. The agent can claim tasks, update their status, and leave notes on blockers."
    previewItems={[
      { label: 'Queue a task', hint: 'Describe it once; hand it to any session later' },
      { label: 'Sync with Linear or GitHub', hint: 'Mirror the project backlog both ways' },
      { label: 'Assign to worktrees', hint: 'Tie work items to isolated branches' },
    ]}
  />
);
