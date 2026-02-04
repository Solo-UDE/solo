import { Plus, Image, At } from '@phosphor-icons/react';
import React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

export interface ContextMenuProps {
  onImageSelect?: () => void;
  onMentionSelect?: () => void;
  disabled?: boolean;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  onImageSelect,
  onMentionSelect,
  disabled = false,
}) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={`
          inline-flex items-center justify-center
          h-8 w-8 rounded-md
          border border-border bg-background
          hover:bg-muted hover:border-border
          focus:outline-none focus:ring-2 focus:ring-ring
          transition-colors
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        aria-label="Add context"
      >
        <Plus className="h-4 w-4 text-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem
          onClick={onImageSelect}
          className="flex items-center gap-2 cursor-pointer"
        >
          <Image className="h-4 w-4" />
          <span>Images</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onMentionSelect}
          className="flex items-center gap-2 cursor-pointer"
        >
          <At className="h-4 w-4" />
          <span>Mentions</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
