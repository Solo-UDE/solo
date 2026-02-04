import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useEffect } from 'react';

import { MessageSection } from './message-section';

import type { Message } from './message-section';
import type { FC } from 'react';

export interface MessageGroup {
  id: string;
  messages: Message[];
}

export interface MessageFeedProps {
  messageGroups: MessageGroup[];
  autoScroll?: boolean;
  isStreaming?: boolean;
  onToolApproval?: (toolCallId: string, approved: boolean) => void;
  className?: string;
}

export const MessageFeed: FC<MessageFeedProps> = ({
  messageGroups,
  autoScroll = true,
  isStreaming = false,
  onToolApproval,
  className = '',
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(autoScroll);

  const virtualizer = useVirtualizer({
    count: messageGroups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 5,
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (shouldAutoScroll.current && parentRef.current) {
      const { scrollHeight, clientHeight } = parentRef.current;
      const isNearBottom = scrollHeight - clientHeight - parentRef.current.scrollTop < 100;

      if (isNearBottom || messageGroups.length === 1) {
        virtualizer.scrollToIndex(messageGroups.length - 1, {
          align: 'end',
          behavior: 'smooth',
        });
      }
    }
  }, [messageGroups.length, virtualizer]);

  // Track if user is manually scrolling
  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;

    const handleScroll = (): void => {
      const { scrollHeight, clientHeight, scrollTop } = element;
      const isAtBottom = scrollHeight - clientHeight - scrollTop < 50;
      shouldAutoScroll.current = isAtBottom;
    };

    element.addEventListener('scroll', handleScroll);
    return () => {
      element.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Auto-scroll during streaming via interval
  useEffect(() => {
    if (!isStreaming || !shouldAutoScroll.current) return;

    const interval = setInterval(() => {
      if (!shouldAutoScroll.current || !parentRef.current) return;
      const el = parentRef.current;
      el.scrollTop = el.scrollHeight;
    }, 100);

    return () => clearInterval(interval);
  }, [isStreaming]);

  return (
    <div
      ref={parentRef}
      className={`flex-1 overflow-y-auto overflow-x-hidden ${className}`}
      style={{ contain: 'strict' }}
    >
      <div
        style={{
          height: `${String(virtualizer.getTotalSize())}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const messageGroup = messageGroups[virtualItem.index];
          if (!messageGroup) return null;

          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${String(virtualItem.start)}px)`,
              }}
            >
              <MessageSection
                sectionIndex={virtualItem.index}
                messages={messageGroup.messages}
                onToolApproval={onToolApproval}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
