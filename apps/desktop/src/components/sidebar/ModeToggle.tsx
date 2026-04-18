/**
 * ModeToggle — Dev/Vault mode switcher. Flat tab-style buttons with an
 * underline indicator for the active mode. No nested bordered containers.
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
    <div className="mx-3 mb-1 mt-0.5 flex gap-5">
      {MODES.map(({ key, label }) => {
        const isActive = sidebarMode === key;
        return (
          <button
            key={key}
            onClick={() => setSidebarMode(key)}
            className={cn(
              'relative h-7 text-[12px] font-medium transition-colors duration-150',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground/70 hover:text-foreground',
            )}
          >
            {label}
            {isActive && (
              <motion.span
                layoutId="mode-indicator"
                className="absolute -bottom-px left-0 right-0 h-[2px] rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
};
