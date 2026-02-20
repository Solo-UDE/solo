/**
 * ThinkingBar — Compact reasoning/processing indicator.
 *
 * Displays a shimmer-animated label with optional expand action and stop button.
 * Used as the header for thinking/reasoning blocks and as an inline
 * processing indicator between tool calls.
 */

import { CaretRight } from '@phosphor-icons/react';

import { TextShimmer } from './TextShimmer';
import { ThinkingDots } from './ThinkingDots';
import { cn } from '@/lib/utils';

import type { FC } from 'react';

export interface ThinkingBarProps {
  readonly className?: string;
  /** Label text (default: "Thinking") */
  readonly text?: string;
  /** Show the ThinkingDots grid alongside text */
  readonly showDots?: boolean;
  /** Callback when the bar is clicked (expand/collapse) */
  readonly onClick?: () => void;
  /** Stop/skip thinking callback */
  readonly onStop?: () => void;
  /** Stop button label (default: "Skip thinking") */
  readonly stopLabel?: string;
}

export const ThinkingBar: FC<ThinkingBarProps> = ({
  className,
  text = 'Thinking',
  showDots = true,
  onClick,
  onStop,
  stopLabel = 'Skip thinking',
}) => (
  <div className={cn('flex w-full items-center gap-2', className)}>
    {/* ThinkingDots grid */}
    {showDots ? (
      <ThinkingDots size={18} speed={1.2} />
    ) : null}

    {/* Clickable shimmer label */}
    {onClick ? (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 text-sm transition-opacity hover:opacity-80"
      >
        <TextShimmer className="font-medium text-xs">{text}</TextShimmer>
        <CaretRight className="text-muted-foreground h-3.5 w-3.5" />
      </button>
    ) : (
      <TextShimmer className="cursor-default font-medium text-xs">{text}</TextShimmer>
    )}

    {/* Spacer */}
    <div className="flex-1" />

    {/* Stop/skip button */}
    {onStop ? (
      <button
        onClick={onStop}
        type="button"
        className="text-muted-foreground hover:text-foreground border-muted-foreground/50 hover:border-foreground border-b border-dotted text-xs transition-colors"
      >
        {stopLabel}
      </button>
    ) : null}
  </div>
);
