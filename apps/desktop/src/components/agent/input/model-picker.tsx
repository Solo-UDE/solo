import { useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  SiClaude,
  SiGooglegemini,
  SiOpenai,
} from '@icons-pack/react-simple-icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '../../ui/tooltip';
import { useProviderStore } from '../../../stores/provider-store';
import { MODEL_OPTIONS, type ProviderIconType } from '../../../lib/constants';
import { cn } from '../../../lib/utils';

import type { FC, ReactNode } from 'react';

export interface ModelPickerProps {
  /** Side where the dropdown menu should appear */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Icon to show in the trigger button (ChevronDown or ChevronUp) */
  chevronIcon?: 'down' | 'up';
  /** Callback to execute after selecting a model */
  onModelSelect?: () => void;
  /** Compact mode for smaller displays */
  compact?: boolean;
  /** Whether the picker is disabled */
  disabled?: boolean;
}

/**
 * Render provider icon based on type
 */
export const renderModelIcon = (iconType: ProviderIconType, size: number = 13): ReactNode => {
  switch (iconType) {
    case 'openai':
      return (
        <SiOpenai
          color="currentColor"
          width={size}
          height={size}
          className="size-auto"
        />
      );
    case 'claude':
      return (
        <SiClaude
          color="#D97757"
          width={size}
          height={size}
          className="size-auto"
        />
      );
    case 'gemini':
      return (
        <SiGooglegemini
          color="#60a9ed"
          width={size}
          height={size}
          className="size-auto"
        />
      );
    default:
      return null;
  }
};

/**
 * Model picker dropdown with provider icons
 *
 * Allows switching between different AI models from various providers
 * (Claude, OpenAI, Gemini) with visual icons for each provider.
 */
export const ModelPicker: FC<ModelPickerProps> = ({
  side = 'bottom',
  chevronIcon = 'down',
  onModelSelect,
  compact = false,
  disabled = false,
}) => {
  const selectedModel = useProviderStore((state) => state.selectedModel);
  const setSelectedModel = useProviderStore((state) => state.setSelectedModel);
  const setActiveProvider = useProviderStore((state) => state.setActiveProvider);

  const currentModel = useMemo(
    () =>
      MODEL_OPTIONS.find((option) => option.value === selectedModel) ||
      MODEL_OPTIONS[0],
    [selectedModel]
  );

  const ChevronIcon = chevronIcon === 'up' ? ChevronUp : ChevronDown;

  const handleModelSelect = async (modelValue: string) => {
    const model = MODEL_OPTIONS.find((m) => m.value === modelValue);
    if (model) {
      // Update the active provider based on the selected model
      const providerMap: Record<string, string> = {
        anthropic: 'anthropic',
        openai: 'openai',
        google: 'google',
      };
      const providerKey = providerMap[model.provider];
      if (providerKey) {
        try {
          await setActiveProvider(providerKey);
        } catch (error) {
          console.error('Failed to set active provider:', error);
        }
      }
      setSelectedModel(modelValue);
      onModelSelect?.();
    }
  };

  return (
    <TooltipProvider>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                className={cn(
                  'flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md transition-all duration-200 focus-visible:outline-none',
                  compact
                    ? 'px-1.5 py-0.5 hover:bg-accent-foreground/10'
                    : 'px-2 py-1 border border-muted-foreground/20 hover:bg-accent-foreground/10',
                  disabled && 'opacity-50 cursor-not-allowed'
                )}
              >
                {renderModelIcon(currentModel.iconType, compact ? 12 : 13)}
                <span className="font-medium">{currentModel.label}</span>
                <ChevronIcon size={compact ? 10 : 12} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Switch model</p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          side={side}
          className="w-56 bg-popover border border-border flex flex-col gap-0.5 p-1"
        >
          {MODEL_OPTIONS.map((option) => {
            const isSelected = option.value === selectedModel;
            return (
              <DropdownMenuItem
                key={option.value}
                onClick={() => {
                  void handleModelSelect(option.value);
                }}
                className={cn(
                  'flex items-start gap-2.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
                  isSelected
                    ? 'bg-accent-foreground/10'
                    : 'hover:bg-accent-foreground/5 focus:bg-accent-foreground/5'
                )}
              >
                <div className="mt-0.5 shrink-0">
                  {renderModelIcon(option.iconType, 14)}
                </div>
                <div className="flex flex-col gap-0">
                  <span
                    className={cn(
                      'text-[13px] leading-tight',
                      isSelected ? 'text-foreground' : 'text-foreground/90'
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-tight">
                    {option.description}
                  </span>
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
};
