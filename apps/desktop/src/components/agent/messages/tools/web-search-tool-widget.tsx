import { Globe, CircleNotch } from '@phosphor-icons/react';
import { useState } from 'react';

import { ExpandRegion } from '../shared/ExpandRegion';

import type { FC } from 'react';

interface WebSearchToolWidgetProps {
  readonly query: string;
  readonly output?: string | undefined;
  readonly isRunning?: boolean;
}

export const WebSearchToolWidget: FC<WebSearchToolWidgetProps> = ({
  query,
  output,
  isRunning = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="my-2 tool-widget-frame">
      <button
        onClick={() => { setIsExpanded(!isExpanded); }}
        className={`w-full flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-accent/50 transition-colors ${isExpanded ? 'border-b tool-widget-divider' : ''}`}
      >
        <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">
          {isRunning ? 'Searching web...' : 'Web Search'}
        </span>
        <span className="text-xs text-muted-foreground truncate">{query}</span>
        {isRunning ? <CircleNotch className="h-3 w-3 animate-spin text-muted-foreground ml-auto" /> : null}
      </button>

      <ExpandRegion isExpanded={isExpanded}>
        {output ? (
          <div className="p-3 max-h-[300px] overflow-auto">
            <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words">{output}</pre>
          </div>
        ) : null}
      </ExpandRegion>
    </div>
  );
};
