import { MagnifyingGlass, CircleNotch } from '@phosphor-icons/react';
import { useState } from 'react';

import { ExpandRegion } from '../shared/ExpandRegion';

import type { FC } from 'react';

interface GrepToolWidgetProps {
  readonly pattern: string;
  readonly path?: string | undefined;
  readonly outputMode?: string | undefined;
  readonly glob?: string | undefined;
  readonly fileType?: string | undefined;
  readonly output?: string | undefined;
  readonly isRunning?: boolean;
}

export const GrepToolWidget: FC<GrepToolWidgetProps> = ({
  pattern,
  output,
  isRunning = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const lines = output?.split('\n').filter(Boolean) ?? [];
  const matchCount = lines.length;

  return (
    <div className="my-2 tool-widget-frame">
      {/* Header */}
      <button
        onClick={() => { setIsExpanded(!isExpanded); }}
        className={`w-full flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-accent/50 transition-colors ${isExpanded ? 'border-b tool-widget-divider' : ''}`}
      >
        <MagnifyingGlass className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">
          {isRunning ? 'Searching...' : 'Grep'}
        </span>
        <code className="text-xs font-mono text-muted-foreground truncate">{pattern}</code>
        {isRunning ? (
          <CircleNotch className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
        ) : matchCount > 0 ? (
          <span className="text-xs text-muted-foreground ml-auto">{matchCount} results</span>
        ) : null}
      </button>

      <ExpandRegion isExpanded={isExpanded}>
        {lines.length > 0 ? (
          <div className="p-2 max-h-[300px] overflow-auto font-mono text-xs">
            {lines.slice(0, 50).map((line, i) => (
              <div key={`result-${String(i)}`} className="text-foreground/80 py-0.5 px-2 truncate hover:bg-accent/30">
                {line}
              </div>
            ))}
            {lines.length > 50 ? (
              <div className="text-muted-foreground px-2 py-1">
                +{lines.length - 50} more results...
              </div>
            ) : null}
          </div>
        ) : null}
      </ExpandRegion>
    </div>
  );
};
