import { useEffect, useCallback, useState } from 'react';

import { AgentWindowHeader } from './AgentWindowHeader';
import { MessageFeed } from './messages/MessageFeed';
import { ChatInput } from './input/ChatInput';
import { useAgentSession } from '../../hooks/useAgentSession';
import { useAgentStream } from '../../hooks/useAgentStream';
import { useProviderStore } from '../../stores/provider-store';

import type { FC } from 'react';
import type { MessageMode } from '../../stores/agentStore';

export interface AgentWindowCallbacks {
	onFileOpen?: (path: string) => void;
	onTerminalOpen?: (cwd: string, command?: string) => void;
	onSessionChange?: (sessionId: string) => void;
}

export interface AgentWindowUIOptions {
	showHeader?: boolean;
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
 *
 * @example
 * ```tsx
 * // Basic usage
 * <AgentWindow instanceId="agent-1" />
 *
 * // With callbacks
 * <AgentWindow
 *   instanceId="agent-2"
 *   callbacks={{
 *     onFileOpen: (path) => openEditor(path),
 *   }}
 * />
 *
 * // In React Mosaic
 * const tabFactory = (id) => {
 *   if (id.startsWith('agent-')) {
 *     return <AgentWindow instanceId={id} />;
 *   }
 * };
 * ```
 */
export const AgentWindow: FC<AgentWindowProps> = ({
	instanceId,
	initialSessionId: _initialSessionId, // Reserved for future session restoration
	callbacks,
	ui = {},
	className = '',
}) => {
	const {
		showHeader = true,
		showModelSelector = true,
		showModeSelector = true,
		agentName = 'Claude',
	} = ui;

	// Enable stream listening for this window
	useAgentStream({ enabled: true });

	// Session management
	const {
		session,
		sessionId,
		messages,
		isRunning,
		error,
		createSession,
		sendMessage,
		clearError,
	} = useAgentSession({
		autoCreate: true,
	});

	// Provider state for model selection
	const selectedModel = useProviderStore((state) => state.selectedModel);
	const setSelectedModel = useProviderStore((state) => state.setSelectedModel);

	// Local state
	const [mode, setMode] = useState<MessageMode>('planning');

	// Notify parent of session changes
	useEffect(() => {
		if (sessionId && callbacks?.onSessionChange) {
			callbacks.onSessionChange(sessionId);
		}
	}, [sessionId, callbacks]);

	// Handle message submission
	const handleSubmit = useCallback(
		async (content: string) => {
			await sendMessage(content, mode);
		},
		[sendMessage, mode]
	);

	// Handle new session
	const handleNewSession = useCallback(() => {
		createSession(selectedModel || undefined);
	}, [createSession, selectedModel]);

	return (
		<div
			className={`flex flex-col h-full bg-background ${className}`}
			data-instance-id={instanceId}
		>
			{/* Header */}
			{showHeader && (
				<AgentWindowHeader
					sessionId={sessionId}
					agentName={agentName}
					model={selectedModel || session?.model}
					onNewSession={handleNewSession}
				/>
			)}

			{/* Message feed */}
			<MessageFeed
				messages={messages}
				autoScroll={true}
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
			<ChatInput
				onSubmit={handleSubmit}
				isDisabled={isRunning}
				mode={mode}
				onModeChange={showModeSelector ? setMode : undefined}
				selectedModel={selectedModel}
				onModelChange={showModelSelector ? setSelectedModel : undefined}
			/>
		</div>
	);
};
