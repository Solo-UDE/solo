import { useMemo } from 'react';
import { Gauge } from '@phosphor-icons/react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '../../ui/tooltip';
import { useActiveSessionId, useSessionMessages } from '../../../stores/agentStore';
import { useProviderStore, useModels } from '../../../stores/provider-store';
import { cn } from '../../../lib/utils';

import type { FC } from 'react';
import type { Message } from '../../../stores/agentStore';
import type { ModelInfo } from '../../../lib/backend';

// Rough token estimation: ~4 characters per token
const CHARS_PER_TOKEN = 4;

function getContextWindow(modelId: string | null, models: ModelInfo[]): number {
  if (!modelId) return 200_000;
  const model = models.find(m => m.id === modelId);
  return model?.context_window ?? 200_000;
}

interface ContextBreakdown {
  label: string;
  tokens: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function computeBreakdown(messages: Message[], modelId: string | null, models: ModelInfo[]): {
  breakdown: ContextBreakdown[];
  total: number;
  max: number;
} {
  const max = getContextWindow(modelId, models);

  // Estimate system prompt tokens (base system prompt is ~2-3k tokens)
  const systemPromptTokens = 3000;

  // Estimate system tools tokens (tool definitions ~1500 tokens for 7 tools)
  const systemToolsTokens = 1500;

  // Count message tokens
  let messageTokens = 0;
  let toolResultTokens = 0;

  for (const msg of messages) {
    if (msg.content) {
      messageTokens += estimateTokens(msg.content);
    }
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        // Tool call arguments
        toolResultTokens += estimateTokens(tc.arguments || '');
        // Tool results
        toolResultTokens += estimateTokens(tc.result || '');
      }
    }
  }

  const breakdown: ContextBreakdown[] = [
    { label: 'System tools', tokens: systemToolsTokens },
    { label: 'System prompt', tokens: systemPromptTokens },
    { label: 'Messages', tokens: messageTokens },
    { label: 'Tool results', tokens: toolResultTokens },
  ];

  const total = breakdown.reduce((sum, item) => sum + item.tokens, 0);

  return { breakdown, total, max };
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}

export interface ContextTrackerProps {
  className?: string;
  disabled?: boolean;
}

export const ContextTracker: FC<ContextTrackerProps> = ({
  className,
  disabled = false,
}) => {
  const activeSessionId = useActiveSessionId();
  const messages = useSessionMessages(activeSessionId);
  const selectedModel = useProviderStore((state) => state.selectedModel);
  const models = useModels();

  const { breakdown, total, max } = useMemo(
    () => computeBreakdown(messages, selectedModel, models),
    [messages, selectedModel, models]
  );

  const percentage = max > 0 ? (total / max) * 100 : 0;

  return (
    <TooltipProvider>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                className={cn(
                  'flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg px-2 py-1 border border-muted-foreground/20 hover:bg-accent-foreground/10 transition-all duration-200 focus-visible:outline-none',
                  disabled && 'opacity-50 cursor-not-allowed',
                  className
                )}
              >
                <Gauge size={13} />
                <span className="font-medium">
                  {formatTokenCount(total)}
                </span>
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Context usage</p>
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-64 p-0 bg-card/95 backdrop-blur-md border border-border/50 rounded-lg shadow-glass"
        >
          <div className="px-4 pt-3 pb-2">
            {/* Header */}
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-sm font-medium text-foreground">
                Context
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatTokenCount(total)}/{formatTokenCount(max)}
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  percentage > 90
                    ? 'bg-destructive'
                    : percentage > 70
                      ? 'bg-warning'
                      : 'bg-foreground/70'
                )}
                style={{ width: `${Math.min(percentage, 100)}%` }}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Breakdown */}
          <div className="px-4 py-2.5 flex flex-col gap-1.5">
            {breakdown.map((item) => {
              const itemPct = max > 0 ? (item.tokens / max) * 100 : 0;
              return (
                <div
                  key={item.label}
                  className="flex items-center justify-between"
                >
                  <span className="text-xs text-muted-foreground">
                    {item.label}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {itemPct < 0.05 ? '0.0' : itemPct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
};
