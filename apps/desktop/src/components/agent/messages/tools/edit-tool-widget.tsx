import { PencilSimple, CaretDown, CircleNotch } from '@phosphor-icons/react';
import { useState } from 'react';

import type { FC } from 'react';

import { DiffStat } from './diff-stat';

interface EditToolWidgetProps {
  readonly filePath: string;
  readonly oldString: string;
  readonly newString: string;
  readonly isRunning?: boolean;
}

export const EditToolWidget: FC<EditToolWidgetProps> = ({
  filePath,
  oldString,
  newString,
  isRunning = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const fileName = filePath.split('/').pop() ?? filePath;
  const oldLines = oldString.split('\n');
  const newLines = newString.split('\n');
  const deletions = oldLines.length;
  const additions = newLines.length;

  const maxCollapsedLines = 4;
  const displayOldLines = isExpanded ? oldLines : oldLines.slice(0, maxCollapsedLines);
  const displayNewLines = isExpanded ? newLines : newLines.slice(0, maxCollapsedLines);
  const hasMore = oldLines.length > maxCollapsedLines || newLines.length > maxCollapsedLines;

  return (
    <div className="my-2 rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => { setIsExpanded(!isExpanded); }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors"
      >
        <PencilSimple className={`h-4 w-4 shrink-0 ${isRunning ? 'text-muted-foreground animate-pulse' : 'text-warning'}`} />

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground truncate" title={filePath}>
            {fileName}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">(modified)</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isRunning ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CircleNotch className="h-3 w-3 animate-spin" />
              <span className="text-xs">Editing...</span>
            </div>
          ) : (
            <DiffStat additions={additions} deletions={deletions} />
          )}
          <CaretDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Diff preview */}
      <div className={`border-t border-border overflow-hidden transition-all ${isExpanded ? 'max-h-[500px]' : 'max-h-[250px]'}`}>
        <div className="overflow-auto">
          {/* Deleted lines (old) */}
          {displayOldLines.map((line, index) => (
            <div key={`old-${String(index)}`} className="flex font-mono text-xs leading-5 bg-destructive/10">
              <div className="w-1 bg-destructive shrink-0" />
              <div className="w-6 px-1 text-center text-destructive/70 select-none shrink-0">-</div>
              <div className="flex-1 px-3 text-foreground/70 whitespace-pre overflow-x-auto">{line || ' '}</div>
            </div>
          ))}

          {/* Separator */}
          {displayOldLines.length > 0 && displayNewLines.length > 0 ? (
            <div className="h-px bg-border" />
          ) : null}

          {/* Added lines (new) */}
          {displayNewLines.map((line, index) => (
            <div key={`new-${String(index)}`} className="flex font-mono text-xs leading-5 bg-success/10">
              <div className="w-1 bg-success shrink-0" />
              <div className="w-6 px-1 text-center text-success/70 select-none shrink-0">+</div>
              <div className="flex-1 px-3 text-foreground whitespace-pre overflow-x-auto">{line || ' '}</div>
            </div>
          ))}
        </div>

        {/* Expand bar */}
        {hasMore && !isExpanded ? (
          <button
            onClick={() => { setIsExpanded(true); }}
            className="w-full py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors border-t border-border flex items-center justify-center gap-1"
          >
            <CaretDown className="h-3 w-3" />
            <span>Show all changes</span>
          </button>
        ) : null}
      </div>
    </div>
  );
};
