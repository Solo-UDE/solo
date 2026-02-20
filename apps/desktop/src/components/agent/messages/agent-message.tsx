import { Robot } from '@phosphor-icons/react';

import { AgentNarrative } from './agent-narrative';
import { InterruptIndicator } from './interrupt-indicator';
import { MessageActions } from './message-actions';
import { MessageFeedback } from './message-feedback';
import { NotifyUserCard } from './notify-user-card';
import { ProceedIndicator } from './proceed-indicator';
import { TaskPhaseCard } from './task-phase-card';
import { ThinkingBox } from './thinking-box';
import { ToolCallBlock } from './tool-call-block';
import { TurnProgress } from './turn-progress';
import {
  BashToolWidget,
  EditToolWidget,
  WriteToolWidget,
  ReadToolWidget,
  GlobToolWidget,
  GrepToolWidget,
  WebSearchToolWidget,
  WebFetchToolWidget,
  TaskToolWidget,
  TodoToolWidget,
} from './tools';
import { ToolApprovalInline } from '../dialogs/ToolApprovalDialog';
import type { RenderBlock } from '../messageAdapter';

import type { FC, ReactNode } from 'react';

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
    toolName: string;
    toolInput: Record<string, unknown>;
    status: 'running' | 'success' | 'error';
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
  isInterrupted?: boolean;
  isLastAssistantMessage?: boolean;
  turnNumber?: number;
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

/** Helper to extract string from tool input */
const getStr = (input: Record<string, unknown>, key: string, fallback: string = ''): string => {
  const value = input[key];
  return typeof value === 'string' ? value : fallback;
};

/** Render the appropriate specialized tool widget based on toolName */
const renderToolWidget = (
  key: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  status: 'running' | 'success' | 'error',
  output?: string,
): ReactNode => {
  const isRunning = status === 'running';
  const name = toolName.toLowerCase();

  if (name === 'bash') {
    return <BashToolWidget key={key} command={getStr(toolInput, 'command')} description={getStr(toolInput, 'description') || undefined} output={output} isRunning={isRunning} />;
  }
  if (name === 'edit') {
    return <EditToolWidget key={key} filePath={getStr(toolInput, 'file_path', 'unknown')} oldString={getStr(toolInput, 'old_string')} newString={getStr(toolInput, 'new_string')} isRunning={isRunning} />;
  }
  if (name === 'write') {
    return <WriteToolWidget key={key} filePath={getStr(toolInput, 'file_path', 'unknown')} content={getStr(toolInput, 'content')} isRunning={isRunning} />;
  }
  if (name === 'read') {
    return <ReadToolWidget key={key} filePath={getStr(toolInput, 'file_path', 'unknown')} isRunning={isRunning} content={output} />;
  }
  if (name === 'glob') {
    return <GlobToolWidget key={key} pattern={getStr(toolInput, 'pattern', '*')} path={getStr(toolInput, 'path') || undefined} output={output} isRunning={isRunning} />;
  }
  if (name === 'grep') {
    return <GrepToolWidget key={key} pattern={getStr(toolInput, 'pattern')} path={getStr(toolInput, 'path') || undefined} outputMode={getStr(toolInput, 'output_mode') || undefined} glob={getStr(toolInput, 'glob') || undefined} fileType={getStr(toolInput, 'type') || undefined} output={output} isRunning={isRunning} />;
  }
  if (name === 'websearch') {
    return <WebSearchToolWidget key={key} query={getStr(toolInput, 'query')} output={output} isRunning={isRunning} />;
  }
  if (name === 'webfetch') {
    return <WebFetchToolWidget key={key} url={getStr(toolInput, 'url')} prompt={getStr(toolInput, 'prompt')} output={output} isRunning={isRunning} />;
  }
  if (name === 'task') {
    return <TaskToolWidget key={key} description={getStr(toolInput, 'description')} prompt={getStr(toolInput, 'prompt')} subagentType={getStr(toolInput, 'subagent_type', 'general-purpose')} model={getStr(toolInput, 'model') || undefined} output={output} isRunning={isRunning} />;
  }
  if (name === 'todowrite') {
    const todosInput = toolInput['todos'];
    return <TodoToolWidget key={key} todos={Array.isArray(todosInput) ? todosInput : undefined} isRunning={isRunning} />;
  }

  // Fallback: generic tool block
  return <ToolCallBlock key={key} toolName={toolName} toolInput={toolInput} status={status} output={output} />;
};

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
                    <ThinkingBox
                      key={`block-${i}`}
                      thinking={block.content}
                      thinkingDurationMs={block.durationMs}
                      isStreaming={block.isStreaming}
                    />
                  ) : null;
                case 'toolCall':
                  return renderToolWidget(
                    `block-${i}`,
                    block.toolName,
                    block.toolInput,
                    block.status,
                    block.output,
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
                {content.toolCalls.map((toolCall) =>
                  renderToolWidget(toolCall.id, toolCall.toolName, toolCall.toolInput, toolCall.status, toolCall.output)
                )}
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

        {/* Turn progress indicator */}
        {content.turnNumber ? <TurnProgress turnNumber={content.turnNumber} /> : null}

        {/* Message Actions (shown after message completes, not during streaming) */}
        {!content.isStreaming && !content.isInterrupted && content.isLastAssistantMessage !== undefined ? (
          <MessageActions
            showDisclaimer={content.isLastAssistantMessage}
          />
        ) : null}

        {/* Interrupt indicator */}
        {content.isInterrupted ? <InterruptIndicator /> : null}

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
