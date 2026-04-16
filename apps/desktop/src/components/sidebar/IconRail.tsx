/**
 * IconRail - 36px vertical icon strip with sliding accent indicator
 */

import { useState, type FC } from 'react';
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

export const IconRail: FC = () => {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const [showHint, setShowHint] = useState(
    () => !localStorage.getItem('solo:sessions-discovered')
  );

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
          data-tour={key}
          aria-selected={activeTab === key}
          onClick={() => {
            setActiveTab(key);
            if (key === 'sessions' && showHint) {
              localStorage.setItem('solo:sessions-discovered', '1');
              setShowHint(false);
            }
          }}
          className={cn(
            'relative w-8 h-8 flex items-center justify-center rounded-lg',
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
            aria-hidden="true"
          />
          {key === 'sessions' && showHint && (
            <span
              className="absolute top-1 right-1 w-[5px] h-[5px] rounded-full bg-primary shadow-[0_0_4px_1px] shadow-primary/40"
              aria-hidden="true"
            />
          )}
        </button>
      ))}

    </nav>
  );
};
