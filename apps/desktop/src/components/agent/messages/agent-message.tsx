import { Robot } from '@phosphor-icons/react';
import { useMemo } from 'react';

import { AgentNarrative } from './agent-narrative';
import { ChainOfThoughtBlock, extractThinkingBlocks } from './chain-of-thought-block';
import { MessageFeedback } from './message-feedback';
import { NotifyUserCard } from './notify-user-card';
import { ProceedIndicator } from './proceed-indicator';
import { TaskPhaseCard } from './task-phase-card';
import { ToolCallBlock } from './tool-call-block';
import type { FC } from 'react';

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: string;
}

export interface AgentMessageContent {
  narrative?: string;
  isStreaming?: boolean;
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
  toolCalls?: AgentToolCall[];
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
}

export interface AgentMessageProps {
  content: AgentMessageContent;
  timestamp: Date;
  avatarUrl?: string;
  agentName?: string;
  onFeedback?: (messageId: string, feedback: 'good' | 'bad') => void;
  messageId?: string;
  className?: string;
}

export const AgentMessage: FC<AgentMessageProps> = ({
  content,
  timestamp,
  avatarUrl,
  agentName = 'Agent',
  onFeedback,
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

  // Extract thinking blocks from narrative
  const { thinking, cleaned: narrativeContent } = useMemo(
    () => extractThinkingBlocks(content.narrative ?? ''),
    [content.narrative]
  );

  return (
    <div className={`flex gap-3 px-4 ${className}`}>
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

        {/* Chain of Thought */}
        {thinking.length > 0 ? (
          <div className="space-y-1.5">
            {thinking.map((block, i) => (
              <ChainOfThoughtBlock key={i} content={block} />
            ))}
          </div>
        ) : null}

        {/* Narrative */}
        {narrativeContent || content.isStreaming ? (
          <AgentNarrative content={narrativeContent} isStreaming={content.isStreaming} />
        ) : null}

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
                toolCall={toolCall}
              />
            ))}
          </div>
        ) : null}

        {/* Notifications */}
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
