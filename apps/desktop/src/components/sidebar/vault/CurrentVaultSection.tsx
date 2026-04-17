/**
 * CurrentVaultSection — renders the live Vault feature surface.
 *
 * This section is the only one under the Vault nav with a shipping
 * implementation. Other sections (Skills, Memory, Tasks, Plugins,
 * Connectors) still use VaultSectionShell to preview what will live
 * there. When those ship, swap their bodies to their real components
 * the same way.
 */

import type { FC } from 'react';
import { VaultPanel } from '@/components/vault/VaultPanel';

export const CurrentVaultSection: FC = () => <VaultPanel />;
