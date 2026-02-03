import { ChevronDown, Sparkles } from 'lucide-react';
import React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

export { CLAUDE_MODELS } from '../../../lib/constants';
export type { ModelOption } from '../../../lib/constants';

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
        <Sparkles className="h-4 w-4 text-foreground" />
        <span className="text-sm font-medium text-foreground">
          {selectedModel?.name ?? 'Select Model'}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {models.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onClick={() => {
              onChange(model.id);
            }}
            className={`
              flex items-start gap-3 cursor-pointer p-3
              ${value === model.id ? 'bg-primary/10' : ''}
            `}
          >
            <Sparkles className="h-4 w-4 mt-0.5 text-foreground" />
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
