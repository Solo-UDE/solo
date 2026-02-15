/**
 * IconRail - 36px vertical icon strip with sliding accent indicator
 */

import type { FC } from 'react';
import { Files, ChatTeardrop, GitBranch } from '@phosphor-icons/react';
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
    <div className="relative flex flex-col items-center w-9 shrink-0 py-3 gap-1 border-r border-white/[0.04]">
      {/* Sliding accent indicator */}
      <div
        className="absolute left-0 w-[2px] h-5 rounded-r-full bg-primary transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          top: `${12 + activeIndex * 36}px`, // py-3 (12px) + index * (32px button + 4px gap)
        }}
      />

      {TABS.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          onClick={() => setActiveTab(key)}
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded-lg',
            'transition-all duration-200',
            activeTab === key
              ? 'text-foreground'
              : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/60 hover:scale-105 active:scale-95',
          )}
          title={label}
        >
          <Icon
            className="w-[18px] h-[18px]"
            weight={activeTab === key ? 'fill' : 'regular'}
          />
        </button>
      ))}
    </div>
  );
};
