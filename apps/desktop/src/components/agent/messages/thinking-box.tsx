import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import { ShineFx } from '@/components/ai-elements/shimmer';

import type { FC } from 'react';

interface ThinkingBoxProps {
  readonly thinking: string;
  readonly thinkingDurationMs?: number | undefined;
  readonly defaultExpanded?: boolean | undefined;
  /** When true, auto-expand; when transitions to false, auto-collapse */
  readonly isStreaming?: boolean | undefined;
}

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${String(seconds)} second${seconds !== 1 ? 's' : ''}`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${String(minutes)} minute${minutes !== 1 ? 's' : ''}`;
  }
  return `${String(minutes)}m ${String(remainingSeconds)}s`;
};

export const ThinkingBox: FC<ThinkingBoxProps> = ({
  thinking,
  thinkingDurationMs = 0,
  defaultExpanded = false,
  isStreaming = false,
}) => {
  const durationSeconds = thinkingDurationMs > 0
    ? Math.max(1, Math.ceil(thinkingDurationMs / 1000))
    : undefined;

  return (
    <Reasoning
      className="mb-3 overflow-hidden rounded-lg border transition-all duration-200"
      defaultOpen={isStreaming || defaultExpanded}
      duration={durationSeconds}
      isStreaming={isStreaming}
      style={{ borderColor: 'var(--border-tool)', background: 'var(--tool-output-bg)' }}
    >
      <ReasoningTrigger
        className="px-3 py-2 text-sm hover:bg-muted/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        getThinkingMessage={(streaming, duration) => {
          const durationText = duration ? formatDuration(duration * 1000) : 'a few seconds';

          if (streaming) {
            return (
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <ShineFx
                  as="span"
                  className="text-xs font-medium"
                  duration={1.4}
                  variant="body-default-sm"
                >
                  Reasoning
                </ShineFx>
                {duration ? (
                  <span className="tabular-nums text-muted-foreground/60">
                    {durationText}
                  </span>
                ) : null}
              </span>
            );
          }

          return (
            <span className="text-xs font-medium">
              Thought for {durationText}
            </span>
          );
        }}
      />

      <ReasoningContent
        className="px-3 pb-3 pt-1 text-sm leading-relaxed text-muted-foreground/80"
        isStreaming={isStreaming}
      >
        {thinking}
      </ReasoningContent>
    </Reasoning>
  );
};
