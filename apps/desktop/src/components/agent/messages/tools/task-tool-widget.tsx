import { Robot, CircleNotch } from '@phosphor-icons/react';
import { useState } from 'react';

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
    <div className="my-2 rounded-md border border-border bg-card overflow-hidden">
      <button
        onClick={() => { setIsExpanded(!isExpanded); }}
        className={`w-full flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-accent/50 transition-colors ${isExpanded ? 'border-b border-border' : ''}`}
      >
        <Robot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">
          {isRunning ? 'Running Task...' : 'Task'}
        </span>
        <span className="text-xs text-muted-foreground truncate">{description}</span>
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted-foreground/10 text-muted-foreground">{subagentType}</span>
          {model ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{model}</span> : null}
          {isRunning ? <CircleNotch className="h-3 w-3 animate-spin text-muted-foreground" /> : null}
        </div>
      </button>

      {isExpanded && output ? (
        <div className="p-3 max-h-[300px] overflow-auto">
          <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words">{output}</pre>
        </div>
      ) : null}
    </div>
  );
};
