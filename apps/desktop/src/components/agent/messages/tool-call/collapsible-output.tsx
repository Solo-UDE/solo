import { CaretRight, Copy } from '@phosphor-icons/react';
import { useState } from 'react';

import type { FC } from 'react';

const MAX_LINES = 100;

export interface CollapsibleOutputProps {
  output: string;
  defaultExpanded?: boolean;
  className?: string;
}

export const CollapsibleOutput: FC<CollapsibleOutputProps> = ({
  output,
  defaultExpanded = false,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);

  const lines = output.split('\n');
  const isLong = lines.length > MAX_LINES;
  const displayedOutput = isLong && !showAll
    ? lines.slice(0, MAX_LINES).join('\n')
    : output;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => { setCopied(false); }, 1500);
  };

  return (
    <div className={className}>
      <div className="border-t border-border/30">
        <button
          onClick={() => { setIsExpanded(!isExpanded); }}
          className="w-full px-3 py-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/30 transition-colors duration-150"
        >
          <CaretRight className={`w-3 h-3 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
          <span>Output</span>
          <span className="text-muted-foreground/50 ml-auto">{lines.length} lines</span>
        </button>
      </div>

      <div className={`grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="border-t border-border/30 bg-muted/20 p-3 max-h-[400px] overflow-auto relative group">
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 p-1 rounded-md bg-muted/60 opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity duration-150"
              title="Copy output"
            >
              <Copy className="w-3 h-3 text-muted-foreground" />
              {copied && (
                <span className="absolute -top-6 right-0 text-[10px] text-primary bg-background px-1.5 py-0.5 rounded shadow-sm">
                  Copied
                </span>
              )}
            </button>
            <pre className="text-[11px] font-mono text-foreground whitespace-pre-wrap break-words">
              {displayedOutput}
            </pre>
            {isLong && !showAll && (
              <button
                onClick={() => { setShowAll(true); }}
                className="mt-2 text-[11px] text-primary hover:underline"
              >
                Show all {lines.length} lines
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
