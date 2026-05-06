import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { Pencil2Icon, PlusIcon } from '@radix-ui/react-icons';
import { Split } from 'lucide-react';

import { MessageFeed } from './messages';
import { ChatInputContainer, type ChatInputContainerHandle } from './input';
import { QueuedMessagesStrip } from './input/queued-messages-strip';
import { StickyTodoOverlay } from './StickyTodoOverlay';
import SoloDecryptAnimation from './SoloDecryptAnimation';
import { convertToMessageGroups } from './messageAdapter';
import { useAgentSession } from '../../hooks/useAgentSession';
import { useProviderStore } from '../../stores/provider-store';
import {
	useAgentStore,
	usePlanModeActive,
	useAcceptModeActive,
	useDebugModeActive,
	useActiveAskUserQuestion,
	useSessionGoal,
} from '../../stores/agentStore';
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
import type { MessageMode, Attachment, FileMention, SessionConnectionState, UserContentPart } from '../../stores/agentStore';

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

	// Panel root + composer handle, used by the panel-scoped keyboard dispatcher.
	const rootRef = useRef<HTMLDivElement>(null);
	const chatInputRef = useRef<ChatInputContainerHandle>(null);

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
		async (content: string, mode: 'planning' | 'fast', _model: string, attachments?: Attachment[], mentions?: FileMention[], skills?: string[], parts?: UserContentPart[]) => {
			await sendMessage(content, mode as MessageMode, attachments, mentions, skills, parts);
		},
		[sendMessage]
	);

	// Queue a message for later flush when the current turn finishes.
	const enqueueMessage = useAgentStore((state) => state.enqueueMessage);
	const popQueueForRecall = useAgentStore((state) => state.popQueueForRecall);
	const handleEnqueue = useCallback(
		(content: string, mode: 'planning' | 'fast', model: string, attachments?: Attachment[], mentions?: FileMention[], skills?: string[], parts?: UserContentPart[]) => {
			if (!sessionId) return;
			enqueueMessage(sessionId, {
				content,
				mode: mode as MessageMode,
				model,
				attachments,
				mentions,
				skills,
				parts,
			});
		},
		[sessionId, enqueueMessage]
	);

	const handleRecallQueue = useCallback((): { text: string; mentions?: FileMention[]; skills?: string[] } | null => {
		if (!sessionId) return null;
		const popped = popQueueForRecall(sessionId);
		if (popped.length === 0) return null;
		const text = popped.map((q) => q.content).join('\n\n');
		const mentionMap = new Map<string, FileMention>();
		const skillSet = new Set<string>();
		for (const q of popped) {
			for (const m of q.mentions ?? []) mentionMap.set(m.path, m);
			for (const n of q.skills ?? []) skillSet.add(n);
		}
		const mentions = Array.from(mentionMap.values());
		const skills = Array.from(skillSet);
		return {
			text,
			mentions: mentions.length ? mentions : undefined,
			skills: skills.length ? skills : undefined,
		};
	}, [sessionId, popQueueForRecall]);

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

	// Mode state from store (set by bridge events for plan/accept; local for debug)
	const planModeActive = usePlanModeActive(sessionId ?? null);
	const acceptModeActive = useAcceptModeActive(sessionId ?? null);
	const debugModeActive = useDebugModeActive(sessionId ?? null);
	const sessionGoal = useSessionGoal(sessionId ?? null);
	const setDebugMode = useAgentStore((s) => s.setDebugMode);

	// Active AskUserQuestion (floated above input)
	const activeQuestion = useActiveAskUserQuestion(sessionId ?? null);

	// Handle mode selector changes — modes are mutually exclusive overlays.
	// Cycles: default → plan → accept → debug (click or Shift+Tab).
	const handleModeChange = useCallback(
		(mode: Mode) => {
			if (!sessionId) return;
			// Plan and Accept are sync'd to the bridge; Debug stays local until
			// the Debug-backend phase lands (goal capture + periodic review).
			setPlanMode(mode === 'plan');
			setAcceptMode(mode === 'accept');
			setDebugMode(sessionId, mode === 'debug');
		},
		[sessionId, setPlanMode, setAcceptMode, setDebugMode]
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

	// Panel-scoped keyboard dispatcher.
	//
	// Listens at document level so shortcuts (Escape, Enter) fire no matter
	// where focus is within this agent panel — editor, message feed,
	// buttons, pills, empty whitespace. Containment check ensures the
	// listener only fires when this panel actually "owns" the focus; if the
	// user is typing in the terminal or another panel we stay out of the way.
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			// Skip if something downstream (composer's own handleKeyDown, a
			// button's activation handler, etc.) already handled this press.
			if (event.defaultPrevented) return;
			const root = rootRef.current;
			if (!root) return;
			// Hidden/collapsed panels shouldn't steal shortcuts.
			if (root.offsetParent === null) return;

			const active = document.activeElement;
			const focusInPanel =
				active === null ||
				active === document.body ||
				(active instanceof Node && root.contains(active));
			if (!focusInPanel) return;

			// Escape = abort current turn and pull queued messages back into
			// the composer for editing. Works whether or not the queue has
			// items (empty-queue case is a plain abort).
			if (event.key === 'Escape' && isRunning) {
				event.preventDefault();
				chatInputRef.current?.abortWithRecall();
				return;
			}

			// Enter (no shift) = send / queue whatever is in the composer,
			// even if focus is elsewhere in the panel. Skip when focus is in
			// an editable or interactive target — those have their own
			// Enter semantics (composer handles its own Enter; buttons fire
			// clicks; etc.).
			if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
				const target = event.target;
				const isInteractive =
					target instanceof HTMLElement &&
					!!target.closest('input, textarea, select, button, a[href], [contenteditable="true"]');
				if (isInteractive) return;
				event.preventDefault();
				chatInputRef.current?.submit();
			}
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [isRunning]);

	// Keep focus inside the panel on clicks that would otherwise land on
	// non-focusable elements (e.g. the message feed's whitespace). Without
	// this, clicking a blank area moves focus to document.body and the
	// dispatcher's containment check fails until the user clicks an
	// interactive child again.
	const handleRootMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement;
		const isInteractive = target.closest(
			'input, textarea, select, button, a[href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
		);
		if (isInteractive) return;
		// Defer so the native mousedown completes first.
		requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
	}, []);

	const sessionMenu = (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="absolute right-4 top-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-border/70 bg-background/84 text-muted-foreground shadow-[0_10px_24px_-20px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-[background-color,border-color,color,transform] duration-150 hover:bg-card hover:text-foreground active:scale-[0.97]"
					title="Session actions"
					aria-label="Session actions"
				>
					<PlusIcon className="h-4 w-4" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" side="bottom" className="w-52">
				<DropdownMenuItem
					onClick={handleNewSession}
					className="flex items-center gap-2 px-2 py-1.5"
				>
					<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10">
						<Pencil2Icon className="h-3 w-3 text-primary" />
					</div>
					<div className="flex flex-col">
						<span className="text-xs font-medium">New chat</span>
						<span className="text-[11px] leading-tight text-muted-foreground">Start a blank conversation</span>
					</div>
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={handleForkSession}
					disabled={!sessionId}
					className="flex items-center gap-2 px-2 py-1.5"
				>
					<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10">
						<Split className="h-3 w-3 text-primary" />
					</div>
					<div className="flex flex-col">
						<span className="text-xs font-medium">Continue as new</span>
						<span className="text-[11px] leading-tight text-muted-foreground">New chat with this context</span>
					</div>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);


	if (messages.length === 0) {
		return (
			<div
				ref={rootRef}
				tabIndex={-1}
				onMouseDown={handleRootMouseDown}
				className={`relative flex h-full flex-col overflow-hidden rounded-[26px] bg-transparent focus:outline-none ${className}`}
				data-instance-id={instanceId}
				style={{ fontFamily: 'var(--font-chat)' }}
			>
				{sessionMenu}

				<div className="flex flex-1 items-center justify-center px-6">
					<div className="flex w-full max-w-[56rem] flex-col items-center">
						<div className="flex flex-col items-center gap-4">
							<SoloDecryptAnimation />
							<p className="text-[12px] tracking-[0.08em] text-muted-foreground/65">
								Your AI coding agent
							</p>
						</div>

						<div className="mt-10 w-full">
							<QueuedMessagesStrip sessionId={sessionId ?? null} />
							<ChatInputContainer
								ref={chatInputRef}
								onSubmit={handleSubmit}
								onEnqueue={handleEnqueue}
								onRecallQueue={handleRecallQueue}
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
								debugModeActive={debugModeActive}
							/>
						</div>
					</div>
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
			</div>
		);
	}

	return (
		<div
			ref={rootRef}
			tabIndex={-1}
			onMouseDown={handleRootMouseDown}
				className={`relative flex h-full flex-col overflow-hidden rounded-[26px] bg-transparent focus:outline-none ${className}`}
				data-instance-id={instanceId}
				style={{ fontFamily: 'var(--font-chat)' }}
		>
			{sessionMenu}

			{debugModeActive && sessionGoal && (
				<div
					className="px-4 pt-3"
					role="note"
					aria-label="Debug mode session goal"
				>
					<div className="mx-auto max-w-[56rem] rounded-[14px] border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300 flex items-start gap-2">
						<span className="text-[10px] font-semibold uppercase tracking-wider mt-0.5 shrink-0 opacity-80">
							Goal
						</span>
						<span className="text-xs leading-tight line-clamp-2">{sessionGoal}</span>
					</div>
				</div>
			)}

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
				<div className="mx-auto mt-3 flex w-full max-w-[56rem] items-center gap-2 rounded-[14px] border border-border/60 bg-card/70 px-4 py-2 text-sm text-muted-foreground" role="status" aria-live="polite">
					<span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
					Reconnecting session...
				</div>
			)}

				{connectionState === 'stale' && (
					<div className="mx-auto mt-3 w-full max-w-[56rem] rounded-[14px] border border-warning/20 bg-warning/5 px-4 py-2 text-sm text-warning" role="alert">
						Session resume failed. Start a new continuation or fork this session before sending more.
					</div>
				)}

			{error && (
				<div className="mx-auto mt-3 w-full max-w-[56rem] rounded-[14px] border border-destructive/20 bg-destructive/10 px-4 py-2" role="alert">
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
				<div className="relative z-30 mx-auto w-full max-w-[56rem] px-4">
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
				<QueuedMessagesStrip sessionId={sessionId ?? null} />
				<ChatInputContainer
					ref={chatInputRef}
					onSubmit={handleSubmit}
					onEnqueue={handleEnqueue}
					onRecallQueue={handleRecallQueue}
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
					debugModeActive={debugModeActive}
				/>
			</div>
		</div>
	);
};
