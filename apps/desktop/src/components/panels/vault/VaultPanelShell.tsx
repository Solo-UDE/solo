/**
 * VaultPanelShell — common body layout for Vault panels.
 */

import type { FC, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface VaultPanelShellProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  /** Let the body fill the full panel width instead of the centered max-w-5xl column.
   *  Use for panels with their own multi-column layout (e.g. Tasks). */
  readonly wide?: boolean;
}

export const VaultPanelShell: FC<VaultPanelShellProps> = ({
  children,
  wide = false,
}) => (
  <div className="flex h-full min-h-0 flex-col bg-background">
    <div className="min-h-0 flex-1 overflow-y-auto">
      {wide
        ? <div className="h-full">{children}</div>
        : <div className="mx-auto h-full max-w-5xl">{children}</div>}
    </div>
  </div>
);
