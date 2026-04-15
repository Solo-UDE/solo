import { Terminal, CaretRight, CircleNotch, CheckCircle, XCircle } from '@phosphor-icons/react';
import { useState } from 'react';

import { ExpandRegion } from './shared/ExpandRegion';

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

  const canExpand = hasOutput || !!primaryDisplay;

  return (
    <div className={`group my-0.5 ${className}`}>
      {/* Codex-style flat header */}
      <button
        type="button"
        onClick={() => { if (canExpand) setIsExpanded(!isExpanded); }}
        className={`flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5 ${
          canExpand ? 'cursor-pointer' : 'cursor-default'
        }`}
        disabled={!canExpand}
      >
        <Terminal className="h-3 w-3 text-muted-foreground/70" />
        <span className="text-foreground/85">{getHeaderLabel(toolName, status)}</span>
        {primaryDisplay ? (
          <code className="font-mono text-muted-foreground truncate max-w-[480px]">
            {primaryDisplay}
          </code>
        ) : null}
        {getStatusIcon(status)}
        {canExpand ? (
          <CaretRight className={`h-3 w-3 text-muted-foreground/50 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        ) : null}
      </button>

      <ExpandRegion isExpanded={isExpanded}>
        {status === 'running' && !output ? (
          <div className="mt-1 ml-5 flex items-center gap-2 text-xs text-muted-foreground">
            <CircleNotch className="h-3 w-3 animate-spin" />
            <span>Running...</span>
          </div>
        ) : hasOutput ? (
          <div className="mt-1.5 ml-5 overflow-x-auto tool-widget-output p-2.5 font-mono text-xs">
            <pre className="break-words whitespace-pre-wrap text-foreground/85">
              {output}
            </pre>
          </div>
        ) : null}
      </ExpandRegion>
    </div>
  );
};
