import { Terminal } from '@phosphor-icons/react';

import { CollapsibleOutput } from './collapsible-output';
import { ToolStatusIndicator } from './tool-status-indicator';

import type { AgentToolCall } from '../agent-message';
import type { FC } from 'react';

export interface BashToolBlockProps {
  toolCall: AgentToolCall;
  className?: string;
}

export const BashToolBlock: FC<BashToolBlockProps> = ({ toolCall, className = '' }) => {
  const args = parseArgs(toolCall.arguments);
  const command = String(args.command ?? '');
  const cwd = String(args.cwd ?? '.');
  const hasResult = toolCall.result !== undefined && toolCall.result.trim().length > 0;

  return (
    <div className={`rounded-[12px] bg-card/95 backdrop-blur-sm shadow-[0_2px_12px_-4px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.4)] overflow-hidden ${className}`}>
      <div className="px-3 py-2.5 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-muted/60 flex items-center justify-center flex-shrink-0">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">Bash</span>
            <ToolStatusIndicator status={toolCall.status} />
          </div>
          <code className="text-[11px] font-mono text-muted-foreground truncate block mt-0.5">
            {command}
          </code>
          {cwd !== '.' && (
            <div className="text-[10px] text-muted-foreground/60 mt-0.5">
              cwd: <span className="font-mono">{cwd}</span>
            </div>
          )}
        </div>
      </div>

      {hasResult && (
        <CollapsibleOutput
          output={toolCall.result!}
          defaultExpanded={toolCall.status === 'error'}
        />
      )}
    </div>
  );
};

function parseArgs(argsJson: string): Record<string, unknown> {
  try { return JSON.parse(argsJson); }
  catch { return { raw: argsJson }; }
}
