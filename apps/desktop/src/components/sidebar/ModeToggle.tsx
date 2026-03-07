/**
 * ModeToggle - Segmented pill toggle for Dev/Studio sidebar modes.
 */

import type { FC } from 'react';
import { motion } from 'motion/react';
import { useUIStore } from '@/stores/uiStore';
import type { SidebarMode } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

const MODES: { key: SidebarMode; label: string }[] = [
  { key: 'dev', label: 'Dev' },
  { key: 'studio', label: 'Studio' },
];

export const ModeToggle: FC = () => {
  const sidebarMode = useUIStore((s) => s.sidebarMode);
  const setSidebarMode = useUIStore((s) => s.setSidebarMode);

  return (
    <div className="mx-3 my-2.5">
      <div className="relative flex h-8 rounded-lg bg-muted/30 p-0.5 border border-border/10">
        {MODES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSidebarMode(key)}
            className={cn(
              'relative z-10 flex-1 text-xs font-medium rounded-md transition-colors duration-150',
              sidebarMode === key
                ? 'text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {sidebarMode === key && (
              <motion.div
                layoutId="mode-indicator"
                className="absolute inset-0 rounded-md bg-primary/10 shadow-sm"
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
