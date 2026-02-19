import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

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
    <div className="rounded-md border border-border/50 bg-muted/30 overflow-hidden mb-3 transition-all duration-200">
      {/* Header */}
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-expanded={isExpanded}
        aria-label={`Thought for ${durationText}, ${isExpanded ? 'expanded' : 'collapsed'}`}
      >
        <span className="text-xs font-medium">
          {isStreaming ? 'Thinking...' : `Thought for ${durationText}`}
        </span>
        {isExpanded ? (
          <CaretDown className="h-4 w-4 shrink-0" />
        ) : (
          <CaretRight className="h-4 w-4 shrink-0" />
        )}
      </button>

      {/* Collapsible Content */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-3 pb-3 pt-1">
          <div className="text-sm text-muted-foreground/80 leading-relaxed whitespace-pre-wrap">
            {thinking}
          </div>
        </div>
      </div>
    </div>
  );
};
