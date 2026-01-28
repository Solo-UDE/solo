import { ChevronDown, Zap, Brain } from 'lucide-react';
import React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

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
    icon: Zap,
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
        className={`
          inline-flex items-center gap-2
          px-3 py-1.5 rounded-md
          border border-border bg-background
          hover:bg-muted hover:border-border
          focus:outline-none focus:ring-2 focus:ring-ring
          transition-colors
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <Icon className="h-4 w-4 text-foreground" />
        <span className="text-sm font-medium text-foreground">
          {selectedMode.label}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
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
              className={`
                flex items-start gap-3 cursor-pointer p-3
                ${value === key ? 'bg-primary/10' : ''}
              `}
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
