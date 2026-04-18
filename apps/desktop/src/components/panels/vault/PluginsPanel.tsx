import type { PanelProps } from '@/lib/panels/types';
import { Puzzle } from 'lucide-react';
import { PluginsSection } from '@/components/sidebar/vault/PluginsSection';
import { VaultPanelShell } from './VaultPanelShell';

export function PluginsPanel(_props: PanelProps) {
  return (
    <VaultPanelShell
      icon={Puzzle}
      title="Plugins"
      description="Extend Solo with plugins from the Solo plugin marketplace. Plugins add commands, panels, and agent tools."
    >
      <PluginsSection />
    </VaultPanelShell>
  );
}
