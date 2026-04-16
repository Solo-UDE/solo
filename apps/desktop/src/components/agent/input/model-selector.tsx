import { ChevronDownIcon, StarFilledIcon } from '@radix-ui/react-icons';
import React from 'react';

import { cn } from '../../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

import { CLAUDE_MODELS } from '../../../lib/constants';
import type { ModelOption } from '../../../lib/constants';
export { CLAUDE_MODELS };
export type { ModelOption };

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
        <StarFilledIcon width={16} height={16} className="text-foreground" />
        <span className="text-sm font-medium text-foreground">
          {selectedModel?.name ?? 'Select Model'}
        </span>
        <ChevronDownIcon width={12} height={12} className="text-muted-foreground" />
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
            <StarFilledIcon width={16} height={16} className="mt-0.5 text-foreground" />
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
