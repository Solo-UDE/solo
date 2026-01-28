import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useEffect } from 'react';

import { UserMessage } from './UserMessage';
import { AgentMessage } from './AgentMessage';

import type { FC } from 'react';
import type { Message } from '../../../stores/agentStore';

export interface MessageFeedProps {
	messages: Message[];
	autoScroll?: boolean;
	className?: string;
}

export const MessageFeed: FC<MessageFeedProps> = ({
	messages,
	autoScroll = true,
	className = '',
}) => {
	const parentRef = useRef<HTMLDivElement>(null);
	const shouldAutoScroll = useRef(autoScroll);

	const virtualizer = useVirtualizer({
		count: messages.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 200,
		overscan: 5,
	});

	// Auto-scroll to bottom on new messages
	useEffect(() => {
		if (shouldAutoScroll.current && parentRef.current && messages.length > 0) {
			const { scrollHeight, clientHeight } = parentRef.current;
			const isNearBottom = scrollHeight - clientHeight - parentRef.current.scrollTop < 100;

			if (isNearBottom || messages.length === 1) {
				virtualizer.scrollToIndex(messages.length - 1, {
					align: 'end',
					behavior: 'smooth',
				});
			}
		}
	}, [messages.length, virtualizer]);

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

	if (messages.length === 0) {
		return (
			<div className={`flex-1 flex items-center justify-center ${className}`}>
				<div className="text-center text-muted-foreground">
					<p className="text-sm">No messages yet</p>
					<p className="text-xs mt-1">Start a conversation by typing below</p>
				</div>
			</div>
		);
	}

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
					const message = messages[virtualItem.index];
					if (!message) return null;

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
							<div className="py-3">
								{message.role === 'user' ? (
									<UserMessage
										content={message.content}
										timestamp={message.timestamp}
									/>
								) : (
									<AgentMessage
										content={message.content}
										timestamp={message.timestamp}
										toolCalls={message.toolCalls}
										isStreaming={message.isStreaming}
									/>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
};
