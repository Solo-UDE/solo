/**
 * ModeToggle - Segmented pill toggle for Dev/Vault sidebar modes.
 */

import type { FC } from 'react';
import { motion } from 'motion/react';
import { useUIStore } from '@/stores/uiStore';
import type { SidebarMode } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

const MODES: { key: SidebarMode; label: string }[] = [
  { key: 'dev', label: 'Dev' },
  { key: 'vault', label: 'Vault' },
];

export const ModeToggle: FC = () => {
  const sidebarMode = useUIStore((s) => s.sidebarMode);
  const setSidebarMode = useUIStore((s) => s.setSidebarMode);

  return (
    <div className="mx-3.5 mb-2 mt-1">
      <div className="relative flex h-8 rounded-[9px] border border-border/70 bg-background/55 p-0.5">
        {MODES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSidebarMode(key)}
            className={cn(
              'relative z-10 flex-1 rounded-[7px] text-xs font-medium transition-colors duration-150',
              sidebarMode === key
                ? 'text-foreground font-semibold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {sidebarMode === key && (
              <motion.div
                layoutId="mode-indicator"
                className="absolute inset-0 rounded-[7px] border border-border/70 bg-card shadow-[0_10px_18px_-18px_rgba(0,0,0,0.35)]"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
