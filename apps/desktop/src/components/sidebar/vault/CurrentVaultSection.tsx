/**
 * CurrentVaultSection — Vault sub-tab that shows the active memory bundle.
 *
 * Each project can have multiple vault configurations (e.g., "Architecture
 * deep-dive" vs. "Feature work" vs. "Bug triage"). The Current Vault tab
 * shows which one is active and lets the user swap. Regular sessions read
 * from the active vault to decide which memory + skills + plugins are on.
 */

import type { FC } from 'react';
import { Vault as VaultIcon } from 'lucide-react';
import { VaultSectionShell } from './VaultSectionShell';

export const CurrentVaultSection: FC = () => (
  <VaultSectionShell
    icon={VaultIcon}
    title="Current Vault"
    description="The active memory + skills + connectors bundle the agent is drawing from right now. Swap the vault to change the agent's mindset without reopening the project."
    previewItems={[
      { label: 'Pick an active vault', hint: 'Architecture, feature work, bug triage, etc.' },
      { label: "See what's included", hint: 'Which skills + memory entries are live' },
      { label: 'Clone or customize', hint: 'Fork a preset and tweak it per-project' },
    ]}
  />
);
