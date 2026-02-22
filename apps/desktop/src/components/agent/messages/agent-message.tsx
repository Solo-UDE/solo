import { AgentNarrative } from './agent-narrative';
import { InterruptIndicator } from './interrupt-indicator';
import { MessageActions } from './message-actions';
import { NotifyUserCard } from './notify-user-card';
import { ProceedIndicator } from './proceed-indicator';
import { SoloAgentBadge } from './SoloAgentBadge';
import { ThinkingBox } from './thinking-box';
import { TodoToolWidget } from './tools';
import { renderToolCard } from '../streaming/tool-registry';
import { StreamingSkeleton } from '../streaming/StreamingSkeleton';
import { ToolApprovalCard } from '../streaming/ToolApprovalCard';
import { AskUserQuestionCard } from '../streaming/AskUserQuestionCard';
import { ProgressTracker } from '../streaming/ProgressTracker';
import { ProgressTrackerItem } from '../streaming/ProgressTrackerItem';
import { deriveProgressPhases, buildInterleavedTimeline } from '@/lib/deriveProgressPhases';
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
  onToolApproval?: (toolCallId: string, approved: boolean) => void;
  onAnswerQuestion?: (requestId: string, answers: Record<string, string>) => void;
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
  const name = toolName.toLowerCase();

  // TodoWrite and TaskCreate/TaskUpdate use the todo widget
  if (name === 'todowrite' || name === 'taskcreate') {
    // TodoWrite passes an array of todos; TaskCreate passes a single task
    const todosInput = toolInput['todos'];
    const todos = Array.isArray(todosInput)
      ? todosInput
      : [{ content: (toolInput['subject'] as string) || (toolInput['description'] as string), status: status === 'success' ? 'completed' : 'pending' }];
    return <TodoToolWidget key={key} todos={todos} isRunning={status === 'running'} />;
  }

  if (name === 'taskupdate') {
    const taskId = toolInput['taskId'] as string || '';
    const newStatus = toolInput['status'] as string || '';
    const subject = toolInput['subject'] as string || '';
    const label = subject || `Task ${taskId}`;
    return <TodoToolWidget key={key} todos={[{ content: label, status: newStatus || (status === 'success' ? 'completed' : 'pending') }]} isRunning={status === 'running'} />;
  }

  if (name === 'tasklist' || name === 'taskget') {
    // Show output as a list if available, otherwise just the generic card
    if (output) {
      try {
        const parsed = JSON.parse(output);
        if (Array.isArray(parsed)) {
          const todos = parsed.map((t: Record<string, unknown>) => ({
            content: (t['subject'] as string) || (t['description'] as string) || JSON.stringify(t),
            status: (t['status'] as string) || 'pending',
            id: t['id'] as string,
          }));
          return <TodoToolWidget key={key} todos={todos} isRunning={false} />;
        }
      } catch { /* fall through to generic card */ }
    }
    return renderToolCard(key, toolName, toolInput, status, output);
  }

  // Use the registry for all other tools
  return renderToolCard(key, toolName, toolInput, status, output, style);
};

export const AgentMessage: FC<AgentMessageProps> = ({
  content,
  timestamp,
  agentName: _agentName = 'Agent',
  onToolApproval,
  onAnswerQuestion,
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

  // Use ordered blocks if available, otherwise fall back to legacy rendering
  const hasBlocks = content.blocks && content.blocks.length > 0;

  // Build interleaved timeline for block-based messages, legacy phases for fallback
  const timeline = hasBlocks
    ? buildInterleavedTimeline(content.blocks ?? [], !!content.isStreaming)
    : [];
  const legacyProgressPhases = !hasBlocks && content.isStreaming
    ? deriveProgressPhases(content.blocks ?? [], true)
    : [];

  return (
    <div className={`flex gap-3 px-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-200 ${className}`}>
      {/* Content */}
      <div className="flex-1 min-w-0 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <SoloAgentBadge />
          <span className="text-xs text-muted-foreground">{formatTime(timestamp)}</span>
          {content.autoProceed ? <ProceedIndicator /> : null}
        </div>

        {/* === Ordered Blocks Rendering (interleaved timeline) === */}
        {hasBlocks ? (
          <div className="space-y-3">
            {timeline.map((entry) => {
              if (entry.kind === 'progress') {
                return (
                  <ProgressTrackerItem
                    key={entry.phase.id}
                    label={entry.phase.label}
                    status={entry.phase.status}
                    isFirst={true}
                    preview={entry.phase.preview}
                  />
                );
              }
              // entry.kind === 'content'
              const block = entry.block;
              const idx = entry.blockIndex;
              switch (block.type) {
                case 'narrative':
                  return block.content ? (
                    <AgentNarrative key={`block-${idx}`} content={block.content} isStreaming={content.isStreaming} />
                  ) : null;
                case 'thinking':
                  return block.content ? (
                    <ThinkingBox
                      key={`block-${idx}`}
                      thinking={block.content}
                      thinkingDurationMs={block.durationMs}
                      isStreaming={block.isStreaming}
                    />
                  ) : null;
                case 'toolCall': {
                  const toolIndex = content.blocks!.slice(0, i).filter(b => b.type === 'toolCall').length;
                  return renderToolWidget(
                    `block-${idx}`,
                    block.toolName,
                    block.toolInput,
                    block.status,
                    block.output,
                    toolIndex > 0 ? { animationDelay: `${toolIndex * 60}ms` } : undefined,
                  );
                }
                case 'approval':
                  if (block.toolName.toLowerCase() === 'askuserquestion') {
                    return (
                      <AskUserQuestionCard
                        key={`block-${idx}`}
                        requestId={block.requestId}
                        toolInput={block.toolInput}
                        onSubmit={(requestId, answers) => onAnswerQuestion?.(requestId, answers)}
                        onReject={(requestId) => onToolApproval?.(requestId, false)}
                      />
                    );
                  }
                  return (
                    <ToolApprovalCard
                      key={`block-${idx}`}
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
          </div>
        ) : (
          /* === Legacy (non-block) Rendering === */
          <>
            {/* Progress tracker for pre-block streaming, fallback skeleton for legacy messages */}
            {content.isStreaming && !content.narrative && !content.toolCalls?.length ? (
              legacyProgressPhases.length > 0 ? <ProgressTracker phases={legacyProgressPhases} /> : <StreamingSkeleton />
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

      </div>
    </div>
  );
};
