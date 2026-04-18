import type { PanelProps } from '@/lib/panels/types';
import { PlugZap } from 'lucide-react';
import { ConnectorsSection } from '@/components/sidebar/vault/ConnectorsSection';
import { VaultPanelShell } from './VaultPanelShell';

export function ConnectorsPanel(_props: PanelProps) {
  return (
    <VaultPanelShell
      icon={PlugZap}
      title="Connectors"
      description="External integrations — Slack, Linear, Notion, MCP servers. Configure credentials and manage connector scope."
    >
      <ConnectorsSection />
    </VaultPanelShell>
  );
}
