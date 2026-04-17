/**
 * HorizontalTabBar - Horizontal icon tab bar replacing the vertical IconRail.
 * Shows 3 tabs (Explorer, Sessions, Source Control) with an animated underline indicator.
 */

import { type FC } from 'react';
import { Files, MessageCircle, GitBranch } from 'lucide-react';
import { motion } from 'motion/react';
import { useUIStore } from '@/stores/uiStore';
import type { SidebarTab } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

const TABS: { key: SidebarTab; icon: typeof Files; label: string }[] = [
  { key: 'explorer', icon: Files, label: 'Explorer' },
  { key: 'sessions', icon: MessageCircle, label: 'Sessions' },
  { key: 'source-control', icon: GitBranch, label: 'Source Control' },
];

export const HorizontalTabBar: FC = () => {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  return (
    <div className="relative flex items-center gap-1 px-2 h-8 border-b border-border/10 shrink-0">
      {TABS.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          onClick={() => setActiveTab(key)}
          className={cn(
            'relative w-7 h-7 flex items-center justify-center rounded-lg',
            'transition-[transform,background-color,color] duration-200',
            'active:scale-95',
            activeTab === key
              ? 'text-primary'
              : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/60',
          )}
          title={label}
        >
          <Icon
            className="w-[16px] h-[16px]"
          />

          {/* Animated underline indicator */}
          {activeTab === key && (
            <motion.div
              layoutId="tab-indicator"
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-[2px] rounded-full bg-primary"
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
        </button>
      ))}
    </div>
  );
};
