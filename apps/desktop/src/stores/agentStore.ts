/**
 * Agent Zustand Store
 *
 * Manages agent sessions, messages, and streaming state.
 * Uses the agent-bridge protocol (Claude Agent SDK via Node.js sidecar).
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { BridgeAgentMessage, PermissionRequest, TokenUsage, AttachmentContentBlock } from '../bindings';
import * as backend from '../lib/backend';
import {
	loadAllSessions,
	migrateFromLocalStorage,
	saveSession,
	deleteSessionFile,
	createDebouncedSessionSave,
} from '../lib/sessionPersistence';
import { DEFAULT_MODEL_ID } from '../lib/constants';

// Enable Map and Set support in Immer
enableMapSet();

// =============================================================================
// Stable Reference Constants (for React 19 compatibility)
// =============================================================================

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_SESSIONS: AgentSession[] = [];
const EMPTY_PERMISSIONS: PermissionRequest[] = [];

// =============================================================================
// Types
// =============================================================================

export type MessageMode = 'planning' | 'fast';

/** Connection lifecycle state for bridge sessions */
export type SessionConnectionState = 'archived' | 'resuming' | 'active' | 'stale';

/** Max concurrent active bridge sessions (evicts LRU when exceeded) */
const MAX_ACTIVE_SESSIONS = 3;

export interface ToolCallState {
	id: string;
	name: string;
	input: unknown;
	status: 'awaiting-permission' | 'running' | 'success' | 'error';
	output?: string;
	requestId?: string;
}

export type ContentBlock =
	| { type: 'text'; text: string }
	| { type: 'thinking'; text: string }
	| { type: 'tool_use'; toolCallIndex: number };

export interface FileAttachment {
	name: string;
	path: string;
	mimeType?: string;
	size?: number;
}

export interface ImageAttachment {
	name: string;
	path: string;
	previewUrl?: string;
	width?: number;
	height?: number;
}

/** Unified attachment type (master model) */
export interface Attachment {
	id: string;
	type: 'file' | 'image';
	path: string;
	name: string;
	mimeType?: string;
	thumbnailUrl?: string;
	size?: number;
	base64Data?: string; // Raw base64 for inline images (no data: prefix)
}

/** File mention from @-mention in Lexical editor */
export interface FileMention {
	path: string;
	name: string;
	relativePath: string;
}

export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	blocks: ContentBlock[];
	timestamp: Date;
	mode?: MessageMode;
	toolCalls?: ToolCallState[];
	isStreaming?: boolean;
	isInterrupted?: boolean;
	thinkingContent?: string;
	thinkingDurationMs?: number;
	attachedFiles?: FileAttachment[];
	attachedImages?: ImageAttachment[];
	attachments?: Attachment[];
	mentions?: FileMention[];
	turnNumber?: number;
	usage?: TokenUsage;
	costUsd?: number;
	durationMs?: number;
}

export interface AgentSession {
	id: string;
	sdkSessionId?: string;
	createdAt: Date;
	model: string;
	name?: string;
	currentTurn?: number;
	// v3 persistence fields
	resumable?: boolean;
	workspacePath?: string;
	lastActiveAt?: string;
	totalTokens?: number;
	totalCost?: number;
	turnCount?: number;
	tags?: string[];
	summary?: string;
	// Worktree binding (persisted — survives workspace switches + app restarts)
	worktreeId?: string;
	worktreeBranch?: string;
	// Connection lifecycle (transient — never persisted, always 'archived' on load)
	connectionState: SessionConnectionState;
	resumeError?: string;
}

export interface SessionStreamState {
	streamingMessageId: string | null;
	streamingContent: string;
	/** Per-segment text accumulator — resets after each tool_use block so text between tools gets separate blocks */
	streamingSegmentContent: string;
	streamingThinking: string;
	thinkingStartTime: number | null;
	activeToolCalls: Map<string, ToolCallState>;
	isStreaming: boolean;
	error: string | null;
}

// =============================================================================
// Helpers
// =============================================================================

function generateSessionId(): string {
	return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Map full model ID to bridge AgentModel alias */
function toAgentModel(modelId: string): 'haiku' | 'sonnet' | 'opus' {
	if (modelId.includes('haiku')) return 'haiku';
	if (modelId.includes('sonnet')) return 'sonnet';
	return 'opus';
}

/** Convert unified Attachment + FileMention arrays into AttachmentContentBlock[] for the bridge */
function toContentBlocks(
	attachments?: Attachment[],
	mentions?: FileMention[],
): AttachmentContentBlock[] | undefined {
	const blocks: AttachmentContentBlock[] = [];

	if (attachments) {
		for (const att of attachments) {
			if (att.type === 'image' && att.base64Data) {
				// Inline image (sketch, clipboard paste)
				blocks.push({
					type: 'image',
					name: att.name,
					source: {
						type: 'base64',
						mediaType: att.mimeType || 'image/png',
						data: att.base64Data,
					},
				});
			} else {
				blocks.push({
					type: att.type === 'image' ? 'image' : 'document',
					name: att.name,
					filePath: att.path,
				});
			}
		}
	}

	if (mentions) {
		for (const mention of mentions) {
			blocks.push({
				type: 'text',
				name: mention.name,
				filePath: mention.path,
			});
		}
	}

	return blocks.length > 0 ? blocks : undefined;
}

function createDefaultStreamState(): SessionStreamState {
	return {
		streamingMessageId: null,
		streamingContent: '',
		streamingSegmentContent: '',
		streamingThinking: '',
		thinkingStartTime: null,
		activeToolCalls: new Map(),
		isStreaming: false,
		error: null,
	};
}

function getOrCreateStreamState(
	map: Map<string, SessionStreamState>,
	sessionId: string
): SessionStreamState {
	let state = map.get(sessionId);
	if (!state) {
		state = createDefaultStreamState();
		map.set(sessionId, state);
	}
	return state;
}

// =============================================================================
// State
// =============================================================================

interface AgentState {
	// Sessions
	sessions: Map<string, AgentSession>;
	activeSessionId: string | null;

	// Messages per session (sessionId -> messages)
	messages: Map<string, Message[]>;

	// Pending permission requests
	pendingPermissions: Map<string, PermissionRequest>;

	// Per-session streaming state
	sessionStreaming: Map<string, SessionStreamState>;

	// Model selection
	selectedModel: string;

	// UI state
	isAgentRunning: boolean;
	error: string | null;

	// Plan mode per session (sessionId -> boolean)
	planModeActive: Map<string, boolean>;

	// Accept mode per session (sessionId -> boolean), synced from backend events
	acceptModeActive: Map<string, boolean>;
}

interface AgentActions {
	// Session management
	createSession: (model?: string) => Promise<string>;
	forkSession: (sourceSessionId: string, model?: string) => Promise<string>;
	setActiveSession: (sessionId: string) => void;
	deleteSession: (sessionId: string) => void;
	renameSession: (sessionId: string, name: string, source?: 'user' | 'auto') => void;
	setModel: (sessionId: string, model: string) => Promise<void>;
	interrupt: (sessionId: string) => Promise<void>;

	// Model selection
	setSelectedModel: (model: string) => void;

	// Message handling
	sendMessage: (sessionId: string, content: string, mode?: MessageMode, attachments?: Attachment[], mentions?: FileMention[]) => Promise<void>;
	addUserMessage: (sessionId: string, content: string, mode?: MessageMode, attachments?: Attachment[], mentions?: FileMention[]) => string;

	// Mode management
	setPlanMode: (sessionId: string, enabled: boolean) => Promise<void>;
	setThinkingMode: (sessionId: string, enabled: boolean, maxTokens?: number) => Promise<void>;
	setAcceptMode: (sessionId: string, enabled: boolean) => Promise<void>;

	// Bridge event handlers
	handleAgentMessage: (sessionId: string, message: BridgeAgentMessage) => void;
	handlePermissionRequest: (request: PermissionRequest) => void;
	handleSessionInit: (sessionId: string, sdkSessionId: string, isResumed: boolean, isForked: boolean) => void;
	handleTurnStart: (sessionId: string, turnNumber: number) => void;
	handlePlanModeChanged: (sessionId: string, enabled: boolean) => void;
	handleAcceptModeChanged: (sessionId: string, enabled: boolean) => void;
	handleError: (message: string, stack?: string) => void;
	respondPermission: (requestId: string, decision: 'approve' | 'deny', always?: boolean, answers?: Record<string, string>) => Promise<void>;

	// Abort / tool approval (compatibility with master's API surface)
	abortSession: (sessionId: string) => Promise<void>;
	resolveToolApproval: (sessionId: string, toolCallId: string, approved: boolean) => Promise<void>;

	// Session lifecycle
	ensureActive: (sessionId: string) => Promise<void>;
	pruneExpiredSessions: (retentionDays: number) => Promise<void>;
	archiveAllSessions: () => void;
	saveActiveSessionForWorkspace: (workspacePath: string) => void;
	restoreActiveSessionForWorkspace: (workspacePath: string) => void;

	// Persistence
	loadPersistedSessions: () => Promise<void>;
	persistSessions: (sessionId?: string) => void;

	// Utilities
	clearError: (sessionId: string) => void;
	getSessionMessages: (sessionId: string) => Message[];
}

type AgentStore = AgentState & AgentActions;

// =============================================================================
// Initial State
// =============================================================================

const initialState: AgentState = {
	sessions: new Map(),
	activeSessionId: null,
	messages: new Map(),
	pendingPermissions: new Map(),
	sessionStreaming: new Map(),
	selectedModel: DEFAULT_MODEL_ID,
	isAgentRunning: false,
	error: null,
	planModeActive: new Map(),
	acceptModeActive: new Map(),
};

// Create per-session debounced save function (saves 1 second after last change)
const debouncedSave = createDebouncedSessionSave(1000);

/** Module-level lock set for preventing concurrent ensureActive() calls per session.
 *  JS is single-threaded for sync code, so Set.add/has/delete are atomic. */
const _resumingLocks = new Set<string>();

/** Helper: persist a specific session or all sessions */
function doPersist(sessionId?: string): void {
	const state = useAgentStore.getState();
	if (sessionId) {
		const session = state.sessions.get(sessionId);
		const messages = state.messages.get(sessionId) || [];
		if (session) {
			debouncedSave.save(session, messages);
		}
	} else {
		// Save all sessions
		for (const [id, session] of state.sessions) {
			const messages = state.messages.get(id) || [];
			debouncedSave.save(session, messages);
		}
	}
}

// =============================================================================
// Store
// =============================================================================

export const useAgentStore = create<AgentStore>()(
	immer((set, get) => ({
		...initialState,

		// =================================================================
		// Persistence
		// =================================================================

		loadPersistedSessions: async () => {
			// 1. Try filesystem first
			let persisted = await loadAllSessions();

			// 2. If empty, try migrating from localStorage (one-time v2→v3)
			if (!persisted) {
				persisted = await migrateFromLocalStorage();
			}

			if (persisted) {
				set((state) => {
					state.sessions = persisted.sessions;
					// Mark ALL loaded sessions as archived (no bridge connection yet)
					for (const session of state.sessions.values()) {
						session.connectionState = 'archived';
					}
					state.messages = persisted.messages;
					for (const sessionId of persisted.sessions.keys()) {
						if (!state.sessionStreaming.has(sessionId)) {
							state.sessionStreaming.set(sessionId, createDefaultStreamState());
						}
					}
				});
			}
		},

		persistSessions: (sessionId?: string) => {
			doPersist(sessionId);
		},

		// =================================================================
		// Session Lifecycle (lazy resume)
		// =================================================================

		ensureActive: async (sessionId: string) => {
			const session = get().sessions.get(sessionId);
			if (!session) throw new Error(`Session ${sessionId} not found`);
			if (session.connectionState === 'active') return;

			// If already resuming (state or lock), wait for completion (poll up to 15s)
			if (session.connectionState === 'resuming' || _resumingLocks.has(sessionId)) {
				const maxWait = 15000;
				const start = Date.now();
				while (Date.now() - start < maxWait) {
					await new Promise((r) => setTimeout(r, 200));
					const current = get().sessions.get(sessionId);
					if (!current || current.connectionState === 'active') return;
					if (current.connectionState !== 'resuming' && !_resumingLocks.has(sessionId)) break;
				}
				const current = get().sessions.get(sessionId);
				if (current?.connectionState === 'active') return;
				throw new Error('Session resume timed out');
			}

			// Acquire resumption lock to prevent concurrent resume attempts
			_resumingLocks.add(sessionId);

			// Stale sessions (from bridge crash) proceed through normal resume flow
			// Mark as resuming
			set((s) => {
				const sess = s.sessions.get(sessionId);
				if (sess) {
					sess.connectionState = 'resuming';
					sess.resumeError = undefined;
				}
			});

			// Evict oldest active session if at max capacity
			const activeSessions = [...get().sessions.values()]
				.filter((s) => s.connectionState === 'active')
				.sort((a, b) => {
					const aTime = new Date(a.lastActiveAt || a.createdAt).getTime();
					const bTime = new Date(b.lastActiveAt || b.createdAt).getTime();
					return aTime - bTime; // oldest first
				});

			if (activeSessions.length >= MAX_ACTIVE_SESSIONS) {
				const oldest = activeSessions[0];
				backend.agentDeleteSession(oldest.id).catch(console.error);
				set((s) => {
					const sess = s.sessions.get(oldest.id);
					if (sess) sess.connectionState = 'archived';
				});
			}

			const agentModel = toAgentModel(session.model || 'opus');

			try {
				try {
					// Attempt resume with persisted SDK session ID
					if (session.sdkSessionId && session.resumable) {
						await backend.agentCreateSession(sessionId, {
							model: agentModel,
							resumeSessionId: session.sdkSessionId,
							cwd: session.workspacePath,
						});
					} else {
						// No SDK session to resume — create fresh bridge session
						await backend.agentCreateSession(sessionId, { model: agentModel, cwd: session.workspacePath });
					}

					set((s) => {
						const sess = s.sessions.get(sessionId);
						if (sess) {
							sess.connectionState = 'active';
							sess.resumeError = undefined;
						}
					});
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error);
					console.error(`[Agent] Resume failed for ${sessionId}: ${errorMsg}`);

					// Auto-fork: create fresh bridge session, preserving message history
					try {
						await backend.agentCreateSession(sessionId, { model: agentModel, cwd: session.workspacePath });
						set((s) => {
							const sess = s.sessions.get(sessionId);
							if (sess) {
								sess.connectionState = 'active';
								sess.resumable = false;
								sess.sdkSessionId = undefined;
								sess.resumeError = undefined;
							}
						});
					} catch (forkError) {
						const forkMsg = forkError instanceof Error ? forkError.message : String(forkError);
						console.error(`[Agent] Fork also failed for ${sessionId}: ${forkMsg}`);
						set((s) => {
							const sess = s.sessions.get(sessionId);
							if (sess) {
								sess.connectionState = 'archived';
								sess.resumeError = forkMsg;
							}
						});
						throw forkError;
					}
				}
			} finally {
				// Always release the resumption lock
				_resumingLocks.delete(sessionId);
			}
		},

		pruneExpiredSessions: async (retentionDays: number) => {
			if (retentionDays <= 0) return; // 0 = infinite retention
			const cutoff = Date.now() - retentionDays * 86_400_000;
			const toDelete: string[] = [];

			for (const [id, session] of get().sessions) {
				const lastActive = session.lastActiveAt
					? new Date(session.lastActiveAt).getTime()
					: session.createdAt.getTime();
				if (lastActive < cutoff && session.connectionState !== 'active') {
					toDelete.push(id);
				}
			}

			for (const id of toDelete) {
				get().deleteSession(id);
			}

			if (toDelete.length > 0) {
				console.log(`[Agent] Pruned ${toDelete.length} expired sessions (retention: ${retentionDays}d)`);
			}
		},

		archiveAllSessions: () => {
			// Disconnect bridge connections without deleting session data from memory or disk
			for (const [sessionId, session] of get().sessions) {
				if (session.connectionState === 'active' || session.connectionState === 'resuming') {
					backend.agentDeleteSession(sessionId).catch(console.error);
				}
			}
			set((state) => {
				for (const session of state.sessions.values()) {
					session.connectionState = 'archived';
				}
				state.activeSessionId = null;
			});
			// Flush all pending debounced saves immediately (not schedule new ones)
			debouncedSave.flush();
		},

		saveActiveSessionForWorkspace: (workspacePath: string) => {
			// Remember which session was active for this workspace so we can restore it later
			const activeId = get().activeSessionId;
			if (activeId) {
				try {
					localStorage.setItem(`solo-active-session:${workspacePath}`, activeId);
				} catch {
					// localStorage may be unavailable — non-critical
				}
			}
		},

		restoreActiveSessionForWorkspace: (workspacePath: string) => {
			// Re-activate the session that was last used in this workspace
			try {
				const savedId = localStorage.getItem(`solo-active-session:${workspacePath}`);
				if (savedId && get().sessions.has(savedId)) {
					set((state) => {
						state.activeSessionId = savedId;
					});
				}
			} catch {
				// localStorage may be unavailable — non-critical
			}
		},

		// =================================================================
		// Session Management
		// =================================================================

		createSession: async (model?: string) => {
			const sessionId = generateSessionId();
			const agentModel = toAgentModel(model || 'opus');

			try {
				// If a worktree is active, use its path as the session cwd
				const { useWorktreeStore } = await import('@/stores/worktreeStore');
				const worktreeState = useWorktreeStore.getState();
				const activeWt = worktreeState.activeWorktreeId
					? worktreeState.worktrees.get(worktreeState.activeWorktreeId)
					: null;

				const { useFileExplorerStore } = await import('@/stores/fileExplorerStore');
				const workspacePath = useFileExplorerStore.getState().rootPath ?? undefined;
				const cwd = activeWt?.path ?? workspacePath;

				await backend.agentCreateSession(sessionId, { model: agentModel, cwd });

				set((state) => {
					state.sessions.set(sessionId, {
						id: sessionId,
						createdAt: new Date(),
						model: model || 'opus',
						workspacePath: cwd,
						worktreeId: activeWt?.id,
						worktreeBranch: activeWt?.branch ?? undefined,
						turnCount: 0,
						resumable: false,
						connectionState: 'active',
					});
					state.messages.set(sessionId, []);
					state.sessionStreaming.set(sessionId, createDefaultStreamState());
				});

				// Bind agent to active worktree (auto-locks it)
				if (activeWt) {
					import('@/lib/tauri/worktree').then(({ bindAgent }) => {
						bindAgent(activeWt.id, sessionId).catch(console.error);
					});
				}

				// Apply tool permission policy from settings (fire-and-forget)
				import('@/stores/settingsStore').then(({ useSettingsStore }) => {
					const policy = useSettingsStore.getState().ai.toolPermissionPolicy ?? 'smart';
					const isWorktree = !!activeWt;
					backend.agentSetToolPolicy(sessionId, policy, isWorktree).catch((e) =>
						console.warn('[Agent] set_tool_policy:', e)
					);
				});

				get().persistSessions(sessionId);
				return sessionId;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.error(`Failed to create session: ${errorMsg}`);
				throw error;
			}
		},

		forkSession: async (sourceSessionId: string, model?: string) => {
			const sourceSession = get().sessions.get(sourceSessionId);
			if (!sourceSession) throw new Error(`Source session ${sourceSessionId} not found`);
			if (!sourceSession.sdkSessionId) throw new Error('Source session has no SDK session ID to fork from');

			const sessionId = generateSessionId();
			const agentModel = toAgentModel(model || sourceSession.model || 'opus');

			try {
				const { useFileExplorerStore } = await import('@/stores/fileExplorerStore');
				const workspacePath = useFileExplorerStore.getState().rootPath ?? undefined;

				const { useWorktreeStore } = await import('@/stores/worktreeStore');
				const worktreeState = useWorktreeStore.getState();
				const activeWt = worktreeState.activeWorktreeId
					? worktreeState.worktrees.get(worktreeState.activeWorktreeId)
					: null;
				const cwd = activeWt?.path ?? workspacePath;

				await backend.agentCreateSession(sessionId, {
					model: agentModel,
					resumeSessionId: sourceSession.sdkSessionId,
					forkSession: true,
					cwd,
				});

				// Copy messages from source session for visual continuity
				const sourceMessages = get().messages.get(sourceSessionId) || [];

				set((state) => {
					state.sessions.set(sessionId, {
						id: sessionId,
						createdAt: new Date(),
						model: model || sourceSession.model || 'opus',
						workspacePath: sourceSession.workspacePath,
						worktreeId: activeWt?.id ?? sourceSession.worktreeId,
						worktreeBranch: (activeWt?.branch ?? sourceSession.worktreeBranch) ?? undefined,
						turnCount: 0,
						resumable: false,
						connectionState: 'active',
					});
					state.messages.set(sessionId, [...sourceMessages]);
					state.sessionStreaming.set(sessionId, createDefaultStreamState());
				});

				// Bind agent to active worktree
				if (activeWt) {
					import('@/lib/tauri/worktree').then(({ bindAgent }) => {
						bindAgent(activeWt.id, sessionId).catch(console.error);
					});
				}

				// Apply tool permission policy from settings
				import('@/stores/settingsStore').then(({ useSettingsStore }) => {
					const policy = useSettingsStore.getState().ai.toolPermissionPolicy;
					backend.agentSetToolPolicy(sessionId, policy, !!activeWt).catch(console.error);
				});

				get().persistSessions(sessionId);
				return sessionId;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.error(`Failed to fork session: ${errorMsg}`);
				throw error;
			}
		},

		setModel: async (sessionId: string, model: string) => {
			try {
				await backend.agentSetModel(sessionId, toAgentModel(model));
				set((state) => {
					const session = state.sessions.get(sessionId);
					if (session) {
						session.model = model;
					}
				});
			} catch (error) {
				console.error('Failed to set model:', error);
			}
		},

		interrupt: async (sessionId: string) => {
			try {
				await backend.agentInterrupt(sessionId);
			} catch (error) {
				console.error('Failed to interrupt session:', error);
			}

			set((state) => {
				const streamState = state.sessionStreaming.get(sessionId);
				if (streamState && streamState.streamingMessageId) {
					const messages = state.messages.get(sessionId);
					if (messages) {
						const msg = messages.find((m) => m.id === streamState.streamingMessageId);
						if (msg) {
							msg.isStreaming = false;
							msg.isInterrupted = true;
						}
					}

					// Clear pending permissions
					for (const [id, perm] of state.pendingPermissions) {
						if (perm.sessionId === sessionId) {
							state.pendingPermissions.delete(id);
						}
					}

					// Reset streaming state
					streamState.streamingMessageId = null;
					streamState.streamingContent = '';
					streamState.streamingSegmentContent = '';
					streamState.streamingThinking = '';
					streamState.thinkingStartTime = null;
					streamState.activeToolCalls = new Map();
					streamState.isStreaming = false;
				}
			});
		},

		setActiveSession: (sessionId: string) => {
			set((state) => {
				if (state.sessions.has(sessionId)) {
					state.activeSessionId = sessionId;
				}
			});
		},

		deleteSession: (sessionId: string) => {
			// Delete from bridge (fire-and-forget)
			backend.agentDeleteSession(sessionId).catch(console.error);
			// Delete session file from disk (fire-and-forget)
			deleteSessionFile(sessionId).catch(console.error);
			// Unbind from any worktree (fire-and-forget)
			import('@/lib/tauri/worktree').then(({ findByAgent, unbindAgent }) => {
				findByAgent(sessionId).then((wtId) => {
					if (wtId) unbindAgent(wtId).catch(console.error);
				}).catch(console.error);
			});

			set((state) => {
				state.sessions.delete(sessionId);
				state.messages.delete(sessionId);
				state.sessionStreaming.delete(sessionId);
				if (state.activeSessionId === sessionId) {
					const remaining = Array.from(state.sessions.keys());
					state.activeSessionId = remaining.length > 0 ? remaining[0] : null;
				}
			});
		},

		renameSession: (sessionId: string, name: string, source: 'user' | 'auto' = 'user') => {
			set((state) => {
				const session = state.sessions.get(sessionId);
				if (session) {
					const trimmed = name.trim();
					session.name = trimmed || undefined;
					// Track who set the name so auto-title doesn't overwrite user renames
					(session as AgentSession & { nameSetBy?: 'user' | 'auto' }).nameSetBy = source;
				}
			});
			get().persistSessions(sessionId);
		},

		setSelectedModel: (model: string) => {
			set((state) => {
				state.selectedModel = model;
			});
		},

		// =================================================================
		// Message Handling
		// =================================================================

		sendMessage: async (sessionId: string, content: string, mode?: MessageMode, attachments?: Attachment[], mentions?: FileMention[]) => {
			if (!sessionId) return;

			// Lazy resume: ensure bridge connection before sending
			await get().ensureActive(sessionId);

			// Defensive: verify session is actually active after ensureActive returns
			const currentSession = get().sessions.get(sessionId);
			if (!currentSession || currentSession.connectionState !== 'active') {
				throw new Error(`Session ${sessionId} is not active after resume (state: ${currentSession?.connectionState ?? 'deleted'})`);
			}

			// Add user message
			get().addUserMessage(sessionId, content, mode, attachments, mentions);

			// Create placeholder for assistant response
			const assistantMessageId = `msg-${Date.now()}-assistant`;

			set((state) => {
				const sessionMessages = state.messages.get(sessionId) || [];
				sessionMessages.push({
					id: assistantMessageId,
					role: 'assistant',
					content: '',
					blocks: [],
					timestamp: new Date(),
					isStreaming: true,
				});
				state.messages.set(sessionId, sessionMessages);

				const streamState = getOrCreateStreamState(state.sessionStreaming, sessionId);
				streamState.streamingMessageId = assistantMessageId;
				streamState.streamingContent = '';
				streamState.streamingSegmentContent = '';
				streamState.streamingThinking = '';
				streamState.isStreaming = true;
				streamState.error = null;
			});

			try {
				await backend.agentSendMessage(sessionId, content, toContentBlocks(attachments, mentions));
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.error('[Agent] sendMessage failed:', errorMsg);
				set((state) => {
					const streamState = getOrCreateStreamState(state.sessionStreaming, sessionId);
					streamState.error = `Failed to send message: ${errorMsg}`;
					streamState.isStreaming = false;
					streamState.streamingMessageId = null;
				});
			}
		},

		addUserMessage: (sessionId: string, content: string, mode?: MessageMode, attachments?: Attachment[], mentions?: FileMention[]) => {
			const messageId = `msg-${Date.now()}-user`;

			set((state) => {
				const sessionMessages = state.messages.get(sessionId) || [];
				sessionMessages.push({
					id: messageId,
					role: 'user',
					content,
					blocks: [],
					timestamp: new Date(),
					mode,
					attachments: attachments?.length ? attachments : undefined,
					mentions: mentions?.length ? mentions : undefined,
				});
				state.messages.set(sessionId, sessionMessages);
			});

			get().persistSessions(sessionId);
			return messageId;
		},

		// =================================================================
		// Mode Management
		// =================================================================

		setPlanMode: async (sessionId: string, enabled: boolean) => {
			try {
				await backend.agentSetPlanMode(sessionId, enabled);
			} catch (error) {
				console.error('Failed to set plan mode:', error);
			}
		},

		setThinkingMode: async (sessionId: string, enabled: boolean, maxTokens?: number) => {
			try {
				await backend.agentSetThinkingMode(sessionId, enabled, maxTokens);
			} catch (error) {
				console.error('Failed to set thinking mode:', error);
			}
		},

		setAcceptMode: async (sessionId: string, enabled: boolean) => {
			try {
				await backend.agentSetAcceptMode(sessionId, enabled);
			} catch (error) {
				console.error('Failed to set accept mode:', error);
			}
		},

		// =================================================================
		// Bridge Event Handlers
		// =================================================================

		handleAgentMessage: (sessionId: string, message: BridgeAgentMessage) => {
			set((state) => {
				const streamState = getOrCreateStreamState(state.sessionStreaming, sessionId);
				const messages = state.messages.get(sessionId);

				switch (message.type) {
					case 'text': {
						// Append text delta to both accumulators
						streamState.streamingContent += message.content;        // total (for msg.content)
						streamState.streamingSegmentContent += message.content;  // per-block segment

						if (messages && streamState.streamingMessageId) {
							const msg = messages.find((m) => m.id === streamState.streamingMessageId);
							if (msg) {
								msg.content = streamState.streamingContent;

								// Ordered blocks: append to last text block or create new one
								// Uses streamingSegmentContent so each text segment between tools
								// gets its own block with proper markdown boundaries
								const lastBlock = msg.blocks[msg.blocks.length - 1];
								if (lastBlock && lastBlock.type === 'text') {
									lastBlock.text = streamState.streamingSegmentContent;
								} else {
									msg.blocks.push({ type: 'text', text: streamState.streamingSegmentContent });
								}
							}
						}
						break;
					}

					case 'thinking': {
						// Record start time on first thinking chunk
						if (streamState.thinkingStartTime === null) {
							streamState.thinkingStartTime = Date.now();
						}

						// Accumulate thinking content
						streamState.streamingThinking += message.content;
						const currentDuration = Date.now() - streamState.thinkingStartTime;

						if (messages && streamState.streamingMessageId) {
							const msg = messages.find((m) => m.id === streamState.streamingMessageId);
							if (msg) {
								msg.thinkingContent = streamState.streamingThinking;
								msg.thinkingDurationMs = currentDuration;

								// Ordered blocks: thinking is always at the front
								const firstBlock = msg.blocks[0];
								if (firstBlock && firstBlock.type === 'thinking') {
									firstBlock.text = streamState.streamingThinking;
								} else {
									msg.blocks.unshift({ type: 'thinking', text: streamState.streamingThinking });
								}
							}
						}
						break;
					}

					case 'tool_use': {
						const meta = message.metadata;
						if (!meta?.toolId) break;

						const toolId = meta.toolId;
						const toolStatus = meta.status || 'running';
						console.log('[DIAG] tool_use event', meta.toolName, toolId, 'status:', toolStatus);

						if (messages && streamState.streamingMessageId) {
							const msg = messages.find((m) => m.id === streamState.streamingMessageId);
							if (msg) {
								if (!msg.toolCalls) msg.toolCalls = [];

								// Try to find existing entry by toolId first
								let tcIndex = msg.toolCalls.findIndex((t) => t.id === toolId);

								if (tcIndex === -1) {
									// Check for a permission-created entry with same name.
									// Permission-created tools use requestId as their id, which differs
									// from the SDK's toolId. This fallback links them together.
									const reverseIndex = [...msg.toolCalls].reverse().findIndex(
										(t) => t.name === meta.toolName &&
											(t.status === 'awaiting-permission' || t.status === 'running')
									);
									if (reverseIndex !== -1) {
										tcIndex = msg.toolCalls.length - 1 - reverseIndex;
										// Link permission entry to real tool ID
										msg.toolCalls[tcIndex].id = toolId;
									}
								}

								if (tcIndex !== -1) {
									// Update existing entry — single source of truth
									msg.toolCalls[tcIndex].status = toolStatus as ToolCallState['status'];
									if (meta.toolOutput) msg.toolCalls[tcIndex].output = meta.toolOutput;
								} else if (toolStatus === 'awaiting-permission' || toolStatus === 'running') {
									// New tool entry
									const newTc: ToolCallState = {
										id: toolId,
										name: meta.toolName || 'unknown',
										input: meta.toolInput,
										status: toolStatus as ToolCallState['status'],
									};
									msg.toolCalls.push(newTc);

									// Push ordered block with index reference (no copy)
									msg.blocks.push({ type: 'tool_use', toolCallIndex: msg.toolCalls.length - 1 });

									// Reset segment content so the next text delta starts a fresh block
									streamState.streamingSegmentContent = '';
								}
							}
						}

						// Update activeToolCalls tracking
						if (toolStatus === 'running') {
							streamState.activeToolCalls.set(toolId, {
								id: toolId,
								name: meta.toolName || 'unknown',
								input: meta.toolInput,
								status: 'running',
							});
						} else {
							const existing = streamState.activeToolCalls.get(toolId);
							if (existing) {
								existing.status = toolStatus as ToolCallState['status'];
								existing.output = meta.toolOutput;
							}
						}
						break;
					}

					case 'result': {
						// Agentic loop complete — finalize message
						if (messages && streamState.streamingMessageId) {
							const msg = messages.find((m) => m.id === streamState.streamingMessageId);
							if (msg) {
								msg.isStreaming = false;
								// Finalize thinking duration
								if (streamState.thinkingStartTime !== null && msg.thinkingContent) {
									msg.thinkingDurationMs = Date.now() - streamState.thinkingStartTime;
								}
								if (message.usage) {
									msg.usage = message.usage;
								}
								if (message.totalCostUsd !== undefined) {
									msg.costUsd = message.totalCostUsd;
								}
								if (message.durationMs !== undefined) {
									msg.durationMs = message.durationMs;
								}
								// Set turn number from session's current turn (emitted by bridge via TurnStart)
								const session = state.sessions.get(sessionId);
								if (session?.currentTurn !== undefined) {
									msg.turnNumber = session.currentTurn;
								} else {
									// Derive from completed assistant message count
									const completedAssistant = messages.filter(
										(m) => m.role === 'assistant' && !m.isStreaming
									).length;
									msg.turnNumber = completedAssistant;
								}
							}
						}

						// Reset streaming state + turn counter, accumulate usage on session
						const session = state.sessions.get(sessionId);
						if (session) {
							session.currentTurn = undefined;
							// Accumulate usage stats
							if (message.usage) {
								const totalIn = (message.usage.inputTokens ?? 0) + (message.usage.cacheReadInputTokens ?? 0);
								const totalOut = message.usage.outputTokens ?? 0;
								session.totalTokens = (session.totalTokens ?? 0) + totalIn + totalOut;
							}
							if (message.totalCostUsd !== undefined) {
								session.totalCost = (session.totalCost ?? 0) + message.totalCostUsd;
							}
							session.turnCount = (session.turnCount ?? 0) + 1;
						}
						streamState.streamingMessageId = null;
						streamState.streamingContent = '';
						streamState.streamingSegmentContent = '';
						streamState.streamingThinking = '';
						streamState.thinkingStartTime = null;
						streamState.activeToolCalls = new Map();
						streamState.isStreaming = false;
						break;
					}

					case 'error': {
						streamState.error = message.content;
						streamState.isStreaming = false;

						if (messages && streamState.streamingMessageId) {
							const msg = messages.find((m) => m.id === streamState.streamingMessageId);
							if (msg) {
								msg.isStreaming = false;
								if (!msg.content) {
									msg.content = `Error: ${message.content}`;
								}
							}
						}

						streamState.streamingMessageId = null;
						streamState.streamingContent = '';
						streamState.streamingSegmentContent = '';
						streamState.streamingThinking = '';
						streamState.thinkingStartTime = null;
						streamState.activeToolCalls = new Map();
						break;
					}
				}
			});

			// Persist on result/error
			if (message.type === 'result' || message.type === 'error') {
				get().persistSessions(sessionId);
			}

			// Auto-generate title after first assistant turn completes
			if (message.type === 'result') {
				const currentSession = get().sessions.get(sessionId);
				if (currentSession && !currentSession.name && currentSession.turnCount === 1) {
					const sessionMessages = get().messages.get(sessionId) || [];
					const firstUserMsg = sessionMessages.find((m) => m.role === 'user');
					const firstAssistantMsg = sessionMessages.find(
						(m) => m.role === 'assistant' && !m.isStreaming,
					);
					if (firstUserMsg && firstAssistantMsg) {
						import('@tauri-apps/api/core').then(({ invoke }) => {
							invoke<string>('agent_generate_session_title', {
								userMessage: firstUserMsg.content,
								assistantMessage: firstAssistantMsg.content,
							})
								.then((title) => {
									if (title) {
										const sess = get().sessions.get(sessionId);
										// Only set auto-title if user hasn't manually renamed
										const nameSetBy = (sess as AgentSession & { nameSetBy?: string } | undefined)?.nameSetBy;
										if (sess && (!sess.name || nameSetBy !== 'user')) {
											get().renameSession(sessionId, title, 'auto');
										}
									}
								})
								.catch((err) => {
									console.warn('[Agent] Title generation failed:', err);
								});
						});
					}
				}
			}
		},

		handlePermissionRequest: (request: PermissionRequest) => {
			console.log('[DIAG] handlePermissionRequest called', request.toolName, request.requestId, request.sessionId);
			set((state) => {
				state.pendingPermissions.set(request.requestId, request);

				// Create a tool call entry in the streaming message
				const streamState = state.sessionStreaming.get(request.sessionId);
				if (streamState) {
					const messages = state.messages.get(request.sessionId);
					if (messages && streamState.streamingMessageId) {
						const msg = messages.find((m) => m.id === streamState.streamingMessageId);
						if (msg) {
							if (!msg.toolCalls) msg.toolCalls = [];

							// Look for an existing entry created by tool_use event
							// that hasn't been linked to a permission request yet
							const existingIndex = [...msg.toolCalls].reverse().findIndex(
								(t) => t.name === request.toolName &&
									t.status === 'awaiting-permission' &&
									!t.requestId
							);

							if (existingIndex !== -1) {
								const realIndex = msg.toolCalls.length - 1 - existingIndex;
								// Link permission request to the existing tool_use entry
								// Single source of truth — blocks reference by index
								msg.toolCalls[realIndex].requestId = request.requestId;
							} else {
								// Fallback: create new entry (if permission_request arrives before tool_use)
								const newTc: ToolCallState = {
									id: request.requestId,
									name: request.toolName,
									input: request.toolInput,
									status: 'awaiting-permission',
									requestId: request.requestId,
								};
								msg.toolCalls.push(newTc);
								msg.blocks.push({ type: 'tool_use', toolCallIndex: msg.toolCalls.length - 1 });
							}
							console.log('[DIAG] Permission entry created/linked, blocks:', msg.blocks.length, 'toolCalls:', msg.toolCalls?.length);
						}
					}

					// Reset segment content so the next text delta starts a fresh block
					streamState.streamingSegmentContent = '';
				}
			});
		},

		handleSessionInit: (sessionId: string, sdkSessionId: string, _isResumed: boolean, _isForked: boolean) => {
			// Snapshot session + messages inside Immer for immediate persistence.
			// Must deep-clone to fully escape Immer proxies — after set() returns,
			// all proxies are revoked and any retained references throw.
			let sessionSnapshot: AgentSession | undefined;
			let messagesSnapshot: Message[] = [];

			set((state) => {
				const session = state.sessions.get(sessionId);
				if (session) {
					session.sdkSessionId = sdkSessionId;
					session.resumable = true;
					// JSON round-trip avoids DataCloneError that structuredClone throws
					// on Immer proxy objects (Maps, Sets, Proxy wrappers from enableMapSet).
					const rawSession = JSON.parse(JSON.stringify(session)) as AgentSession;
					rawSession.createdAt = new Date(rawSession.createdAt);
					sessionSnapshot = rawSession;
					const rawMessages = JSON.parse(JSON.stringify(
						state.messages.get(sessionId) || []
					)) as Message[];
					for (const m of rawMessages) {
						m.timestamp = new Date(m.timestamp);
					}
					messagesSnapshot = rawMessages;
				}
			});

			// Persist immediately (no debounce) — sdkSessionId is critical for resume
			if (sessionSnapshot) {
				try {
					saveSession(sessionSnapshot, messagesSnapshot);
				} catch (e) {
					console.error('[handleSessionInit] Failed to persist session:', e);
				}
			}
		},

		handleTurnStart: (sessionId: string, turnNumber: number) => {
			set((state) => {
				const session = state.sessions.get(sessionId);
				if (session) {
					session.currentTurn = turnNumber;
				}
			});
		},

		handlePlanModeChanged: (sessionId: string, enabled: boolean) => {
			set((state) => {
				state.planModeActive.set(sessionId, enabled);
			});
		},

		handleAcceptModeChanged: (sessionId: string, enabled: boolean) => {
			set((state) => {
				state.acceptModeActive.set(sessionId, enabled);
			});
		},

		handleError: (message: string, _stack?: string) => {
			console.error('[Agent bridge error]', message);
			set((state) => {
				state.error = message;

				// On sidecar crash, mark all active/resuming sessions as stale
				// so ensureActive() knows to re-establish the bridge connection
				if (message.includes('exited unexpectedly')) {
					for (const session of state.sessions.values()) {
						if (session.connectionState === 'active' || session.connectionState === 'resuming') {
							session.connectionState = 'stale';
						}
					}
					// Clear all streaming states — the bridge is dead
					for (const [sessionId, streamState] of state.sessionStreaming) {
						if (streamState.isStreaming && streamState.streamingMessageId) {
							const messages = state.messages.get(sessionId);
							if (messages) {
								const msg = messages.find((m) => m.id === streamState.streamingMessageId);
								if (msg) {
									msg.isStreaming = false;
									msg.isInterrupted = true;
								}
							}
						}
						streamState.streamingMessageId = null;
						streamState.streamingContent = '';
						streamState.streamingSegmentContent = '';
						streamState.streamingThinking = '';
						streamState.thinkingStartTime = null;
						streamState.activeToolCalls = new Map();
						streamState.isStreaming = false;
					}
					// Clear all pending permissions — they can't be answered anymore
					state.pendingPermissions.clear();
				}
			});
		},

		respondPermission: async (requestId: string, decision: 'approve' | 'deny', always: boolean = false, answers?: Record<string, string>) => {
			try {
				await backend.agentRespondPermission(requestId, decision, always, answers);
			} catch (error) {
				console.error('Failed to respond to permission:', error);
			}

			// On deny: also interrupt the agent and clear all pending permissions
			if (decision === 'deny') {
				const request = get().pendingPermissions.get(requestId);
				if (request) {
					backend.agentInterrupt(request.sessionId).catch(console.error);
				}
			}

			set((state) => {
				const request = state.pendingPermissions.get(requestId);

				if (decision === 'deny') {
					// Clear ALL pending permissions on deny (agent is being stopped)
					state.pendingPermissions.clear();
				} else {
					state.pendingPermissions.delete(requestId);
				}

				// AskUserQuestion is fully resolved once the user submits answers —
				// the user's response IS the tool output, so mark as success immediately
				// rather than waiting for a backend round-trip.
				const isAskQuestion = request?.toolName?.toLowerCase() === 'askuserquestion';
				const newStatus = decision === 'deny'
					? 'error' as const
					: (isAskQuestion ? 'success' as const : 'running' as const);
				const denyOutput = decision === 'deny' ? 'Denied by user' : undefined;

				// Update tool call status in the relevant message
				// Single source of truth: only update msg.toolCalls (blocks reference by index)
				if (request) {
					const streamState = state.sessionStreaming.get(request.sessionId);
					if (streamState) {
						const messages = state.messages.get(request.sessionId);
						if (messages && streamState.streamingMessageId) {
							const msg = messages.find((m) => m.id === streamState.streamingMessageId);
							if (msg) {
								if (msg.toolCalls) {
									const tc = msg.toolCalls.find(
										(t) => t.requestId === requestId
									);
									if (tc) {
										tc.status = newStatus;
										if (denyOutput) tc.output = denyOutput;
									}
								}

								// On deny: mark message as interrupted
								if (decision === 'deny') {
									msg.isStreaming = false;
									msg.isInterrupted = true;
								}
							}
						}

						// Reset streaming state on deny
						if (decision === 'deny') {
							streamState.streamingMessageId = null;
							streamState.streamingContent = '';
							streamState.streamingSegmentContent = '';
							streamState.streamingThinking = '';
							streamState.thinkingStartTime = null;
							streamState.activeToolCalls = new Map();
							streamState.isStreaming = false;
						}
					}
				}
			});
		},

		// =================================================================
		// Abort / Tool Approval (master API compatibility)
		// =================================================================

		abortSession: async (sessionId: string) => {
			// Delegates to interrupt (bridge equivalent of abort)
			await get().interrupt(sessionId);
		},

		resolveToolApproval: async (_sessionId: string, toolCallId: string, approved: boolean) => {
			// Map master's resolveToolApproval to bridge's respondPermission
			// The toolCallId here is the requestId in the bridge permission model
			await get().respondPermission(toolCallId, approved ? 'approve' : 'deny');
		},

		// =================================================================
		// Utilities
		// =================================================================

		clearError: (sessionId: string) => {
			set((state) => {
				const streamState = state.sessionStreaming.get(sessionId);
				if (streamState) {
					streamState.error = null;
				}
			});
		},

		getSessionMessages: (sessionId: string) => {
			return get().messages.get(sessionId) || [];
		},
	}))
);

// =============================================================================
// Selector Hooks (with stable references for React 19 compatibility)
// =============================================================================

export const useActiveSession = (): AgentSession | null => {
	const activeSessionId = useAgentStore((state) => state.activeSessionId);
	const sessions = useAgentStore((state) => state.sessions);
	if (!activeSessionId) return null;
	return sessions.get(activeSessionId) ?? null;
};

export const useActiveSessionId = (): string | null => {
	return useAgentStore((state) => state.activeSessionId);
};

export const useSessionMessages = (sessionId: string | null): Message[] => {
	const messages = useAgentStore((state) => state.messages);
	if (!sessionId) return EMPTY_MESSAGES;
	return messages.get(sessionId) ?? EMPTY_MESSAGES;
};

export const useActiveSessionMessages = (): Message[] => {
	const activeSessionId = useAgentStore((state) => state.activeSessionId);
	const messages = useAgentStore((state) => state.messages);
	if (!activeSessionId) return EMPTY_MESSAGES;
	return messages.get(activeSessionId) ?? EMPTY_MESSAGES;
};

// Per-session streaming selectors
export const useSessionStreamState = (sessionId: string | null): SessionStreamState | null => {
	return useAgentStore((state) => {
		if (!sessionId) return null;
		return state.sessionStreaming.get(sessionId) ?? null;
	});
};

export const useIsSessionStreaming = (sessionId: string | null): boolean => {
	return useAgentStore((state) => {
		if (!sessionId) return false;
		return state.sessionStreaming.get(sessionId)?.isStreaming ?? false;
	});
};

export const useSessionError = (sessionId: string | null): string | null => {
	return useAgentStore((state) => {
		if (!sessionId) return null;
		return state.sessionStreaming.get(sessionId)?.error ?? null;
	});
};

// Legacy selectors — kept for backward compatibility
export const useIsAgentRunning = (): boolean => {
	return useAgentStore((state) => {
		for (const streamState of state.sessionStreaming.values()) {
			if (streamState.isStreaming) return true;
		}
		return false;
	});
};

export const useAgentError = (): string | null => {
	return useAgentStore((state) => {
		if (!state.activeSessionId) return null;
		return state.sessionStreaming.get(state.activeSessionId)?.error ?? null;
	});
};

// Module-level cache for useSessions sorted result (stable reference)
let _sessionsCache: { key: string; result: AgentSession[] } = { key: '', result: EMPTY_SESSIONS };

export const useSessions = (): AgentSession[] => {
	return useAgentStore((state) => {
		if (state.sessions.size === 0) return EMPTY_SESSIONS;

		const entries = Array.from(state.sessions.values());
		const key = entries.map(s => {
			const msgs = state.messages.get(s.id);
			const lastTs = (msgs && msgs.length > 0) ? msgs[msgs.length - 1].timestamp.getTime() : 0;
			return `${s.id}:${s.name || ''}:${s.connectionState}:${lastTs}`;
		}).join(',');

		if (key === _sessionsCache.key) {
			return _sessionsCache.result;
		}

		// Sort by last activity (most recent first)
		const sorted = entries.sort((a, b) => {
			const aMessages = state.messages.get(a.id);
			const bMessages = state.messages.get(b.id);
			const aTime = (aMessages && aMessages.length > 0)
				? aMessages[aMessages.length - 1].timestamp.getTime()
				: a.createdAt.getTime();
			const bTime = (bMessages && bMessages.length > 0)
				? bMessages[bMessages.length - 1].timestamp.getTime()
				: b.createdAt.getTime();
			return bTime - aTime;
		});

		_sessionsCache = { key, result: sorted };
		return sorted;
	});
};

export const usePendingPermissions = (): PermissionRequest[] => {
	const permissions = useAgentStore((state) => state.pendingPermissions);
	if (permissions.size === 0) return EMPTY_PERMISSIONS;
	return Array.from(permissions.values());
};

/** Master-style tool approval selector (maps bridge permissions to PendingApproval shape) */
export const usePendingToolApprovals = (): PermissionRequest[] => {
	return usePendingPermissions();
};

export const useSelectedModel = (): string => {
	return useAgentStore((state) => state.selectedModel);
};

export const usePlanModeActive = (sessionId: string | null): boolean => {
	return useAgentStore((state) => {
		if (!sessionId) return false;
		return state.planModeActive.get(sessionId) ?? false;
	});
};

export const useAcceptModeActive = (sessionId: string | null): boolean => {
	return useAgentStore((state) => {
		if (!sessionId) return false;
		return state.acceptModeActive.get(sessionId) ?? false;
	});
};

/** Find the first pending AskUserQuestion permission for a given session */
export const useActiveAskUserQuestion = (sessionId: string | null): PermissionRequest | null => {
	return useAgentStore((state) => {
		if (!sessionId) return null;
		for (const perm of state.pendingPermissions.values()) {
			if (perm.sessionId === sessionId && perm.toolName.toLowerCase() === 'askuserquestion') {
				return perm;
			}
		}
		return null;
	});
};
