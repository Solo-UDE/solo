import { ShieldCheck } from 'lucide-react';
import React from 'react';

import { cn } from '../../../lib/utils';

export interface AcceptModeToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

export const AcceptModeToggle: React.FC<AcceptModeToggleProps> = ({
  enabled,
  onChange,
  disabled = false,
}) => {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      title={enabled ? 'Disable auto-approve' : 'Auto-approve all tool actions'}
      className={cn(
        'inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-[8px]',
        'text-xs font-medium',
        'active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30',
        'transition-[transform,background-color,color] duration-200',
        enabled
          ? 'glow-active text-primary'
          : 'bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <ShieldCheck className="h-4 w-4" />
      <span>Accept</span>
    </button>
  );
};
