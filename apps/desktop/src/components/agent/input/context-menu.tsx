import { Plus, Image, At } from '@phosphor-icons/react';
import React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { toolbarButtonIconOnly } from './toolbar-button-class';
import { cn } from '@/lib/utils';

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
        className={cn(
          toolbarButtonIconOnly,
          disabled && 'opacity-50 cursor-not-allowed',
        )}
        aria-label="Add context"
      >
        <Plus className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onClick={onImageSelect}>
          <Image className="h-4 w-4" />
          <span>Images</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onMentionSelect}>
          <At className="h-4 w-4" />
          <span>Mentions</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
