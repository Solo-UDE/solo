import type { FC } from 'react';

import { DotmHex8 } from '@/components/ui/dotm-hex-8';
import { cn } from '@/lib/utils';

export const AgentLoadingGrid: FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <DotmHex8
      ariaLabel="Working"
      boxSize={18}
      className={cn('text-muted-foreground', className)}
      dotSize={3}
      opacityBase={0.2}
      opacityMid={0.5}
      opacityPeak={0.95}
      size={18}
      speed={1.45}
    />
  );
};
