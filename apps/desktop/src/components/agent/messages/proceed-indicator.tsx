import { Zap } from 'lucide-react';

import type { FC } from 'react';

export interface ProceedIndicatorProps {
  className?: string;
}

export const ProceedIndicator: FC<ProceedIndicatorProps> = ({
  className = '',
}) => {
  return (
    <div
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning-muted border border-warning/30 ${className}`}
      title="Auto-proceeding"
    >
      <Zap className="w-3 h-3 text-warning" />
      <span className="text-xs font-medium text-warning-foreground">
        Auto-proceed
      </span>
    </div>
  );
};
