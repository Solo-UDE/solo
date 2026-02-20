/**
 * ThinkingDots — 3×3 CSS grid with diagonal wave sweep.
 *
 * Cells on the same diagonal (row+col) animate together,
 * creating a shimmer that travels from top-left to bottom-right.
 */
import { useRef } from 'react';

import type { FC } from 'react';

import { cn } from '@/lib/utils';

interface ThinkingDotsProps {
  readonly className?: string;
  /** Size of the grid in pixels (default: 24) */
  readonly size?: number;
  /** Animation cycle duration in seconds (default: 1.2) */
  readonly speed?: number;
  /** Dot color — defaults to currentColor for theme compatibility */
  readonly color?: string;
}

/**
 * Diagonal index (row+col) for each cell in row-major order.
 *
 * Grid layout:
 *   (0,0)=0  (0,1)=1  (0,2)=2
 *   (1,0)=1  (1,1)=2  (1,2)=3
 *   (2,0)=2  (2,1)=3  (2,2)=4
 *
 * Cells sharing the same diagonal value light up simultaneously.
 */
const DIAG = [0, 1, 2, 1, 2, 3, 2, 3, 4] as const;

/** Milliseconds between successive diagonal wave fronts */
const DELAY_STEP = 120;

let instanceCounter = 0;

export const ThinkingDots: FC<ThinkingDotsProps> = ({
  className,
  size = 24,
  speed = 1.2,
  color = 'currentColor',
}) => {
  const id = useRef(`td-${String(++instanceCounter)}`).current;
  const cellSize = Math.round(size / 3 - (2 * 2) / 3);
  const gap = Math.max(1, Math.round(size * 0.095));
  const borderRadius = Math.max(1, Math.round(cellSize * 0.2));

  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn('text-primary inline-grid shrink-0', className)}
      style={{
        gridTemplateColumns: `repeat(3, ${String(cellSize)}px)`,
        gridTemplateRows: `repeat(3, ${String(cellSize)}px)`,
        gap: `${String(gap)}px`,
      }}
    >
      <style>{`
        @keyframes ${id}-sweep {
          0%, 70%, 100% { opacity: 0.12; }
          25% { opacity: 1; }
        }
      `}</style>
      {DIAG.map((diag, i) => (
        <span
          key={i}
          style={{
            width: cellSize,
            height: cellSize,
            borderRadius,
            background: color,
            opacity: 0.12,
            animation: `${id}-sweep ${String(speed)}s ease-in-out infinite`,
            animationDelay: `${String(diag * DELAY_STEP)}ms`,
          }}
        />
      ))}
    </div>
  );
};
