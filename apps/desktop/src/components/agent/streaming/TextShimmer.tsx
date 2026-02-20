/**
 * TextShimmer — Animated gradient text effect.
 *
 * Creates a shimmer that sweeps across text content,
 * transitioning between muted and foreground colors.
 * Used in ThinkingBar for the "Thinking..." label.
 */

import { cn } from '@/lib/utils';

import type { FC, ReactNode } from 'react';

export interface TextShimmerProps {
  readonly children: ReactNode;
  /** Duration of one shimmer cycle in seconds (default: 4) */
  readonly duration?: number;
  /** Gradient spread percentage (default: 20, clamped 5-45) */
  readonly spread?: number;
  readonly className?: string;
}

export const TextShimmer: FC<TextShimmerProps> = ({
  children,
  duration = 4,
  spread = 20,
  className,
}) => {
  const dynamicSpread = Math.min(Math.max(spread, 5), 45);

  return (
    <span
      className={cn(
        'bg-clip-text font-medium text-transparent',
        'animate-[shimmer_4s_infinite_linear]',
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(to right, var(--muted-foreground) ${50 - dynamicSpread}%, var(--foreground) 50%, var(--muted-foreground) ${50 + dynamicSpread}%)`,
        backgroundSize: '200% auto',
        animationDuration: `${duration}s`,
      }}
    >
      {children}
    </span>
  );
};
