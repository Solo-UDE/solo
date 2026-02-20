import { Globe, CircleNotch } from '@phosphor-icons/react';
import { useState } from 'react';

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

  return (
    <div className="my-2 rounded-md border border-border bg-card overflow-hidden">
      <button
        onClick={() => { setIsExpanded(!isExpanded); }}
        className={`w-full flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-accent/50 transition-colors ${isExpanded ? 'border-b border-border' : ''}`}
      >
        <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">
          {isRunning ? 'Fetching...' : 'Web Fetch'}
        </span>
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">{url}</span>
        {isRunning ? <CircleNotch className="h-3 w-3 animate-spin text-muted-foreground ml-auto" /> : null}
      </button>

      {isExpanded ? (
        <div className="p-3 space-y-2 max-h-[300px] overflow-auto">
          {prompt ? (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Prompt:</span> {prompt}
            </div>
          ) : null}
          {output ? (
            <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words">{output}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
