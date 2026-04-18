/**
 * ConnectorsSection — Vault sub-tab for external service integrations.
 *
 * Connectors bridge the agent to third-party systems: Linear, Slack,
 * Notion, Jira, etc. Each connector provides a set of tools the agent
 * can use (read/write/search) against the connected service. This tab
 * manages the connections themselves and their auth state.
 */

import type { FC } from 'react';
import { PlugZap } from 'lucide-react';
import { VaultSectionShell } from './VaultSectionShell';

export const ConnectorsSection: FC = () => (
  <VaultSectionShell
    icon={PlugZap}
    title="Connectors"
    description="External service integrations. Each connector gives the agent a set of read/write tools against a third-party system."
    previewItems={[
      { label: 'Linear', hint: 'Read tickets and update status from any session' },
      { label: 'Slack', hint: 'Post updates and search channels' },
      { label: 'Notion or Jira', hint: 'Connect whichever project tracker you use' },
    ]}
  />
);
