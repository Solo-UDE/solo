import { Check, Loader2, X, Circle } from 'lucide-react';

import type { FC } from 'react';

export interface ProgressStepProps {
  step: number;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  className?: string;
}

export const ProgressStep: FC<ProgressStepProps> = ({
  step,
  description,
  status,
  className = '',
}) => {
  const getStatusIcon = (): React.JSX.Element => {
    switch (status) {
      case 'completed':
        return (
          <div className="w-5 h-5 rounded-full bg-success-muted flex items-center justify-center">
            <Check className="w-3 h-3 text-success" />
          </div>
        );
      case 'in_progress':
        return (
          <div className="w-5 h-5 rounded-full bg-info-muted flex items-center justify-center">
            <Loader2 className="w-3 h-3 text-info animate-spin" />
          </div>
        );
      case 'failed':
        return (
          <div className="w-5 h-5 rounded-full bg-destructive/10 flex items-center justify-center">
            <X className="w-3 h-3 text-destructive" />
          </div>
        );
      case 'pending':
      default:
        return (
          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
            <Circle className="w-3 h-3 text-muted-foreground" />
          </div>
        );
    }
  };

  const getTextColor = (): string => {
    switch (status) {
      case 'completed':
        return 'text-foreground';
      case 'in_progress':
        return 'text-foreground font-medium';
      case 'failed':
        return 'text-destructive';
      case 'pending':
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className={`flex items-start gap-3 ${className}`}>
      {/* Status Icon */}
      {getStatusIcon()}

      {/* Step Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-mono text-muted-foreground">
            {step}.
          </span>
          <span className={`text-xs leading-relaxed ${getTextColor()}`}>
            {description}
          </span>
        </div>
      </div>
    </div>
  );
};
