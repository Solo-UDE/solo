import { CaretDown, Sparkle } from '@phosphor-icons/react';
import React from 'react';

import { cn } from '../../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

export interface ModelOption {
  id: string;
  name: string;
  description: string;
}

export const CLAUDE_MODELS: ModelOption[] = [
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    description: 'Most capable model',
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    description: 'Balanced performance',
  },
  {
    id: 'claude-haiku-4',
    name: 'Claude Haiku 4',
    description: 'Fastest responses',
  },
];

export interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  models?: ModelOption[];
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  models = CLAUDE_MODELS,
}) => {
  const selectedModel = models.find((m) => m.id === value) ?? models[0];

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
        <Sparkle className="h-4 w-4 text-foreground" />
        <span className="text-sm font-medium text-foreground">
          {selectedModel?.name ?? 'Select Model'}
        </span>
        <CaretDown className="h-3 w-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {models.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onClick={() => {
              onChange(model.id);
            }}
            className={cn(
              'items-start gap-3 p-3',
              value === model.id && 'bg-accent'
            )}
          >
            <Sparkle className="h-4 w-4 mt-0.5 text-foreground" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">{model.name}</span>
              <span className="text-xs text-muted-foreground">{model.description}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
