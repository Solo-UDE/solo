import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useEffect, useState } from 'react';

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
  className?: string;
}

export const MessageFeed: FC<MessageFeedProps> = ({
  messageGroups,
  autoScroll = true,
  isStreaming = false,
  className = '',
}) => {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const shouldAutoScroll = useRef(autoScroll);
  // Track which groups have already been mounted (to avoid re-animation)
  const mountedGroupsRef = useRef(new Set<string>());

  const virtualizer = useVirtualizer({
    count: messageGroups.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 200,
    overscan: 5,
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (shouldAutoScroll.current && scrollElement) {
      const { scrollHeight, clientHeight } = scrollElement;
      const isNearBottom = scrollHeight - clientHeight - scrollElement.scrollTop < 100;

      if (isNearBottom || messageGroups.length === 1) {
        virtualizer.scrollToIndex(messageGroups.length - 1, {
          align: 'end',
          behavior: 'smooth',
        });
      }
    }
  }, [messageGroups.length, virtualizer, scrollElement]);

  // Track if user is manually scrolling
  useEffect(() => {
    if (!scrollElement) return;

    const handleScroll = (): void => {
      const { scrollHeight, clientHeight, scrollTop } = scrollElement;
      const isAtBottom = scrollHeight - clientHeight - scrollTop < 50;
      shouldAutoScroll.current = isAtBottom;
    };

    scrollElement.addEventListener('scroll', handleScroll);
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, [scrollElement]);

  // Auto-scroll during streaming via interval
  useEffect(() => {
    if (!isStreaming || !shouldAutoScroll.current) return;

    const interval = setInterval(() => {
      if (!shouldAutoScroll.current || !scrollElement) return;
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }, 100);

    return () => clearInterval(interval);
  }, [isStreaming, scrollElement]);

  return (
    <div
      ref={setScrollElement}
      className={`flex-1 overflow-y-auto overflow-x-hidden ${className}`}
      style={{ contain: 'layout style' }}
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

          // Determine if this is a newly mounted group
          const isNew = !mountedGroupsRef.current.has(messageGroup.id);
          if (isNew) {
            mountedGroupsRef.current.add(messageGroup.id);
          }

          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className={isNew ? 'animate-slide-up' : undefined}
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
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
