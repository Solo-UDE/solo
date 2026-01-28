/**
 * MarkdownToggle - Button to toggle markdown preview pane
 * Shows PanelRight/PanelRightClose icon based on preview state
 */

import { PanelRight, PanelRightClose } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MarkdownToggleProps {
  enabled: boolean;
  onToggle: () => void;
  className?: string;
}

export function MarkdownToggle({ enabled, onToggle, className }: MarkdownToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'flex items-center justify-center gap-1.5',
        'h-7 px-2 rounded-lg',
        'text-muted-foreground',
        'hover:bg-muted/60 hover:text-foreground',
        'hover:scale-[1.02] active:scale-[0.97]',
        'transition-all duration-200',
        enabled && 'bg-primary/10 text-primary',
        className
      )}
      title={enabled ? 'Hide preview' : 'Show preview'}
      aria-label={enabled ? 'Hide markdown preview' : 'Show markdown preview'}
      aria-pressed={enabled}
    >
      {enabled ? (
        <PanelRightClose className="w-4 h-4" />
      ) : (
        <PanelRight className="w-4 h-4" />
      )}
    </button>
  );
}
