/**
 * MemorySection — Vault sub-tab for the agent's persistent memory.
 *
 * Memory files live on disk at `~/.solo/memory/` (user-scope) and inside
 * each project's `.solo/memory/` (project-scope). The agent-bridge already
 * surfaces memory via the auto-memory system; this UI will expose reads
 * and writes to the user so they can correct or remove entries.
 */

import type { FC } from 'react';
import { Brain } from 'lucide-react';
import { VaultSectionShell } from './VaultSectionShell';

export const MemorySection: FC = () => (
  <VaultSectionShell
    icon={Brain}
    title="Memory"
    description="Persistent context the agent references across sessions. Memory is grouped by type — user, feedback, project, reference — and scoped to you or to this project."
    previewItems={[
      { label: 'Inspect stored entries', hint: 'See what the agent is remembering and why' },
      { label: 'Edit or redact', hint: 'Correct mistakes or remove stale entries' },
      { label: 'Export for review', hint: 'Copy the full memory index for audits' },
    ]}
  />
);
