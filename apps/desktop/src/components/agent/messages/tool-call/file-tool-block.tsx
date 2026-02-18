import { FileText, FilePlus, Pencil, Trash, FolderOpen } from '@phosphor-icons/react';

import { CollapsibleOutput } from './collapsible-output';
import { ToolStatusIndicator } from './tool-status-indicator';

import type { AgentToolCall } from '../agent-message';
import type { FC } from 'react';

export interface FileToolBlockProps {
  toolCall: AgentToolCall;
  className?: string;
}

const iconMap: Record<string, FC<{ className?: string }>> = {
  read_file: FileText,
  write_file: FilePlus,
  edit_file: Pencil,
  create_file: FilePlus,
  delete_file: Trash,
  list_directory: FolderOpen,
};

const labelMap: Record<string, string> = {
  read_file: 'Read File',
  write_file: 'Write File',
  edit_file: 'Edit File',
  create_file: 'Create File',
  delete_file: 'Delete File',
  list_directory: 'List Directory',
};

export const FileToolBlock: FC<FileToolBlockProps> = ({ toolCall, className = '' }) => {
  const args = parseArgs(toolCall.arguments);
  const path = String(args.path ?? '');
  const Icon = iconMap[toolCall.name] ?? FileText;
  const label = labelMap[toolCall.name] ?? toolCall.name;
  const hasResult = toolCall.result !== undefined && toolCall.result.trim().length > 0;

  // Show filename only
  const fileName = path.split('/').pop() ?? path;

  return (
    <div className={`rounded-[12px] bg-card/95 backdrop-blur-sm shadow-[0_2px_12px_-4px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.4)] overflow-hidden ${className}`}>
      <div className="px-3 py-2.5 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-muted/60 flex items-center justify-center flex-shrink-0">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">{label}</span>
            <ToolStatusIndicator status={toolCall.status} />
          </div>
          {path && (
            <code className="text-[11px] font-mono text-muted-foreground truncate block mt-0.5" title={path}>
              {fileName}
            </code>
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
