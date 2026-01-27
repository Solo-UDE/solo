/**
 * MarkdownToggle - Button to toggle markdown preview pane
 * Shows Eye/EyeOff icon based on preview state
 */

import { Eye, EyeOff } from 'lucide-react';

interface MarkdownToggleProps {
  enabled: boolean;
  onToggle: () => void;
  className?: string;
}

export function MarkdownToggle({ enabled, onToggle, className = '' }: MarkdownToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center justify-center w-6 h-6 rounded hover:bg-accent/50 transition-colors ${className}`}
      title={enabled ? 'Hide preview' : 'Show preview'}
      aria-label={enabled ? 'Hide markdown preview' : 'Show markdown preview'}
    >
      {enabled ? (
        <EyeOff className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
      ) : (
        <Eye className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
      )}
    </button>
  );
}
