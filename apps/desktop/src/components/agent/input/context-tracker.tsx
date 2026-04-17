import { useMemo } from 'react';
import { Gauge } from 'lucide-react';
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
import { toolbarButtonBase } from './toolbar-button-class';

import type { FC } from 'react';
import type { Message } from '../../../stores/agentStore';
import type { ModelInfo } from '../../../lib/backend';
import type { TokenUsage } from '../../../types/agent-protocol';

// Char-per-token heuristic used only before the first API usage report lands.
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

/**
 * The SDK's Result message carries a `usage` object describing exactly how many
 * tokens the API saw for *that* turn. The most recent turn's usage is the
 * ground truth for current context occupancy — no estimation needed.
 *
 * Total context occupancy = input + cache_creation + cache_read.
 * All three consume the context window; they only differ in billing tier.
 * Output tokens are the model's reply and are NOT part of the input budget.
 */
function findLatestUsage(messages: Message[]): TokenUsage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.usage) return msg.usage;
  }
  return null;
}

function computeBreakdown(messages: Message[], modelId: string | null, models: ModelInfo[]): {
  breakdown: ContextBreakdown[];
  total: number;
  max: number;
  source: 'real' | 'estimate';
} {
  const max = getContextWindow(modelId, models);
  const latestUsage = findLatestUsage(messages);

  if (latestUsage) {
    // Authoritative: report exactly what the API counted on the last turn.
    const fresh = latestUsage.inputTokens;
    const cacheCreation = latestUsage.cacheCreationInputTokens ?? 0;
    const cacheRead = latestUsage.cacheReadInputTokens ?? 0;
    const total = fresh + cacheCreation + cacheRead;

    const breakdown: ContextBreakdown[] = [
      { label: 'Input (fresh)', tokens: fresh },
      { label: 'Cache write', tokens: cacheCreation },
      { label: 'Cache read', tokens: cacheRead },
    ];

    return { breakdown, total, max, source: 'real' };
  }

  // Pre-first-turn fallback: heuristic estimate so the gauge shows something
  // reasonable before any API call has returned usage data.
  const systemPromptTokens = 3000; // base system prompt
  const systemToolsTokens = 1500; // tool definitions
  let messageTokens = 0;
  let toolResultTokens = 0;

  for (const msg of messages) {
    if (msg.content) messageTokens += estimateTokens(msg.content);
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const inputStr = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input || '');
        toolResultTokens += estimateTokens(inputStr);
        toolResultTokens += estimateTokens(tc.output || '');
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
  return { breakdown, total, max, source: 'estimate' };
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

  const { breakdown, total, max, source } = useMemo(
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
                  toolbarButtonBase,
                  disabled && 'opacity-50 cursor-not-allowed',
                  className
                )}
              >
                <Gauge size={13} />
                <span className="text-xs font-medium">
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
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-foreground">
                  Context
                </span>
                <span
                  className={cn(
                    'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded',
                    source === 'real'
                      ? 'bg-success/15 text-success'
                      : 'bg-muted text-muted-foreground'
                  )}
                  title={
                    source === 'real'
                      ? 'Reported by the API on the last turn'
                      : 'Rough estimate (no API usage yet)'
                  }
                >
                  {source === 'real' ? 'live' : 'est'}
                </span>
              </div>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatTokenCount(total)}/{formatTokenCount(max)}
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-300',
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
