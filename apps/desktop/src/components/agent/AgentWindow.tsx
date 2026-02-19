import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { Plus } from '@phosphor-icons/react';

import { MessageFeed } from './messages';
import { ChatInputContainer } from './input';
import { convertToMessageGroups } from './messageAdapter';
import { useAgentSession } from '../../hooks/useAgentSession';
import { useProviderStore } from '../../stores/provider-store';
import { useAgentStore } from '../../stores/agentStore';
import { usePanelTabsStore } from '../../stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '../../lib/panels/constants';

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
	/** Initial worktree ID bound to this agent session */
	initialWorktreeId?: string | null;
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
	initialWorktreeId,
	callbacks,
	ui: _ui = {},
	className = '',
}) => {
	// Track bound worktree for this agent session
	const [worktreeId, setWorktreeId] = useState<string | null>(initialWorktreeId ?? null);

	// Track mode states for bridge sync
	const [thinkingEnabled, setThinkingEnabled] = useState(false);

	// Session management — scoped to this tab's session
	const {
		sessionId,
		messages,
		isRunning,
		error,
		createSession,
		sendMessage,
		setModel,
		setPlanMode,
		setThinkingMode,
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
			usePanelTabsStore.getState().updateData(instanceId, { sessionId, worktreeId });
		}
	}, [sessionId, initialSessionId, instanceId, worktreeId]);

	// Persist worktree changes to panel data
	const handleWorktreeChange = useCallback((newWorktreeId: string | null) => {
		setWorktreeId(newWorktreeId);
		usePanelTabsStore.getState().updateData(instanceId, {
			sessionId: sessionId ?? undefined,
			worktreeId: newWorktreeId,
		});
	}, [instanceId, sessionId]);

	// Sync model selection to the active session (skip redundant calls)
	const prevModelRef = useRef<string | null>(null);
	useEffect(() => {
		if (sessionId && selectedModel && selectedModel !== prevModelRef.current) {
			prevModelRef.current = selectedModel;
			setModel(selectedModel);
		}
	}, [sessionId, selectedModel, setModel]);

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
	const respondPermission = useAgentStore((state) => state.respondPermission);
	const handleToolApproval = useCallback(
		(requestId: string, approved: boolean) => {
			respondPermission(requestId, approved ? 'approve' : 'deny');
		},
		[respondPermission]
	);

	// Handle mode selector changes — sync to bridge
	const handleModeChange = useCallback(
		(mode: 'planning' | 'fast') => {
			const enabled = mode === 'planning';
			setPlanMode(enabled);
		},
		[setPlanMode]
	);

	// Handle thinking toggle — sync to bridge
	const handleThinkingChange = useCallback(
		(enabled: boolean) => {
			setThinkingEnabled(enabled);
			setThinkingMode(enabled);
		},
		[setThinkingMode]
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
					<div className="max-w-4xl mx-auto text-center text-muted-foreground">
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
					worktreeId={worktreeId}
					onWorktreeChange={handleWorktreeChange}
					onModeChange={handleModeChange}
					thinkingEnabled={thinkingEnabled}
					onThinkingChange={handleThinkingChange}
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
				isStreaming={isRunning}
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
				worktreeId={worktreeId}
				onWorktreeChange={handleWorktreeChange}
				onModeChange={handleModeChange}
				thinkingEnabled={thinkingEnabled}
				onThinkingChange={handleThinkingChange}
			/>
		</div>
	);
};
