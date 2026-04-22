/**
 * VaultPanelShell — common chrome for Vault panels (Skills, Memory, Tasks, …).
 *
 * Adds a centered page header with breadcrumb + icon so the panel feels like
 * proper main content rather than a sidebar ported wholesale into the
 * workspace. The body slot fills the rest of the panel.
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
  icon: Icon,
  title,
  description,
  children,
  wide = false,
}) => (
  <div className="flex h-full min-h-0 flex-col bg-background">
    <div className="border-b border-border/60 px-6 py-4 shrink-0">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-border/70 bg-card/60">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
            Vault
          </p>
          <h1 className="text-sm font-medium text-foreground">{title}</h1>
        </div>
        {description && (
          <p className="hidden max-w-md text-right text-xs text-muted-foreground lg:block">
            {description}
          </p>
        )}
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {wide
        ? <div className="h-full">{children}</div>
        : <div className="mx-auto h-full max-w-5xl">{children}</div>}
    </div>
  </div>
);
