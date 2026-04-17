/**
 * VaultPlaceholder — generic coming-soon shell used by every Vault section
 * until Phase 3F wires in the real per-section components.
 *
 * Takes title + description props so the same component can render the
 * Skills, Memory, Tasks, Plugins, Connectors, and Current Vault tabs without
 * six near-duplicate files.
 */

import type { FC } from 'react';
import { Vault as VaultIcon } from 'lucide-react';

interface VaultPlaceholderProps {
  title: string;
  description: string;
}

export const VaultPlaceholder: FC<VaultPlaceholderProps> = ({
  title,
  description,
}) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
    <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center">
      <VaultIcon className="w-6 h-6 text-muted-foreground/40" />
    </div>
    <div>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground/50 mt-1 max-w-[24ch]">
        {description}
      </p>
    </div>
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
      Coming Soon
    </span>
  </div>
);
