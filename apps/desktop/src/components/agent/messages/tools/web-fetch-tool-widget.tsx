import { GlobeIcon } from '@radix-ui/react-icons';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { ExpandRegion } from '../shared/ExpandRegion';
import { VirtualTextLines } from '@/components/ui/virtual-list';

import type { FC } from 'react';

interface WebFetchToolWidgetProps {
  readonly url: string;
  readonly prompt: string;
  readonly output?: string | undefined;
  readonly isRunning?: boolean;
}

export const WebFetchToolWidget: FC<WebFetchToolWidgetProps> = ({
  url,
  prompt,
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
          {isRunning ? 'Fetching...' : 'Web Fetch'}
        </span>
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">{url}</span>
        {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" /> : null}
      </button>

      <ExpandRegion isExpanded={isExpanded}>
        <div className="p-3 space-y-2">
          {prompt ? (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Prompt:</span> {prompt}
            </div>
          ) : null}
          {output ? (
            <VirtualTextLines
              lines={lines}
              estimateSize={() => 20}
              overscan={16}
              className="max-h-[300px] font-mono text-xs"
              lineClassName="whitespace-pre text-foreground"
              testId="legacy-web-fetch-output"
            />
          ) : null}
        </div>
      </ExpandRegion>
    </div>
  );
};
