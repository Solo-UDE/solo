import type { PanelProps } from '@/lib/panels/types';
import { Vault as VaultIcon } from 'lucide-react';
import { CurrentVaultSection } from '@/components/sidebar/vault/CurrentVaultSection';
import { VaultPanelShell } from './VaultPanelShell';

export function CurrentVaultPanel(_props: PanelProps) {
  return (
    <VaultPanelShell
      icon={VaultIcon}
      title="Current Vault"
      description="The active project-scoped context container. Switch vaults, inspect scope, and manage vault-level settings."
    >
      <CurrentVaultSection />
    </VaultPanelShell>
  );
}
