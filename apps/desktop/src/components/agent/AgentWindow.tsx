import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { DebugPanel, DebugToggleButton } from './debug/DebugPanel';

import { MessageFeed, TurnProgress } from './messages';
import { ChatInputContainer } from './input';
import { SoloEmptyState } from './SoloDecryptAnimation';
import { convertToMessageGroups } from './messageAdapter';
import { useAgentSession } from '../../hooks/useAgentSession';
import { useProviderStore } from '../../stores/provider-store';
import { useAgentStore } from '../../stores/agentStore';
import { usePanelTabsStore } from '../../stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '../../lib/panels/constants';

import type { FC } from 'react';
import type { MessageMode, Attachment, FileMention } from '../../stores/agentStore';

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
	instanceId: string;
	initialSessionId?: string;
	initialWorktreeId?: string | null;
	callbacks?: AgentWindowCallbacks;
	ui?: AgentWindowUIOptions;
	className?: string;
}


export const AgentWindow: FC<AgentWindowProps> = ({
	instanceId,
	initialSessionId,
	initialWorktreeId,
	callbacks,
	ui: _ui = {},
	className = '',
}) => {
	const [worktreeId, setWorktreeId] = useState<string | null>(initialWorktreeId ?? null);

	// Track mode states for bridge sync
	const [thinkingEnabled, setThinkingEnabled] = useState(false);

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

	const selectedModel = useProviderStore((state) => state.selectedModel);

	// Turn progress tracking
	const currentTurn = useAgentStore((state) => {
		if (!sessionId) return undefined;
		return state.sessions.get(sessionId)?.currentTurn;
	});

	// Panel system for opening new tabs
	const openPanel = usePanelTabsStore((state) => state.openPanel);

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

	const prevModelRef = useRef<string | null>(null);
	useEffect(() => {
		if (sessionId && selectedModel && selectedModel !== prevModelRef.current) {
			prevModelRef.current = selectedModel;
			setModel(selectedModel);
		}
	}, [sessionId, selectedModel, setModel]);

	const messageGroups = useMemo(
		() => convertToMessageGroups(messages),
		[messages]
	);

	useEffect(() => {
		if (sessionId && callbacks?.onSessionChange) {
			callbacks.onSessionChange(sessionId);
		}
	}, [sessionId, callbacks]);

	const handleSubmit = useCallback(
		async (content: string, mode: 'planning' | 'fast', _model: string, attachments?: Attachment[], mentions?: FileMention[]) => {
			await sendMessage(content, mode as MessageMode, attachments, mentions);
		},
		[sendMessage]
	);

	// Abort session
	const abortSession = useAgentStore((state) => state.abortSession);
	const handleAbort = useCallback(() => {
		if (sessionId) {
			abortSession(sessionId);
		}
	}, [sessionId, abortSession]);

	// Tool approval — wire inline approval buttons to bridge permission system
	const respondPermission = useAgentStore((state) => state.respondPermission);
	const handleToolApproval = useCallback(
		(toolCallId: string, approved: boolean) => {
			respondPermission(toolCallId, approved ? 'approve' : 'deny');
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


	const handleNewSession = useCallback(() => {
		createSession(selectedModel || undefined).then((newSessionId) => {
			if (newSessionId) {
				openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId: newSessionId });
			}
		});
	}, [createSession, selectedModel, openPanel]);

	const handleLocalCommand = useCallback((commandId: string) => {
		switch (commandId) {
			case 'clear':
				handleNewSession();
				break;
			default:
				sendMessage(`/${commandId}`, 'planning' as MessageMode);
				break;
		}
	}, [sendMessage, handleNewSession]);

	const handleSuggestedPrompt = useCallback(
		(prompt: string) => {
			sendMessage(prompt, 'planning' as MessageMode);
		},
		[sendMessage]
	);


	if (messages.length === 0) {
		return (
			<div
				className={`relative flex flex-col h-full bg-background ${className}`}
				data-instance-id={instanceId}
			>
				<div className="absolute top-2 right-2 z-10 flex items-center gap-1">
					<DebugToggleButton />
					<button
						onClick={handleNewSession}
						className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors duration-150"
						title="New session"
					>
						<Plus className="w-4 h-4 text-muted-foreground" />
					</button>
				</div>

				<div className="flex-1 flex items-center justify-center px-6">
					<SoloEmptyState onPromptClick={handleSuggestedPrompt} />
				</div>

				{error && (
					<div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
						<div className="flex items-center justify-between">
							<span className="text-sm text-destructive">{error}</span>
							<button onClick={clearError} className="text-xs text-destructive hover:underline">
								Dismiss
							</button>
						</div>
					</div>
				)}

				<DebugPanel />

				<ChatInputContainer
					onSubmit={handleSubmit}
					onLocalCommand={handleLocalCommand}
					onAbort={handleAbort}
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
			<div className="absolute top-2 right-2 z-10 flex items-center gap-1">
				<DebugToggleButton />
				<button
					onClick={handleNewSession}
					className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors duration-150"
					title="New session"
				>
					<Plus className="w-4 h-4 text-muted-foreground" />
				</button>
			</div>

			<MessageFeed
				messageGroups={messageGroups}
				autoScroll={true}
				isStreaming={isRunning}
				onToolApproval={handleToolApproval}
				className="flex-1"
			/>

			{currentTurn != null && currentTurn > 0 && (
				<TurnProgress turnNumber={currentTurn} />
			)}

			{error && (
				<div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
					<div className="flex items-center justify-between">
						<span className="text-sm text-destructive">{error}</span>
						<button onClick={clearError} className="text-xs text-destructive hover:underline">
							Dismiss
						</button>
					</div>
				</div>
			)}

			<DebugPanel />

			<ChatInputContainer
				onSubmit={handleSubmit}
				onLocalCommand={handleLocalCommand}
				onAbort={handleAbort}
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
