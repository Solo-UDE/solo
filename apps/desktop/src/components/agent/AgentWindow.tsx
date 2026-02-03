import { useEffect, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';

import { MessageFeed } from './messages';
import { ChatInputContainer } from './input';
import { convertToMessageGroups } from './messageAdapter';
import { useAgentSession } from '../../hooks/useAgentSession';
import { useProviderStore } from '../../stores/provider-store';
import { useAgentStore } from '../../stores/agentStore';

import type { FC } from 'react';
import type { MessageMode } from '../../stores/agentStore';

export interface AgentWindowCallbacks {
	onFileOpen?: (path: string) => void;
	onTerminalOpen?: (cwd: string, command?: string) => void;
	onSessionChange?: (sessionId: string) => void;
}

export interface AgentWindowUIOptions {
	showModelSelector?: boolean;
	showModeSelector?: boolean;
	agentName?: string;
	agentAvatarUrl?: string;
}

export interface AgentWindowProps {
	/** Unique instance ID for this agent window */
	instanceId: string;
	/** Initial session ID (optional, will create new if not provided) */
	initialSessionId?: string;
	/** Callbacks for external integration */
	callbacks?: AgentWindowCallbacks;
	/** UI customization */
	ui?: AgentWindowUIOptions;
	/** Additional CSS class */
	className?: string;
}

/**
 * Reusable Agent Window component
 *
 * This component provides a complete chat interface for the AI agent.
 * It can be used as a standalone panel or embedded in React Mosaic.
 */
export const AgentWindow: FC<AgentWindowProps> = ({
	instanceId,
	initialSessionId,
	callbacks,
	ui: _ui = {},
	className = '',
}) => {
	// Session management — scoped to this tab's session
	const {
		sessionId,
		messages,
		isRunning,
		error,
		createSession,
		sendMessage,
		clearError,
	} = useAgentSession({
		sessionId: initialSessionId ?? null,
		autoCreate: !initialSessionId,
		defaultModel: useProviderStore((state) => state.selectedModel) || undefined,
	});

	// Provider state for model selection
	const selectedModel = useProviderStore((state) => state.selectedModel);

	// Panel system for opening new tabs
	const openPanel = usePanelTabsStore((state) => state.openPanel);

	// When auto-created, sync session ID back to panel data
	useEffect(() => {
		if (sessionId && !initialSessionId) {
			usePanelTabsStore.getState().updateData(instanceId, { sessionId });
		}
	}, [sessionId, initialSessionId, instanceId]);

	// Convert messages to message groups for the new MessageFeed
	const messageGroups = useMemo(
		() => convertToMessageGroups(messages),
		[messages]
	);

	// Notify parent of session changes
	useEffect(() => {
		if (sessionId && callbacks?.onSessionChange) {
			callbacks.onSessionChange(sessionId);
		}
	}, [sessionId, callbacks]);

	// Handle message submission from new ChatInputContainer
	const handleSubmit = useCallback(
		async (content: string, mode: 'planning' | 'fast', _model: string) => {
			await sendMessage(content, mode as MessageMode);
		},
		[sendMessage]
	);

	// Handle tool approval/rejection
	const resolveToolApproval = useAgentStore((state) => state.resolveToolApproval);
	const handleToolApproval = useCallback(
		(toolCallId: string, approved: boolean) => {
			resolveToolApproval(toolCallId, approved);
		},
		[resolveToolApproval]
	);

	// Handle new session
	const handleNewSession = useCallback(() => {
		createSession(selectedModel || undefined).then((newSessionId) => {
			if (newSessionId) {
				openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId: newSessionId });
			}
		});
	}, [createSession, selectedModel, openPanel]);

	// Empty state for no messages
	if (messages.length === 0) {
		return (
			<div
				className={`relative flex flex-col h-full bg-background ${className}`}
				data-instance-id={instanceId}
			>
				{/* Floating new session button */}
				<button
					onClick={handleNewSession}
					className="absolute top-2 right-2 z-10 p-1.5 rounded-none hover:bg-muted/60 transition-colors"
					title="New session"
				>
					<Plus className="w-4 h-4 text-muted-foreground" />
				</button>

				{/* Empty state */}
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center text-muted-foreground">
						<p className="text-sm">No messages yet</p>
						<p className="text-xs mt-1">Start a conversation by typing below</p>
					</div>
				</div>

				{/* Error display */}
				{error && (
					<div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
						<div className="flex items-center justify-between">
							<span className="text-sm text-destructive">{error}</span>
							<button
								onClick={clearError}
								className="text-xs text-destructive hover:underline"
							>
								Dismiss
							</button>
						</div>
					</div>
				)}

				{/* Chat input */}
				<ChatInputContainer
					onSubmit={handleSubmit}
					isAgentRunning={isRunning}
				/>
			</div>
		);
	}

	return (
		<div
			className={`relative flex flex-col h-full bg-background ${className}`}
			data-instance-id={instanceId}
		>
			{/* Floating new session button */}
			<button
				onClick={handleNewSession}
				className="absolute top-2 right-2 z-10 p-1.5 rounded-none hover:bg-muted/60 transition-colors"
				title="New session"
			>
				<Plus className="w-4 h-4 text-muted-foreground" />
			</button>

			{/* Message feed */}
			<MessageFeed
				messageGroups={messageGroups}
				autoScroll={true}
				onToolApproval={handleToolApproval}
				className="flex-1"
			/>

			{/* Error display */}
			{error && (
				<div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
					<div className="flex items-center justify-between">
						<span className="text-sm text-destructive">{error}</span>
						<button
							onClick={clearError}
							className="text-xs text-destructive hover:underline"
						>
							Dismiss
						</button>
					</div>
				</div>
			)}

			{/* Chat input */}
			<ChatInputContainer
				onSubmit={handleSubmit}
				isAgentRunning={isRunning}
			/>
		</div>
	);
};
