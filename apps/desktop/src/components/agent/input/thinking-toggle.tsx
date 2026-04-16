import { Lightbulb } from 'lucide-react';
import React from 'react';

import { cn } from '../../../lib/utils';

export interface ThinkingToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

export const ThinkingToggle: React.FC<ThinkingToggleProps> = ({
  enabled,
  onChange,
  disabled = false,
}) => {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      title={enabled ? 'Disable extended thinking' : 'Enable extended thinking'}
      className={cn(
        'inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-[8px]',
        'text-xs font-medium',
        'active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30',
        'transition-[transform,background-color,color] duration-200',
        enabled
          ? 'text-info'
          : 'bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      style={enabled ? {
        background: 'radial-gradient(ellipse 80% 50% at center, oklch(from var(--info) l c h / 15%) 0%, transparent 70%)',
      } : undefined}
    >
      <Lightbulb className="h-4 w-4" />
      <span>Think</span>
    </button>
  );
};
