import { ChevronDownIcon } from '@radix-ui/react-icons';
import { Terminal, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { ExpandRegion } from '../shared/ExpandRegion';

import type { FC } from 'react';

interface BashToolWidgetProps {
  readonly command: string;
  readonly description?: string | undefined;
  readonly output?: string | undefined;
  readonly isRunning?: boolean;
}

export const BashToolWidget: FC<BashToolWidgetProps> = ({
  command,
  description,
  output,
  isRunning = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const maxCollapsedLines = 10;
  const outputLines = output?.split('\n') ?? [];
  const hasMoreLines = outputLines.length > maxCollapsedLines;
  const displayOutput = isExpanded ? output : outputLines.slice(0, maxCollapsedLines).join('\n');

  return (
    <div className="my-2 tool-widget-frame">
      {/* Header */}
      <button
        onClick={() => { setIsExpanded(!isExpanded); }}
        className={`w-full flex items-center justify-between bg-muted px-3 py-1.5 hover:bg-accent/50 transition-colors ${
          isExpanded ? 'border-b tool-widget-divider' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <Terminal className={`h-3.5 w-3.5 ${isRunning ? 'text-muted-foreground animate-pulse' : 'text-muted-foreground'}`} />
          <span className="text-sm font-medium text-foreground">
            {isRunning ? 'Running Bash' : 'Ran Bash'}
          </span>
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : null}
        </div>
        <ChevronDownIcon className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Collapsible content */}
      <ExpandRegion isExpanded={isExpanded}>
        <>
          {/* Command & Description */}
          <div className="border-b tool-widget-divider space-y-1.5 px-3 py-2">
            <div className="flex items-start gap-2 text-xs">
              <span className="text-muted-foreground shrink-0">Command:</span>
              <code className="flex-1 rounded bg-muted px-1.5 py-0.5 font-mono text-foreground break-all">
                {command}
              </code>
            </div>
            {description ? (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground shrink-0">Description:</span>
                <span className="text-muted-foreground">{description}</span>
              </div>
            ) : null}
          </div>

          {/* Output */}
          <div className="p-3">
            {isRunning && !output ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Running command...</span>
              </div>
            ) : output ? (
              <div className="overflow-x-auto tool-widget-output p-2 font-mono text-xs">
                <pre className="break-words whitespace-pre-wrap text-foreground">
                  {displayOutput}
                </pre>
                {hasMoreLines ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {outputLines.length} lines total
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground italic">
                No output
              </div>
            )}
          </div>
        </>
      </ExpandRegion>
    </div>
  );
};
