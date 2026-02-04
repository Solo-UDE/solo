import { Terminal, CaretRight } from '@phosphor-icons/react';
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
              <CaretRight className={`w-3 h-3 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
              <span>Output</span>
            </button>
          </div>

          <div className={`grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="border-t border-border bg-background p-3 max-h-[400px] overflow-auto">
                <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words">
                  {output}
                </pre>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
