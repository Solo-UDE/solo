import { FilePlus, CaretDown, CircleNotch } from '@phosphor-icons/react';
import { useState } from 'react';

import type { FC } from 'react';

import { DiffStat } from './diff-stat';

interface WriteToolWidgetProps {
  readonly filePath: string;
  readonly content: string;
  readonly isRunning?: boolean;
}

export const WriteToolWidget: FC<WriteToolWidgetProps> = ({
  filePath,
  content,
  isRunning = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const fileName = filePath.split('/').pop() ?? filePath;
  const lines = content.split('\n');
  const additions = lines.length;

  const maxCollapsedLines = 6;
  const displayLines = isExpanded ? lines : lines.slice(0, maxCollapsedLines);
  const hasMore = lines.length > maxCollapsedLines;

  return (
    <div className="my-2 rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => { setIsExpanded(!isExpanded); }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors"
      >
        <FilePlus className={`h-4 w-4 shrink-0 ${isRunning ? 'text-muted-foreground animate-pulse' : 'text-success'}`} />

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground truncate" title={filePath}>
            {fileName}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">(new)</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isRunning ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CircleNotch className="h-3 w-3 animate-spin" />
              <span className="text-xs">Writing...</span>
            </div>
          ) : (
            <DiffStat additions={additions} deletions={0} />
          )}
          <CaretDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Content preview */}
      <div className={`border-t border-border overflow-hidden transition-all ${isExpanded ? 'max-h-[500px]' : 'max-h-[200px]'}`}>
        <div className="overflow-auto">
          {displayLines.map((line, index) => (
            <div key={`line-${String(index)}`} className="flex font-mono text-xs leading-5 bg-success/10">
              <div className="w-1 bg-success shrink-0" />
              <div className="w-8 px-1 text-right text-success/50 select-none shrink-0">{index + 1}</div>
              <div className="flex-1 px-3 text-foreground whitespace-pre overflow-x-auto">{line || ' '}</div>
            </div>
          ))}
        </div>

        {hasMore && !isExpanded ? (
          <button
            onClick={() => { setIsExpanded(true); }}
            className="w-full py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors border-t border-border flex items-center justify-center gap-1"
          >
            <CaretDown className="h-3 w-3" />
            <span>Show all ({lines.length} lines)</span>
          </button>
        ) : null}
      </div>
    </div>
  );
};
