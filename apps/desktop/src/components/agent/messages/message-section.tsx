import { AgentMessage } from './agent-message';
import { UserMessage } from './user-message';

import type { AgentMessageContent } from './agent-message';
import type { Attachment, FileMention, UserContentPart } from '@/stores/agentStore';
import type { FC } from 'react';

export interface UserMessageData {
  id: string;
  type: 'user';
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
  mentions?: FileMention[];
  skills?: string[];
  parts?: UserContentPart[];
}

export interface AgentMessageData {
  id: string;
  type: 'agent';
  content: AgentMessageContent;
  timestamp: Date;
}

export type Message = UserMessageData | AgentMessageData;

export interface MessageSectionProps {
  sectionIndex: number;
  messages: Message[];
  onToolApproval?: (toolCallId: string, approved: boolean) => void;
  onAnswerQuestion?: (requestId: string, answers: Record<string, string>) => void;
  className?: string;
}

export const MessageSection: FC<MessageSectionProps> = ({
  sectionIndex,
  messages,
  onToolApproval,
  onAnswerQuestion,
  className = '',
}) => {
  return (
    <section
      data-section-index={sectionIndex}
      className={`mx-auto max-w-[56rem] space-y-4 px-4 py-4 ${className}`}
    >
      {messages.map((message) => {
        if (message.type === 'user') {
          return (
            <UserMessage
              key={message.id}
              content={message.content}
              timestamp={message.timestamp}
              attachments={message.attachments}
              mentions={message.mentions}
              skills={message.skills}
              parts={message.parts}
            />
          );
        }

        // message.type === 'agent'
        return (
          <AgentMessage
            key={message.id}
            content={message.content}
            timestamp={message.timestamp}
            onToolApproval={onToolApproval}
            onAnswerQuestion={onAnswerQuestion}
          />
        );
      })}
    </section>
  );
};
