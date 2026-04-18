import type { PanelProps } from '@/lib/panels/types';
import { ListChecks } from 'lucide-react';
import { TasksSection } from '@/components/sidebar/vault/TasksSection';
import { VaultPanelShell } from './VaultPanelShell';

export function TasksPanel(_props: PanelProps) {
  return (
    <VaultPanelShell
      icon={ListChecks}
      title="Tasks"
      description="Shared task list across agent sessions. Pin open questions, track intent, and hand off work between sessions."
    >
      <TasksSection />
    </VaultPanelShell>
  );
}
