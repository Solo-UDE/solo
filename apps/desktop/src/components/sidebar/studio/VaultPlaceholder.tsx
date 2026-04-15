/**
 * VaultPlaceholder - Coming soon placeholder for the Vault section in Studio mode.
 */

import type { FC } from 'react';
import { Vault } from '@phosphor-icons/react';

export const VaultPlaceholder: FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
    <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center">
      <Vault className="w-6 h-6 text-muted-foreground/40" />
    </div>
    <div>
      <p className="text-sm font-medium text-muted-foreground">Vault</p>
      <p className="text-xs text-muted-foreground/50 mt-1">
        A durable memory for the agent — drop any file and it becomes searchable context.
      </p>
    </div>
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
      Coming Soon
    </span>
  </div>
);
