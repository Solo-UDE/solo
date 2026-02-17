import { CaretDown, Lightning, Brain } from '@phosphor-icons/react';
import React from 'react';

import { cn } from '../../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { toolbarButtonBase } from './toolbar-button-class';

export type Mode = 'planning' | 'fast';

export interface ModeSelectorProps {
  value: Mode;
  onChange: (mode: Mode) => void;
  disabled?: boolean;
}

const MODE_CONFIG = {
  planning: {
    label: 'Planning',
    icon: Brain,
    description: 'Thoughtful, step-by-step approach',
  },
  fast: {
    label: 'Fast',
    icon: Lightning,
    description: 'Quick responses',
  },
};

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const selectedMode = MODE_CONFIG[value];
  const Icon = selectedMode.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          toolbarButtonBase,
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">
          {selectedMode.label}
        </span>
        <CaretDown className="h-3 w-3 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {Object.entries(MODE_CONFIG).map(([key, config]) => {
          const ModeIcon = config.icon;
          return (
            <DropdownMenuItem
              key={key}
              onClick={() => {
                onChange(key as Mode);
              }}
              className={cn(
                'items-start gap-3 p-3',
                value === key && 'bg-accent'
              )}
            >
              <ModeIcon className="h-4 w-4 mt-0.5 text-foreground" />
              <div className="flex flex-col">
                <span className="text-sm font-medium">{config.label}</span>
                <span className="text-xs text-muted-foreground">{config.description}</span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
