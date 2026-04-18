import type { PanelProps } from '@/lib/panels/types';
import { Brain } from 'lucide-react';
import { MemorySection } from '@/components/sidebar/vault/MemorySection';
import { VaultPanelShell } from './VaultPanelShell';

export function MemoryPanel(_props: PanelProps) {
  return (
    <VaultPanelShell
      icon={Brain}
      title="Memory"
      description="Persistent context the agent carries across sessions — user preferences, project facts, feedback, and references."
    >
      <MemorySection />
    </VaultPanelShell>
  );
}
