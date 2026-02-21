/**
 * IconRail - 36px vertical icon strip with sliding accent indicator
 */

import type { FC } from 'react';
import { Files, ChatTeardrop, GitBranch } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useUIStore } from '@/stores/uiStore';
import type { SidebarTab } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

const TABS: { key: SidebarTab; icon: typeof Files; label: string }[] = [
  { key: 'explorer', icon: Files, label: 'Explorer' },
  { key: 'sessions', icon: ChatTeardrop, label: 'Sessions' },
  { key: 'source-control', icon: GitBranch, label: 'Source Control' },
];

export const IconRail: FC = () => {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  const activeIndex = TABS.findIndex((t) => t.key === activeTab);

  return (
    <nav className="relative flex flex-col items-center w-9 shrink-0 py-3 gap-1 border-r border-white/[0.04]" role="tablist" aria-label="Sidebar navigation">
      {/* Sliding accent indicator */}
      <motion.div
        className="absolute left-0 w-[2px] h-5 rounded-r-full bg-primary"
        animate={{ top: 12 + activeIndex * 36 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />

      {TABS.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          role="tab"
          aria-selected={activeTab === key}
          onClick={() => setActiveTab(key)}
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded-lg',
            'transition-[transform,background-color,color] duration-200',
            'active:scale-95',
            activeTab === key
              ? 'text-foreground'
              : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/60 hover:scale-105',
          )}
          aria-label={label}
          aria-current={activeTab === key ? 'true' : undefined}
          title={label}
        >
          <Icon
            className="w-[18px] h-[18px]"
            weight={activeTab === key ? 'fill' : 'regular'}
            aria-hidden="true"
          />
        </button>
      ))}
    </nav>
  );
};
