import { Bot, Loader2 } from 'lucide-react';

import { AgentNarrative } from './AgentNarrative';

import type { FC } from 'react';
import type { ToolCallState } from '../../../stores/agentStore';

export interface AgentMessageProps {
	content: string;
	timestamp: Date;
	avatarUrl?: string;
	agentName?: string;
	toolCalls?: ToolCallState[];
	isStreaming?: boolean;
	className?: string;
}

export const AgentMessage: FC<AgentMessageProps> = ({
	content,
	timestamp,
	avatarUrl,
	agentName = 'Claude',
	toolCalls,
	isStreaming = false,
	className = '',
}) => {
	const formatTime = (date: Date): string => {
		return new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true,
		}).format(date);
	};

	return (
		<div className={`flex gap-3 px-4 ${className}`}>
			{/* Avatar */}
			<div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center overflow-hidden">
				{avatarUrl ? (
					<img src={avatarUrl} alt={agentName} className="w-full h-full object-cover" />
				) : (
					<Bot className="w-4 h-4 text-secondary-foreground" />
				)}
			</div>

			{/* Content */}
			<div className="flex-1 min-w-0 space-y-3">
				{/* Header */}
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-foreground">{agentName}</span>
					<span className="text-xs text-muted-foreground">{formatTime(timestamp)}</span>
					{isStreaming && (
						<Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
					)}
				</div>

				{/* Narrative content */}
				{content ? (
					<AgentNarrative content={content} />
				) : isStreaming ? (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<span>Thinking</span>
						<span className="animate-pulse">...</span>
					</div>
				) : null}

				{/* Tool calls */}
				{toolCalls && toolCalls.length > 0 && (
					<div className="space-y-2">
						{toolCalls.map((toolCall) => (
							<ToolCallBlock key={toolCall.id} toolCall={toolCall} />
						))}
					</div>
				)}
			</div>
		</div>
	);
};

// Inline tool call block component
interface ToolCallBlockProps {
	toolCall: ToolCallState;
}

const ToolCallBlock: FC<ToolCallBlockProps> = ({ toolCall }) => {
	const statusColors: Record<string, string> = {
		pending: 'text-muted-foreground',
		pending_approval: 'text-amber-500',
		running: 'text-blue-500',
		completed: 'text-green-500',
		error: 'text-red-500',
	};

	return (
		<div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
			<div className="px-3 py-2 flex items-center gap-2 border-b border-border/50">
				<span className="text-xs font-mono text-muted-foreground">
					{toolCall.name}
				</span>
				<span className={`text-xs ${statusColors[toolCall.status]}`}>
					{toolCall.status === 'running' && (
						<Loader2 className="w-3 h-3 animate-spin inline" />
					)}
					{toolCall.status === 'completed' && '✓'}
					{toolCall.status === 'error' && '✗'}
				</span>
			</div>
			{toolCall.result && (
				<div className="px-3 py-2">
					<pre className="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">
						{toolCall.result.substring(0, 500)}
						{toolCall.result.length > 500 && '...'}
					</pre>
				</div>
			)}
		</div>
	);
};
