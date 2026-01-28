import { AgentMessage } from './agent-message';
import { UserMessage } from './user-message';

import type { AgentMessageContent } from './agent-message';
import type { FC } from 'react';

export interface UserMessageData {
  id: string;
  type: 'user';
  content: string;
  timestamp: Date;
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
  className?: string;
}

export const MessageSection: FC<MessageSectionProps> = ({
  sectionIndex,
  messages,
  className = '',
}) => {
  return (
    <section
      data-section-index={sectionIndex}
      className={`py-4 space-y-4 ${className}`}
    >
      {messages.map((message) => {
        if (message.type === 'user') {
          return (
            <UserMessage
              key={message.id}
              content={message.content}
              timestamp={message.timestamp}
            />
          );
        }

        // message.type === 'agent'
        return (
          <AgentMessage
            key={message.id}
            content={message.content}
            timestamp={message.timestamp}
          />
        );
      })}
    </section>
  );
};
