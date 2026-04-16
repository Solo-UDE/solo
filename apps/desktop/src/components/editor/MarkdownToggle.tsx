/**
 * MarkdownToggle - Segmented control for switching between Preview and Markdown (code) modes.
 */

import { EyeOpenIcon, CodeIcon } from '@radix-ui/react-icons';
import { cn } from '@/lib/utils';

import type { MarkdownMode } from '@/stores/editorStore';

interface MarkdownToggleProps {
  mode: MarkdownMode;
  onModeChange: (mode: MarkdownMode) => void;
  className?: string;
}

export function MarkdownToggle({ mode, onModeChange, className }: MarkdownToggleProps) {
  return (
    <div
      className={cn(
        'flex items-center rounded-md bg-muted/50 p-0.5 gap-0.5',
        className,
      )}
    >
      <button
        onClick={() => onModeChange('preview')}
        className={cn(
          'flex items-center gap-1 px-2 h-5 rounded text-[11px] transition-[background-color,color] duration-150',
          mode === 'preview'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
        title="Preview (Cmd+Shift+M)"
        aria-label="Preview mode"
      >
        <EyeOpenIcon className="w-3 h-3" />
        <span>Preview</span>
      </button>
      <button
        onClick={() => onModeChange('code')}
        className={cn(
          'flex items-center gap-1 px-2 h-5 rounded text-[11px] transition-[background-color,color] duration-150',
          mode === 'code'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
        title="Markdown (Cmd+Shift+M)"
        aria-label="Markdown mode"
      >
        <CodeIcon className="w-3 h-3" />
        <span>Markdown</span>
      </button>
    </div>
  );
}
