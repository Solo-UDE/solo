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
        'relative flex items-center justify-center h-8 px-3 flex-1 transition-colors rounded-md',
        active ? 'text-foreground bg-muted/60' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
      )}
      onClick={onClick}
      title={label}
    >
      <span className="text-xs font-medium truncate">{label}</span>
    </button>
  );
};
