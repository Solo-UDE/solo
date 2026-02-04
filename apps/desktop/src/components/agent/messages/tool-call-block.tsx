import { Terminal, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import type { FC } from 'react';

export interface ToolCallBlockProps {
  command: string;
  cwd: string;
  exitCode?: number;
  output?: string;
  className?: string;
}

export const ToolCallBlock: FC<ToolCallBlockProps> = ({
  command,
  cwd,
  exitCode,
  output,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasOutput = output !== undefined && output.trim().length > 0;

  const getExitCodeColor = (code?: number): string => {
    if (code === undefined) return 'text-muted-foreground';
    return code === 0 ? 'text-success' : 'text-destructive';
  };

  return (
    <div className={`border border-border rounded-lg bg-muted/50 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-3 space-y-2">
        {/* Command */}
        <div className="flex items-start gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1">
            <code className="text-xs font-mono text-foreground break-all">
              {command}
            </code>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">cwd:</span>{' '}
              <span className="font-mono">{cwd}</span>
            </div>
          </div>
        </div>

        {/* Status */}
        {exitCode !== undefined && (
          <div className={`text-xs font-medium ${getExitCodeColor(exitCode)}`}>
            Exit Code: {exitCode}
          </div>
        )}
      </div>

      {/* Output Section */}
      {hasOutput ? (
        <>
          <div className="border-t border-border">
            <button
              onClick={() => {
                setIsExpanded(!isExpanded);
              }}
              className="w-full px-3 py-2 flex items-center gap-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <span>Output</span>
            </button>
          </div>

          {isExpanded ? (
            <div className="border-t border-border bg-background p-3 max-h-[400px] overflow-auto">
              <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words">
                {output}
              </pre>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
