import { Robot } from '@phosphor-icons/react';

import { AgentNarrative } from './agent-narrative';
import { MessageFeedback } from './message-feedback';
import { NotifyUserCard } from './notify-user-card';
import { ProceedIndicator } from './proceed-indicator';
import { TaskPhaseCard } from './task-phase-card';
import { ToolCallBlock } from './tool-call-block';
import { ToolApprovalInline } from '../dialogs/ToolApprovalDialog';
import type { RenderBlock } from '../messageAdapter';

import type { FC } from 'react';

export interface PendingApproval {
  requestId: string;
  toolName: string;
  toolInput: unknown;
}

export interface AgentMessageContent {
  narrative?: string;
  /** Ordered blocks for interleaved rendering (text, thinking, tools mixed in order) */
  blocks?: RenderBlock[];
  taskPhases?: {
    id: string;
    title: string;
    summary: string;
    filesEdited?: {
      path: string;
      status: 'added' | 'modified' | 'deleted';
    }[];
    progressUpdates?: {
      step: number;
      description: string;
      status: 'pending' | 'in_progress' | 'completed' | 'failed';
    }[];
  }[];
  toolCalls?: {
    id: string;
    command: string;
    cwd: string;
    exitCode?: number;
    output?: string;
  }[];
  pendingApprovals?: PendingApproval[];
  notifications?: {
    id: string;
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
    actions?: {
      label: string;
      onClick: () => void;
    }[];
  }[];
  autoProceed?: boolean;
  isStreaming?: boolean;
}

export interface AgentMessageProps {
  content: AgentMessageContent;
  timestamp: Date;
  avatarUrl?: string;
  agentName?: string;
  onFeedback?: (messageId: string, feedback: 'good' | 'bad') => void;
  onToolApproval?: (toolCallId: string, approved: boolean) => void;
  messageId?: string;
  className?: string;
}

export const AgentMessage: FC<AgentMessageProps> = ({
  content,
  timestamp,
  avatarUrl,
  agentName = 'Agent',
  onFeedback,
  onToolApproval,
  messageId,
  className = '',
}) => {
  const formatTime = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  const handleFeedback = (feedback: 'good' | 'bad'): void => {
    if (onFeedback && messageId) {
      onFeedback(messageId, feedback);
    }
  };

  // Use ordered blocks if available, otherwise fall back to legacy rendering
  const hasBlocks = content.blocks && content.blocks.length > 0;

  return (
    <div className={`flex gap-3 px-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-200 ${className}`}>
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center overflow-hidden">
        {avatarUrl ? (
          <img src={avatarUrl} alt={agentName} className="w-full h-full object-cover" />
        ) : (
          <Robot className="w-4 h-4 text-secondary-foreground" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{agentName}</span>
          <span className="text-xs text-muted-foreground">{formatTime(timestamp)}</span>
          {content.autoProceed ? <ProceedIndicator /> : null}
        </div>

        {/* === Ordered Blocks Rendering === */}
        {hasBlocks ? (
          <div className="space-y-3">
            {content.blocks!.map((block, i) => {
              switch (block.type) {
                case 'narrative':
                  return block.content ? (
                    <AgentNarrative key={`block-${i}`} content={block.content} isStreaming={content.isStreaming} />
                  ) : null;
                case 'thinking':
                  return block.content ? (
                    <div key={`block-${i}`} className="text-xs text-muted-foreground/70 italic border-l-2 border-muted-foreground/20 pl-3 py-1">
                      {block.content}
                    </div>
                  ) : null;
                case 'toolCall':
                  return (
                    <ToolCallBlock
                      key={`block-${i}`}
                      command={block.command}
                      cwd={block.cwd}
                      {...(block.exitCode !== undefined && { exitCode: block.exitCode })}
                      {...(block.output && { output: block.output })}
                    />
                  );
                case 'approval':
                  return (
                    <ToolApprovalInline
                      key={`block-${i}`}
                      approval={{
                        requestId: block.requestId,
                        toolName: block.toolName,
                        toolInput: block.toolInput,
                      }}
                      onApproved={(requestId) => onToolApproval?.(requestId, true)}
                      onRejected={(requestId) => onToolApproval?.(requestId, false)}
                    />
                  );
                default:
                  return null;
              }
            })}
          </div>
        ) : (
          /* === Legacy (non-block) Rendering === */
          <>
            {/* Narrative */}
            {content.narrative ? <AgentNarrative content={content.narrative} isStreaming={content.isStreaming} /> : null}

            {/* Task Phase Cards */}
            {content.taskPhases && content.taskPhases.length > 0 ? (
              <div className="space-y-3">
                {content.taskPhases.map((phase) => (
                  <TaskPhaseCard
                    key={phase.id}
                    title={phase.title}
                    summary={phase.summary}
                    {...(phase.filesEdited && { filesEdited: phase.filesEdited })}
                    {...(phase.progressUpdates && { progressUpdates: phase.progressUpdates })}
                  />
                ))}
              </div>
            ) : null}

            {/* Tool Calls */}
            {content.toolCalls && content.toolCalls.length > 0 ? (
              <div className="space-y-2">
                {content.toolCalls.map((toolCall) => (
                  <ToolCallBlock
                    key={toolCall.id}
                    command={toolCall.command}
                    cwd={toolCall.cwd}
                    {...(toolCall.exitCode !== undefined && { exitCode: toolCall.exitCode })}
                    {...(toolCall.output && { output: toolCall.output })}
                  />
                ))}
              </div>
            ) : null}

            {/* Pending Tool Approvals */}
            {content.pendingApprovals && content.pendingApprovals.length > 0 ? (
              <div className="space-y-2">
                {content.pendingApprovals.map((approval) => (
                  <ToolApprovalInline
                    key={approval.requestId}
                    approval={approval}
                    onApproved={(requestId) => onToolApproval?.(requestId, true)}
                    onRejected={(requestId) => onToolApproval?.(requestId, false)}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}

        {/* Notifications (always rendered, not block-ordered) */}
        {content.notifications && content.notifications.length > 0 ? (
          <div className="space-y-2">
            {content.notifications.map((notification) => (
              <NotifyUserCard
                key={notification.id}
                type={notification.type}
                message={notification.message}
                {...(notification.actions && { actions: notification.actions })}
              />
            ))}
          </div>
        ) : null}

        {/* Feedback */}
        {onFeedback && messageId ? <MessageFeedback onFeedback={handleFeedback} /> : null}
      </div>
    </div>
  );
};
