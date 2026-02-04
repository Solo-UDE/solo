/**
 * MarkdownToggle - Single button that cycles through markdown modes.
 * Cycle: off → split → rendered → raw → off
 */

import { SidebarSimple, Eye, Code, Columns } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

import type { MarkdownMode } from '@/stores/editorStore';

interface MarkdownToggleProps {
  mode: MarkdownMode;
  onCycle: () => void;
  className?: string;
}

const MODE_ICONS: Record<MarkdownMode, typeof Eye> = {
  off: SidebarSimple,
  split: Columns,
  rendered: Eye,
  raw: Code,
};

const MODE_LABELS: Record<MarkdownMode, string> = {
  off: 'Preview off',
  split: 'Split view',
  rendered: 'Preview only',
  raw: 'Source only',
};

export function MarkdownToggle({ mode, onCycle, className }: MarkdownToggleProps) {
  const Icon = MODE_ICONS[mode];
  const label = MODE_LABELS[mode];

  return (
    <button
      onClick={onCycle}
      className={cn(
        'flex items-center justify-center',
        'h-7 px-2 rounded-lg',
        'text-muted-foreground',
        'hover:bg-muted/60 hover:text-foreground',
        'hover:scale-[1.02] active:scale-[0.97]',
        'transition-all duration-200',
        mode !== 'off' && 'bg-primary/10 text-primary',
        className,
      )}
      title={`${label} (Cmd+Shift+M to cycle)`}
      aria-label={`Markdown: ${label}. Click to cycle.`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
