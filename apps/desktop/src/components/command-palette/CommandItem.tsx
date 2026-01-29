/**
 * CommandItem - Individual item in the command palette
 */

import { forwardRef } from 'react';
import { FileText, Settings, Terminal, Folder, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CommandItem as CommandItemType, CommandCategory } from './useCommandPalette';

interface CommandItemProps {
  item: CommandItemType;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}

function getCategoryIcon(category: CommandCategory, label: string) {
  if (category === 'recent' || category === 'files') {
    if (label.includes('/')) {
      return <Folder className="w-4 h-4" />;
    }
    return <FileText className="w-4 h-4" />;
  }
  if (category === 'settings') {
    return <Settings className="w-4 h-4" />;
  }
  if (label.toLowerCase().includes('session')) {
    return <MessageSquare className="w-4 h-4" />;
  }
  return <Terminal className="w-4 h-4" />;
}

export const CommandItemComponent = forwardRef<HTMLDivElement, CommandItemProps>(
  ({ item, isSelected, onClick, onMouseEnter }, ref) => {
    return (
      <div
        ref={ref}
        role="option"
        aria-selected={isSelected}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 cursor-pointer',
          'transition-colors duration-100',
          isSelected
            ? 'bg-bg-surface-3 text-foreground'
            : 'text-muted-foreground hover:bg-bg-surface-2'
        )}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
      >
        {/* Icon */}
        <span className={cn(
          'shrink-0',
          isSelected ? 'text-foreground' : 'text-muted-foreground'
        )}>
          {getCategoryIcon(item.category, item.label)}
        </span>

        {/* Label and description */}
        <div className="flex-1 min-w-0">
          <div className={cn(
            'text-sm truncate',
            isSelected && 'text-foreground'
          )}>
            {item.label}
          </div>
          {item.description && (
            <div className="text-xs text-muted-foreground/70 truncate">
              {item.description}
            </div>
          )}
        </div>

        {/* Shortcut hint */}
        {item.shortcut && (
          <span className="shrink-0 text-xs text-muted-foreground font-mono">
            {item.shortcut}
          </span>
        )}
      </div>
    );
  }
);

CommandItemComponent.displayName = 'CommandItem';
