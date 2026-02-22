import { AgentNarrative } from './agent-narrative';
import { InterruptIndicator } from './interrupt-indicator';
import { MessageActions } from './message-actions';
import { MessageFeedback } from './message-feedback';
import { NotifyUserCard } from './notify-user-card';
import { ProceedIndicator } from './proceed-indicator';
import { ThinkingBox } from './thinking-box';
import { TodoToolWidget } from './tools';
import { renderToolCard } from '../streaming/tool-registry';
import { StreamingSkeleton } from '../streaming/StreamingSkeleton';
import { ToolApprovalCard } from '../streaming/ToolApprovalCard';
import { ProgressTracker } from '../streaming/ProgressTracker';
import { deriveProgressPhases } from '@/lib/deriveProgressPhases';
import type { RenderBlock } from '../messageAdapter';

import type { CSSProperties, FC, ReactNode } from 'react';

export interface PendingApproval {
  requestId: string;
  toolName: string;
  toolInput: unknown;
}

export interface AgentMessageContent {
  narrative?: string;
  /** Ordered blocks for interleaved rendering (text, thinking, tools mixed in order) */
  blocks?: RenderBlock[];
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
  agentName?: string;
  onFeedback?: (messageId: string, feedback: 'good' | 'bad') => void;
  onToolApproval?: (toolCallId: string, approved: boolean) => void;
  messageId?: string;
  className?: string;
}

/** Render the appropriate specialized tool widget based on toolName */
const renderToolWidget = (
  key: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  status: 'running' | 'success' | 'error',
  output?: string,
  style?: CSSProperties,
): ReactNode => {
  // TodoWrite has unique props — handle separately
  if (toolName.toLowerCase() === 'todowrite') {
    const todosInput = toolInput['todos'];
    return <TodoToolWidget key={key} todos={Array.isArray(todosInput) ? todosInput : undefined} isRunning={status === 'running'} />;
  }

  // Use the registry for all other tools
  return renderToolCard(key, toolName, toolInput, status, output, style);
};

export const AgentMessage: FC<AgentMessageProps> = ({
  content,
  timestamp,
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

  const progressPhases = content.isStreaming
    ? deriveProgressPhases(content.blocks ?? [], true)
    : [];

  return (
    <div className={`flex gap-3 px-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-200 ${className}`}>
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
            {/* Progress tracker — shows semantic phases derived from blocks */}
            {progressPhases.length > 0 ? <ProgressTracker phases={progressPhases} /> : null}
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
                case 'toolCall': {
                  const toolIndex = content.blocks!.slice(0, i).filter(b => b.type === 'toolCall').length;
                  return renderToolWidget(
                    `block-${i}`,
                    block.toolName,
                    block.toolInput,
                    block.status,
                    block.output,
                    toolIndex > 0 ? { animationDelay: `${toolIndex * 60}ms` } : undefined,
                  );
                }
                case 'approval':
                  return (
                    <ToolApprovalCard
                      key={`block-${i}`}
                      requestId={block.requestId}
                      toolName={block.toolName}
                      toolInput={block.toolInput}
                      onApproved={(requestId) => onToolApproval?.(requestId, true)}
                      onRejected={(requestId) => onToolApproval?.(requestId, false)}
                    />
                  );
                default:
                  return null;
              }
            })}

            {/* Trailing gap is handled by deriveProgressPhases — it appends
                an active "Reasoning" phase when the last block is completed. */}
          </div>
        ) : (
          /* === Legacy (non-block) Rendering === */
          <>
            {/* Progress tracker for pre-block streaming, fallback skeleton for legacy messages */}
            {content.isStreaming && !content.narrative && !content.toolCalls?.length ? (
              progressPhases.length > 0 ? <ProgressTracker phases={progressPhases} /> : <StreamingSkeleton />
            ) : null}

            {/* Narrative */}
            {content.narrative ? <AgentNarrative content={content.narrative} isStreaming={content.isStreaming} /> : null}

            {/* Tool Calls */}
            {content.toolCalls && content.toolCalls.length > 0 ? (
              <div className="space-y-2">
                {content.toolCalls.map((toolCall) =>
                  renderToolWidget(toolCall.id, toolCall.toolName, toolCall.toolInput, toolCall.status, toolCall.output)
                )}
              </div>
            ) : null}

            {/* Trailing loader: shown when streaming and all tools are done
                (gap between tool completion and next output) */}
            {content.isStreaming && content.toolCalls && content.toolCalls.length > 0
              && content.toolCalls.every((tc) => tc.status !== 'running')
              && !content.pendingApprovals?.length ? (
              <StreamingSkeleton label="Thinking..." />
            ) : null}

            {/* Pending Tool Approvals */}
            {content.pendingApprovals && content.pendingApprovals.length > 0 ? (
              <div className="space-y-2">
                {content.pendingApprovals.map((approval) => (
                  <ToolApprovalCard
                    key={approval.requestId}
                    requestId={approval.requestId}
                    toolName={approval.toolName}
                    toolInput={approval.toolInput}
                    onApproved={(requestId) => onToolApproval?.(requestId, true)}
                    onRejected={(requestId) => onToolApproval?.(requestId, false)}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}


        {/* Message Actions (shown after message completes, not during streaming) */}
        {!content.isStreaming && !content.isInterrupted && content.isLastAssistantMessage !== undefined ? (
          <MessageActions
            showDisclaimer={content.isLastAssistantMessage}
            messageText={content.narrative}
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
