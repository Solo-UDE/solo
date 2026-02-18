/**
 * TabButton - Individual tab button for sidebar navigation
 */

import type { FC } from 'react';
import { cn } from '@/lib/utils';

interface TabButtonProps {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}

export const TabButton: FC<TabButtonProps> = ({ label, active, onClick }) => {
  return (
    <button
      className={cn(
        'relative flex items-center justify-center h-8 px-3 flex-1',
        'transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
        active ? 'glow-active-text' : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={onClick}
      title={label}
    >
      <span className="text-xs font-medium truncate">{label}</span>
    </button>
  );
};

interface TabGroupProps {
  readonly tabs: readonly string[];
  readonly activeIndex: number;
  readonly onTabChange: (index: number) => void;
}

export const TabGroup: FC<TabGroupProps> = ({ tabs, activeIndex, onTabChange }) => {
  return (
    <div className="relative flex items-center">
      {tabs.map((label, index) => (
        <TabButton
          key={label}
          label={label}
          active={activeIndex === index}
          onClick={() => onTabChange(index)}
        />
      ))}
    </div>
  );
};
