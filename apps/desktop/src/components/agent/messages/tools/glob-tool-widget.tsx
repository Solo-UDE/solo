import { FolderOpen, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { ExpandRegion } from '../shared/ExpandRegion';
import { VirtualList } from '@/components/ui/virtual-list';

import type { FC } from 'react';

interface GlobToolWidgetProps {
  readonly pattern: string;
  readonly path?: string | undefined;
  readonly output?: string | undefined;
  readonly isRunning?: boolean;
}

export const GlobToolWidget: FC<GlobToolWidgetProps> = ({
  pattern,
  output,
  isRunning = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const files = output?.split('\n').filter(Boolean) ?? [];
  const fileCount = files.length;

  return (
    <div className="my-2 tool-widget-frame">
      {/* Header */}
      <button
        onClick={() => { setIsExpanded(!isExpanded); }}
        className={`w-full flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-accent/50 transition-colors ${isExpanded ? 'border-b tool-widget-divider' : ''}`}
      >
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">
          {isRunning ? 'Searching...' : 'Glob'}
        </span>
        <code className="text-xs font-mono text-muted-foreground truncate">{pattern}</code>
        {isRunning ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
        ) : fileCount > 0 ? (
          <span className="text-xs text-muted-foreground ml-auto">{fileCount} files</span>
        ) : null}
      </button>

      <ExpandRegion isExpanded={isExpanded}>
        {files.length > 0 ? (
          <VirtualList
            items={files}
            estimateSize={() => 22}
            overscan={10}
            measureElement={false}
            className="max-h-[200px] p-2"
            getItemKey={(file, i) => `${i}:${file}`}
            testId="legacy-glob-tool-files"
            renderItem={(file) => (
              <div className="text-xs font-mono text-foreground/80 py-0.5 px-2 truncate">
                {file}
              </div>
            )}
          />
        ) : null}
      </ExpandRegion>
    </div>
  );
};
