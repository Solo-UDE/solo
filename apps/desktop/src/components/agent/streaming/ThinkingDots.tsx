import type { FC } from 'react';

import { DotmHex8 } from '@/components/ui/dotm-hex-8';
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

export const ThinkingDots: FC<ThinkingDotsProps> = ({
  className,
  size = 24,
  speed = 1.2,
  color = 'currentColor',
}) => {
  const dotSize = Math.max(3, Math.round(size / 5.8));
  return (
    <DotmHex8
      ariaLabel="Loading"
      boxSize={size}
      className={cn('inline-flex shrink-0 text-primary', className)}
      color={color}
      dotSize={dotSize}
      opacityBase={0.18}
      opacityMid={0.52}
      opacityPeak={1}
      size={size}
      speed={speed}
    />
  );
};
