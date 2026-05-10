import { GlobeIcon } from '@radix-ui/react-icons';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { ExpandRegion } from '../shared/ExpandRegion';
import { VirtualTextLines } from '@/components/ui/virtual-list';

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
  const lines = output?.split('\n') ?? [];

  return (
    <div className="my-2 tool-widget-frame">
      <button
        onClick={() => { setIsExpanded(!isExpanded); }}
        className={`w-full flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-accent/50 transition-colors ${isExpanded ? 'border-b tool-widget-divider' : ''}`}
      >
        <GlobeIcon width={14} height={14} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">
          {isRunning ? 'Searching web...' : 'Web Search'}
        </span>
        <span className="text-xs text-muted-foreground truncate">{query}</span>
        {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" /> : null}
      </button>

      <ExpandRegion isExpanded={isExpanded}>
        {output ? (
          <VirtualTextLines
            lines={lines}
            estimateSize={() => 20}
            overscan={16}
            className="max-h-[300px] p-3 font-mono text-xs"
            lineClassName="whitespace-pre text-foreground"
            testId="legacy-web-search-output"
          />
        ) : null}
      </ExpandRegion>
    </div>
  );
};
