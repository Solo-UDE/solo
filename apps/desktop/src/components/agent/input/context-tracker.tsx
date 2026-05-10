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
import { DEFAULT_MODEL_ID } from '../../../lib/constants';
import { cn } from '../../../lib/utils';
import { toolbarButtonBase } from './toolbar-button-class';
import { computeContextUsage, formatTokenCount } from './context-usage';

import type { FC } from 'react';

export interface ContextTrackerProps {
  className?: string;
  disabled?: boolean;
  sessionId?: string | null;
  modelId?: string | null;
  draftContent?: string;
}

export const ContextTracker: FC<ContextTrackerProps> = ({
  className,
  disabled = false,
  sessionId,
  modelId,
  draftContent = '',
}) => {
  const fallbackSessionId = useActiveSessionId();
  const effectiveSessionId = sessionId ?? fallbackSessionId;
  const messages = useSessionMessages(effectiveSessionId);
  const selectedModel = useProviderStore((state) => state.selectedModel);
  const models = useModels();
  const effectiveModelId = modelId ?? selectedModel ?? DEFAULT_MODEL_ID;

  const { breakdown, total, max, source } = useMemo(
    () => computeContextUsage(messages, effectiveModelId, models, draftContent),
    [messages, effectiveModelId, models, draftContent]
  );

  const percentage = max > 0 ? (total / max) * 100 : 0;
  const sourceLabel = source === 'real' ? 'live' : source === 'mixed' ? 'live+est' : 'est';
  const sourceTitle =
    source === 'real'
      ? 'Reported by the API on the last completed turn'
      : source === 'mixed'
        ? 'API usage plus an estimate for the current draft'
        : 'Rough estimate until an API usage report is available';

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
                      : source === 'mixed'
                        ? 'bg-warning/15 text-warning'
                      : 'bg-muted text-muted-foreground'
                  )}
                  title={sourceTitle}
                >
                  {sourceLabel}
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
                  <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {formatTokenCount(item.tokens)} · {itemPct < 0.05 ? '0.0' : itemPct.toFixed(1)}%
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
