import { useMemo } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@radix-ui/react-icons';
import { ClaudeLogo } from '../../icons/ClaudeLogo';
import { GeminiLogo } from '../../icons/GeminiLogo';
import { OpenAILogo } from '../../icons/OpenAILogo';
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
import { toolbarButtonBase } from './toolbar-button-class';

import type { FC, ReactNode } from 'react';

export interface ModelPickerProps {
  /** Side where the dropdown menu should appear */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Icon to show in the trigger button (ChevronDown or ChevronUp) */
  chevronIcon?: 'down' | 'up';
  /** Callback to execute after selecting a model */
  onModelSelect?: () => void;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Optional className for the trigger button */
  className?: string;
}

/**
 * Render provider icon based on type
 */
export const renderModelIcon = (iconType: ProviderIconType, size: number = 13): ReactNode => {
  switch (iconType) {
    case 'openai':
      return (
        <OpenAILogo
          size={size}
          color="currentColor"
          className="size-auto"
        />
      );
    case 'claude':
      return (
        <ClaudeLogo
          size={size}
          color="#D97757"
          className="size-auto"
        />
      );
    case 'gemini':
      return (
        <GeminiLogo
          size={size}
          color="#60a9ed"
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
  disabled = false,
  className,
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

  const groupedModels = useMemo(() => {
    const groups: { claude: typeof MODEL_OPTIONS; openai: typeof MODEL_OPTIONS; gemini: typeof MODEL_OPTIONS } = {
      claude: [],
      openai: [],
      gemini: [],
    };
    for (const model of MODEL_OPTIONS) {
      const key = model.iconType as 'claude' | 'openai' | 'gemini';
      if (key in groups) {
        groups[key].push(model);
      }
    }
    return groups;
  }, []);

  const groupOrder: Array<{ key: 'claude' | 'openai' | 'gemini'; label: string }> = [
    { key: 'claude', label: 'Claude (Anthropic)' },
    { key: 'openai', label: 'ChatGPT (OpenAI)' },
    { key: 'gemini', label: 'Gemini (Google)' },
  ];

  const ChevronIcon = chevronIcon === 'up' ? ChevronUpIcon : ChevronDownIcon;

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
                  toolbarButtonBase,
                  'min-w-0 max-w-[11rem] shrink',
                  disabled && 'opacity-50 cursor-not-allowed',
                  className,
                )}
              >
                <span className="shrink-0">
                  {renderModelIcon(currentModel.iconType, 13)}
                </span>
                <span className="min-w-0 truncate text-xs font-medium">
                  {currentModel.label}
                </span>
                <ChevronIcon width={12} height={12} className="shrink-0 opacity-50" />
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
          className="w-56 flex flex-col gap-0.5"
        >
          {groupOrder.map(({ key, label }, groupIdx) => {
            const models = groupedModels[key];
            if (!models.length) return null;
            return (
              <div key={key}>
                {groupIdx > 0 && <div className="h-px bg-border my-1 mx-2" />}
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {label}
                </div>
                {models.map((option) => {
                  const isSelected = option.value === selectedModel;
                  return (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => {
                        void handleModelSelect(option.value);
                      }}
                      className={cn(
                        'items-start gap-2.5',
                        isSelected && 'bg-accent'
                      )}
                    >
                      <div className="mt-0.5 shrink-0">
                        {renderModelIcon(option.iconType, 14)}
                      </div>
                      <div className="flex flex-col gap-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'text-[13px] leading-tight',
                              isSelected ? 'text-foreground' : 'text-foreground/90'
                            )}
                          >
                            {option.label}
                          </span>
                          {option.textOnly && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              Text only
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-muted-foreground leading-tight">
                          {option.description}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </div>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
};
