import { Brain, CaretDown } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { StreamdownNarrative } from './StreamdownNarrative';
import { ThinkingDots } from '../streaming/ThinkingDots';
import { TextShimmer } from '../streaming/TextShimmer';

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
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const wasStreamingRef = useRef(false);

  // Auto-expand when streaming starts, auto-collapse when streaming ends
  useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      setIsExpanded(true);
    } else if (!isStreaming && wasStreamingRef.current) {
      setIsExpanded(false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const toggleExpanded = (): void => {
    setIsExpanded(!isExpanded);
  };

  const durationText = formatDuration(thinkingDurationMs);

  return (
    <div className="rounded-xl border-l-2 border-primary/20 bg-muted/20 overflow-hidden mb-3 transition-all duration-200">
      {/* Header */}
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-expanded={isExpanded}
        aria-label={`Thought for ${durationText}, ${isExpanded ? 'expanded' : 'collapsed'}`}
      >
        {/* During streaming: ThinkingDots grid + shimmer label */}
        {isStreaming ? (
          <>
            <ThinkingDots size={18} speed={1.2} />
            <TextShimmer className="text-xs font-medium" duration={3}>
              Deep reasoning in progress
            </TextShimmer>
          </>
        ) : (
          <>
            {/* After streaming: Brain icon + static label */}
            <Brain className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium">
              Thought for {durationText}
            </span>
            {/* Duration badge */}
            {thinkingDurationMs > 0 ? (
              <span className="rounded-full bg-muted/40 text-[10px] px-2 py-0.5 tabular-nums text-muted-foreground">
                {durationText}
              </span>
            ) : null}
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Expand/collapse caret */}
        <CaretDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
            isExpanded ? 'rotate-0' : '-rotate-90'
          }`}
        />
      </button>

      {/* Collapsible Content — CSS grid-rows transition */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden min-h-0">
          <div className="px-3 pb-3 pt-1">
            <StreamdownNarrative
              content={thinking}
              isStreaming={isStreaming}
              className="text-muted-foreground/80 text-sm leading-relaxed"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
