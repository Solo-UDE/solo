import { Bot, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { StreamdownNarrative } from '../StreamdownNarrative';
import { ExpandRegion } from '../shared/ExpandRegion';

import type { FC } from 'react';

interface TaskToolWidgetProps {
  readonly description: string;
  readonly prompt: string;
  readonly subagentType?: string | undefined;
  readonly model?: string | undefined;
  readonly output?: string | undefined;
  readonly isRunning?: boolean;
}

export const TaskToolWidget: FC<TaskToolWidgetProps> = ({
  description,
  subagentType = 'general-purpose',
  model,
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
        <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">
          {isRunning ? 'Running Task...' : 'Task'}
        </span>
        <span className="text-xs text-muted-foreground truncate">{description}</span>
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted-foreground/10 text-muted-foreground">{subagentType}</span>
          {model ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted-foreground/10 text-foreground/80">{model}</span> : null}
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : null}
        </div>
      </button>

      <ExpandRegion isExpanded={isExpanded}>
        {output ? (
          <div className="p-3 max-h-[300px] overflow-auto chat-surface">
            <StreamdownNarrative
              content={output}
              isStreaming={isRunning}
              className="text-foreground/90 text-xs leading-relaxed"
            />
          </div>
        ) : null}
      </ExpandRegion>
    </div>
  );
};
