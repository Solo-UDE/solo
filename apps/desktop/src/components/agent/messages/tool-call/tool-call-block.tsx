import { Terminal } from '@phosphor-icons/react';

import { BashToolBlock } from './bash-tool-block';
import { CollapsibleOutput } from './collapsible-output';
import { FileToolBlock } from './file-tool-block';
import { GitToolBlock } from './git-tool-block';
import { SearchToolBlock } from './search-tool-block';
import { ToolStatusIndicator } from './tool-status-indicator';

import type { AgentToolCall } from '../agent-message';
import type { FC } from 'react';

export interface ToolCallBlockProps {
  toolCall: AgentToolCall;
  className?: string;
}

const FILE_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'create_file', 'delete_file', 'list_directory']);
const SEARCH_TOOLS = new Set(['grep', 'glob']);
const GIT_TOOLS = new Set(['git_status', 'git_diff', 'git_commit']);

/**
 * Polymorphic tool call dispatcher — routes to specialized renderers based on tool name
 */
export const ToolCallBlock: FC<ToolCallBlockProps> = ({ toolCall, className }) => {
  if (toolCall.name === 'bash') {
    return <BashToolBlock toolCall={toolCall} className={className} />;
  }

  if (FILE_TOOLS.has(toolCall.name)) {
    return <FileToolBlock toolCall={toolCall} className={className} />;
  }

  if (SEARCH_TOOLS.has(toolCall.name)) {
    return <SearchToolBlock toolCall={toolCall} className={className} />;
  }

  if (GIT_TOOLS.has(toolCall.name)) {
    return <GitToolBlock toolCall={toolCall} className={className} />;
  }

  // Fallback: generic tool block
  return <GenericToolBlock toolCall={toolCall} className={className} />;
};

/** Fallback for unknown tools */
const GenericToolBlock: FC<ToolCallBlockProps> = ({ toolCall, className = '' }) => {
  const hasResult = toolCall.result !== undefined && toolCall.result.trim().length > 0;
  const label = toolCall.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className={`rounded-[12px] bg-card/95 backdrop-blur-sm shadow-[0_2px_12px_-4px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.4)] overflow-hidden ${className}`}>
      <div className="px-3 py-2.5 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-muted/60 flex items-center justify-center flex-shrink-0">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">{label}</span>
            <ToolStatusIndicator status={toolCall.status} />
          </div>
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
