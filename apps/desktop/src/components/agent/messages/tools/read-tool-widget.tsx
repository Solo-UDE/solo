import { FileText, CircleNotch } from '@phosphor-icons/react';

import type { FC } from 'react';

interface ReadToolWidgetProps {
  readonly filePath: string;
  readonly isRunning?: boolean;
  readonly content?: string | undefined;
}

export const ReadToolWidget: FC<ReadToolWidgetProps> = ({
  filePath,
  isRunning = false,
  content,
}) => {
  const fileName = filePath.split('/').pop() ?? filePath;
  const lineCount = content ? content.split('\n').length : undefined;

  return (
    <div className="my-1 inline-flex items-center gap-1.5 px-2 py-1 rounded-md tool-widget-inline-chip">
      {isRunning ? (
        <CircleNotch className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
      ) : (
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
      <span className="text-xs font-medium text-foreground">{isRunning ? 'Reading' : 'Read'}</span>
      <span className="text-xs font-mono text-foreground/80 truncate max-w-[200px]" title={filePath}>
        {fileName}
      </span>
      {lineCount !== undefined ? (
        <span className="text-xs text-muted-foreground">({lineCount} lines)</span>
      ) : null}
    </div>
  );
};
