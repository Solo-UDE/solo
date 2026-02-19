import { Terminal, CaretRight, CircleNotch, CheckCircle, XCircle } from '@phosphor-icons/react';
import { useState } from 'react';

import type { FC } from 'react';

export interface ToolCallBlockProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  output?: string;
  className?: string;
}

const formatToolName = (name: string): string => {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'running':
      return <CircleNotch className="w-3.5 h-3.5 text-muted-foreground animate-spin" />;
    case 'success':
      return <CheckCircle className="w-3.5 h-3.5 text-success" weight="fill" />;
    case 'error':
      return <XCircle className="w-3.5 h-3.5 text-destructive" weight="fill" />;
    default:
      return null;
  }
};

const getHeaderLabel = (toolName: string, status: string): string => {
  const name = formatToolName(toolName);
  return status === 'running' ? `Running ${name}` : `Ran ${name}`;
};

/** Get the primary display value for a tool (command, file path, pattern, etc.) */
const getPrimaryDisplay = (toolName: string, toolInput: Record<string, unknown>): string | null => {
  const name = toolName.toLowerCase();
  if (name === 'bash') return typeof toolInput['command'] === 'string' ? toolInput['command'] : null;
  if (name === 'read' || name === 'write' || name === 'edit') return typeof toolInput['file_path'] === 'string' ? toolInput['file_path'] : null;
  if (name === 'glob') return typeof toolInput['pattern'] === 'string' ? toolInput['pattern'] : null;
  if (name === 'grep') return typeof toolInput['pattern'] === 'string' ? toolInput['pattern'] : null;
  if (name === 'websearch') return typeof toolInput['query'] === 'string' ? toolInput['query'] : null;
  if (name === 'webfetch') return typeof toolInput['url'] === 'string' ? toolInput['url'] : null;
  if (name === 'task') return typeof toolInput['description'] === 'string' ? toolInput['description'] : null;
  // Fallback: show first string value
  for (const val of Object.values(toolInput)) {
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return null;
};

export const ToolCallBlock: FC<ToolCallBlockProps> = ({
  toolName,
  toolInput,
  status,
  output,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasOutput = output !== undefined && output.trim().length > 0;
  const primaryDisplay = getPrimaryDisplay(toolName, toolInput);

  return (
    <div className={`border border-border rounded-lg bg-card overflow-hidden ${className}`}>
      {/* Header */}
      <button
        onClick={() => { setIsExpanded(!isExpanded); }}
        className={`w-full flex items-center justify-between bg-muted px-3 py-1.5 hover:bg-accent/50 transition-colors ${
          isExpanded ? 'border-b border-border' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            {getHeaderLabel(toolName, status)}
          </span>
          {getStatusIcon(status)}
        </div>
        <CaretRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {/* Collapsible content */}
      {isExpanded ? (
        <>
          {/* Primary display (command, file path, etc.) */}
          {primaryDisplay ? (
            <div className="border-b border-border px-3 py-2">
              <code className="text-xs font-mono text-foreground break-all">
                {primaryDisplay}
              </code>
            </div>
          ) : null}

          {/* Output */}
          <div className="p-3">
            {status === 'running' && !output ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CircleNotch className="h-3 w-3 animate-spin" />
                <span>Running...</span>
              </div>
            ) : hasOutput ? (
              <div className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
                <pre className="break-words whitespace-pre-wrap text-foreground">
                  {output}
                </pre>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground italic">
                No output
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};
