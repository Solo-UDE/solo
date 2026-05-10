import { Pencil2Icon, ChevronDownIcon } from '@radix-ui/react-icons';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import type { FC } from 'react';

import { VirtualList } from '@/components/ui/virtual-list';
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
  const displayRows = [
    ...displayOldLines.map((line, index) => ({ kind: 'old' as const, line, index })),
    ...(displayOldLines.length > 0 && displayNewLines.length > 0
      ? [{ kind: 'separator' as const, line: '', index: -1 }]
      : []),
    ...displayNewLines.map((line, index) => ({ kind: 'new' as const, line, index })),
  ];

  return (
    <div className="my-2 tool-widget-frame">
      {/* Header */}
      <button
        onClick={() => { setIsExpanded(!isExpanded); }}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors"
      >
        <Pencil2Icon className={`h-4 w-4 shrink-0 ${isRunning ? 'text-muted-foreground animate-pulse' : 'text-warning'}`} />

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground truncate" title={filePath}>
            {fileName}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">(modified)</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isRunning ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-xs">Editing...</span>
            </div>
          ) : (
            <DiffStat additions={additions} deletions={deletions} />
          )}
          <ChevronDownIcon className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Diff preview — max-h animates with ease-out-quart to match Orbit motion feel */}
      <div
        className={`border-t tool-widget-divider overflow-hidden ${isExpanded ? 'max-h-[500px]' : 'max-h-[250px]'}`}
        style={{ transition: 'max-height 250ms cubic-bezier(0.25, 1, 0.5, 1)' }}
      >
        <VirtualList
          items={displayRows}
          estimateSize={() => 20}
          overscan={16}
          measureElement={false}
          className={isExpanded ? 'max-h-[500px]' : 'max-h-[250px]'}
          getItemKey={(row) => `${row.kind}:${row.index}`}
          testId="legacy-edit-tool-lines"
          renderItem={(row) => {
            if (row.kind === 'separator') {
              return <div className="h-px" style={{ background: 'var(--border-tool)' }} />;
            }
            const isDelete = row.kind === 'old';
            return (
              <div className={`flex font-mono text-xs leading-5 ${isDelete ? 'bg-destructive/10' : 'bg-success/10'}`}>
                <div className={`w-1 shrink-0 ${isDelete ? 'bg-destructive' : 'bg-success'}`} />
                <div className={`w-6 px-1 text-center select-none shrink-0 ${isDelete ? 'text-destructive/70' : 'text-success/70'}`}>
                  {isDelete ? '-' : '+'}
                </div>
                <div className={`flex-1 px-3 whitespace-pre overflow-x-auto ${isDelete ? 'text-foreground/70' : 'text-foreground'}`}>
                  {row.line || ' '}
                </div>
              </div>
            );
          }}
        />

        {/* Expand bar */}
        {hasMore && !isExpanded ? (
          <button
            onClick={() => { setIsExpanded(true); }}
            className="w-full py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors border-t tool-widget-divider flex items-center justify-center gap-1"
          >
            <ChevronDownIcon className="h-3 w-3" />
            <span>Show all changes</span>
          </button>
        ) : null}
      </div>
    </div>
  );
};
