import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { PlusIcon, Pencil2Icon } from '@radix-ui/react-icons';
import { Split } from 'lucide-react';

import { MessageFeed } from './messages';
import { ChatInputContainer } from './input';
import { SoloEmptyState } from './SoloDecryptAnimation';
import { StickyTodoOverlay } from './StickyTodoOverlay';
import { convertToMessageGroups } from './messageAdapter';
import { useAgentSession } from '../../hooks/useAgentSession';
import { useProviderStore } from '../../stores/provider-store';
import { useAgentStore, usePlanModeActive, useAcceptModeActive, useActiveAskUserQuestion } from '../../stores/agentStore';
import { AskUserQuestionCard } from './streaming/AskUserQuestionCard';
import { usePanelTabsStore } from '../../stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '../../lib/panels/constants';
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
} from '../ui/dropdown-menu';

import type { FC } from 'react';
import type { Mode } from './input/mode-selector';
import type { MessageMode, Attachment, FileMention, SessionConnectionState } from '../../stores/agentStore';

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

	// Track thinking mode for bridge sync
	const [thinkingEnabled, setThinkingEnabled] = useState(true);

	// Reserved space below the message feed equal to the sticky tasks pill's
	// rendered height. Keeps streamed content from being occluded by the overlay.
	const [overlayHeightPx, setOverlayHeightPx] = useState(0);

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
		setAcceptMode,
		clearError,
	} = useAgentSession({
		sessionId: initialSessionId ?? null,
		autoCreate: !initialSessionId,
		defaultModel: useProviderStore((state) => state.selectedModel) || undefined,
	});

	const selectedModel = useProviderStore((state) => state.selectedModel);

	// Connection state for resume indicators
	const connectionState: SessionConnectionState | undefined = useAgentStore((state) => {
		if (!sessionId) return undefined;
		return state.sessions.get(sessionId)?.connectionState;
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

	// Sync initial thinking mode to bridge on session ready
	useEffect(() => {
		if (sessionId) {
			setThinkingMode(true);
		}
	}, [sessionId, setThinkingMode]);

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

	// AskUserQuestion — submit answers back to bridge permission system
	const handleAnswerQuestion = useCallback(
		(requestId: string, answers: Record<string, string>) => {
			respondPermission(requestId, 'approve', false, answers);
		},
		[respondPermission]
	);

	// Plan mode / accept mode state from store (set by bridge events)
	const planModeActive = usePlanModeActive(sessionId ?? null);
	const acceptModeActive = useAcceptModeActive(sessionId ?? null);

	// Active AskUserQuestion (floated above input)
	const activeQuestion = useActiveAskUserQuestion(sessionId ?? null);

	// Handle mode selector changes — sync to bridge
	// Cycles: fast → planning → accept (click or Shift+Tab)
	const handleModeChange = useCallback(
		(mode: Mode) => {
			setPlanMode(mode === 'planning');
			setAcceptMode(mode === 'accept');
		},
		[setPlanMode, setAcceptMode]
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

	const forkSession = useAgentStore((state) => state.forkSession);
	const handleForkSession = useCallback(() => {
		if (!sessionId) return;
		forkSession(sessionId, selectedModel || undefined).then((newSessionId) => {
			openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId: newSessionId });
		}).catch((err) => {
			console.error('Failed to fork session:', err);
		});
	}, [sessionId, forkSession, selectedModel, openPanel]);

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
				className={`relative flex flex-col h-full bg-background rounded-2xl overflow-hidden ${className}`}
				data-instance-id={instanceId}
				style={{ fontFamily: 'var(--font-chat)' }}
			>
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
					planModeActive={planModeActive}
					acceptModeActive={acceptModeActive}
				/>
			</div>
		);
	}

	return (
		<div
			className={`relative flex flex-col h-full bg-background rounded-2xl overflow-hidden ${className}`}
			data-instance-id={instanceId}
			style={{ fontFamily: 'var(--font-chat)' }}
		>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:brightness-110 active:scale-[0.97] transition-all duration-200"
						title="New Session"
					>
						<PlusIcon width={16} height={16} />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" side="bottom" className="w-52">
					<DropdownMenuItem
						onClick={handleNewSession}
						className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-primary/10 hover:scale-[1.01] active:scale-[0.99] transition-all duration-150 animate-in fade-in-0 slide-in-from-top-1"
					>
						<div className="w-5 h-5 flex items-center justify-center rounded bg-primary/10 shrink-0">
							<Pencil2Icon width={12} height={12} className="text-primary" />
						</div>
						<div className="flex flex-col">
							<span className="text-xs font-medium">New chat</span>
							<span className="text-[11px] leading-tight text-muted-foreground">Start a blank conversation</span>
						</div>
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={handleForkSession}
						className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-primary/10 hover:scale-[1.01] active:scale-[0.99] transition-all duration-150 animate-in fade-in-0 slide-in-from-top-1 [animation-delay:50ms]"
					>
						<div className="w-5 h-5 flex items-center justify-center rounded bg-primary/10 shrink-0">
							<Split className="w-3 h-3 text-primary" />
						</div>
						<div className="flex flex-col">
							<span className="text-xs font-medium">Continue as new</span>
							<span className="text-[11px] leading-tight text-muted-foreground">New chat with this context</span>
						</div>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<MessageFeed
				messageGroups={messageGroups}
				autoScroll={true}
				isStreaming={isRunning}
				onToolApproval={handleToolApproval}
				onAnswerQuestion={handleAnswerQuestion}
				bottomReservePx={overlayHeightPx}
				className="flex-1"
			/>

			{connectionState === 'resuming' && (
				<div className="px-4 py-2 flex items-center gap-2 text-sm text-muted-foreground bg-muted/20" role="status" aria-live="polite">
					<span className="w-2 h-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
					Reconnecting session...
				</div>
			)}

			{connectionState === 'stale' && (
				<div className="px-4 py-2 text-sm text-warning bg-warning/5" role="alert">
					Session expired. Your next message will start a fresh context.
				</div>
			)}

			{error && (
				<div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20" role="alert">
					<div className="flex items-center justify-between">
						<span className="text-sm text-destructive">{error}</span>
						<button onClick={clearError} className="text-xs text-destructive hover:underline">
							Dismiss
						</button>
					</div>
				</div>
			)}

			{/* AskUserQuestion — flush above input, z-30 to stay above StickyTodoOverlay (z-20) */}
			{activeQuestion && (
				<div className="relative z-30 w-full max-w-3xl mx-auto px-3">
					<AskUserQuestionCard
						requestId={activeQuestion.requestId}
						toolInput={activeQuestion.toolInput}
						onSubmit={handleAnswerQuestion}
						onReject={(id) => handleToolApproval(id, false)}
						floating
					/>
				</div>
			)}

			{/* Sticky tasks pill — overlays above the input. Hidden when no tasks. */}
			<div className="relative">
				<StickyTodoOverlay messages={messages} onHeightChange={setOverlayHeightPx} />
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
					planModeActive={planModeActive}
					acceptModeActive={acceptModeActive}
				/>
			</div>
		</div>
	);
};
