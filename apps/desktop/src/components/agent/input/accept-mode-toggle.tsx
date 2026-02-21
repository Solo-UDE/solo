import { ShieldCheck } from '@phosphor-icons/react';
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
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all duration-150',
        'text-sm font-medium',
        enabled
          ? 'bg-warning/10 text-warning border border-warning/20'
          : 'border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <ShieldCheck className="h-4 w-4" weight={enabled ? 'fill' : 'regular'} />
      <span>Accept</span>
    </button>
  );
};
