/**
 * PluginsSection — Vault sub-tab for installed agent plugins.
 *
 * Plugins extend the agent with new tools or context providers. Unlike
 * skills (which are prompts), plugins are code that runs in the
 * agent-bridge sandbox. This UI will let the user see what's installed,
 * toggle plugins per-project, and manage plugin-provided credentials.
 */

import type { FC } from 'react';
import { Puzzle } from 'lucide-react';
import { VaultSectionShell } from './VaultSectionShell';

export const PluginsSection: FC = () => (
  <VaultSectionShell
    icon={Puzzle}
    title="Plugins"
    description="Extensions that add tools or context providers to the agent. Plugins live in the agent-bridge sandbox and can be toggled per-project."
    previewItems={[
      { label: 'Install and update', hint: 'From the plugin registry or a local path' },
      { label: 'Toggle per-project', hint: 'Keep experimental plugins out of the main repo' },
      { label: 'Audit permissions', hint: 'See exactly which tools each plugin grants' },
    ]}
  />
);
