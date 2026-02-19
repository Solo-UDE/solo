import { Spinner, Check, X, Warning } from '@phosphor-icons/react';

import type { FC } from 'react';

export type ToolStatus = 'pending' | 'pending_approval' | 'running' | 'completed' | 'error';

export interface ToolStatusIndicatorProps {
  status: ToolStatus;
  className?: string;
}

export const ToolStatusIndicator: FC<ToolStatusIndicatorProps> = ({ status, className = '' }) => {
  switch (status) {
    case 'running':
    case 'pending':
      return <Spinner className={`w-3.5 h-3.5 text-primary animate-spin ${className}`} />;
    case 'completed':
      return <Check className={`w-3.5 h-3.5 text-emerald-500 ${className}`} />;
    case 'error':
      return <X className={`w-3.5 h-3.5 text-destructive ${className}`} />;
    case 'pending_approval':
      return <Warning className={`w-3.5 h-3.5 text-amber-500 ${className}`} />;
  }
};
