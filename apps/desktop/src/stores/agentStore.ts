/**
 * Agent Zustand Store
 * Manages agent sessions, messages, and streaming state
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { AgentMessage, AgentToolCall, ToolCallWithStatus } from '../bindings';
import * as backend from '../lib/backend';
import {
	loadSessions,
	createDebouncedSessionSave,
} from '../lib/sessionPersistence';

// Enable Map and Set support in Immer
enableMapSet();

// =============================================================================
// Stable Reference Constants (for React 19 compatibility)
// =============================================================================

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_SESSIONS: AgentSession[] = [];

// =============================================================================
// Types
// =============================================================================

export type MessageMode = 'planning' | 'fast';

export interface ToolCallState {
	id: string;
	name: string;
	arguments: string;
	status: 'pending' | 'pending_approval' | 'running' | 'completed' | 'error';
	result?: string;
	needsApproval?: boolean;
}

export interface FileMention {
	path: string;
	name: string;
	relativePath: string;
}

export interface Attachment {
	id: string;
	type: 'file' | 'image';
	path: string;
	name: string;
	mimeType?: string;
	thumbnailUrl?: string;
	size?: number;
}

export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
	mode?: MessageMode;
	toolCalls?: ToolCallState[];
	isStreaming?: boolean;
	attachments?: Attachment[];
	mentions?: FileMention[];
}

export interface AgentSession {
	id: string;
	createdAt: Date;
	model: string;
	name?: string;
}

export interface SessionStreamState {
	streamingMessageId: string | null;
	streamingContent: string;
	activeToolCalls: Map<string, ToolCallState>;
	isStreaming: boolean;
	error: string | null;
}

// =============================================================================
// Helpers
// =============================================================================

function createDefaultStreamState(): SessionStreamState {
	return {
		streamingMessageId: null,
		streamingContent: '',
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

	// Streaming state
	streamingMessageId: string | null;
	streamingContent: string;
	activeToolCalls: Map<string, ToolCallState>;

	// Tool approval state
	pendingToolApprovals: Map<string, ToolCallWithStatus>;

	// Per-session streaming state
	sessionStreaming: Map<string, SessionStreamState>;

	// UI state
	isAgentRunning: boolean;
	error: string | null;
}

interface AgentActions {
	// Session management
	createSession: (model?: string) => Promise<string>;
	setActiveSession: (sessionId: string) => void;
	deleteSession: (sessionId: string) => void;
	renameSession: (sessionId: string, name: string) => void;

	// Message handling
	sendMessage: (sessionId: string, content: string, mode: MessageMode, attachments?: Attachment[], mentions?: FileMention[]) => Promise<void>;
	addUserMessage: (sessionId: string, content: string, mode: MessageMode, attachments?: Attachment[], mentions?: FileMention[]) => string;

	// Streaming handlers (called from event listener)
	handleAgentChunk: (conversationId: string, content: string) => void;
	handleAgentToolStart: (conversationId: string, toolCall: AgentToolCall) => void;
	handleAgentToolEnd: (conversationId: string, toolCallId: string, result: string) => void;
	handleToolApprovalNeeded: (conversationId: string, toolCall: ToolCallWithStatus) => void;
	resolveToolApproval: (toolCallId: string, approved: boolean) => void;
	handleAgentComplete: (conversationId: string, message: AgentMessage) => void;
	handleAgentError: (conversationId: string, error: string) => void;

	// Persistence
	loadPersistedSessions: () => void;
	persistSessions: () => void;

	// Utilities
	clearError: (sessionId: string) => void;
	getSessionMessages: (sessionId: string) => Message[];
}

type AgentStore = AgentState & AgentActions;

// =============================================================================
// Initial State
// =============================================================================

const EMPTY_APPROVALS: ToolCallWithStatus[] = [];

const initialState: AgentState = {
	sessions: new Map(),
	activeSessionId: null,
	messages: new Map(),
	streamingMessageId: null,
	streamingContent: '',
	activeToolCalls: new Map(),
	pendingToolApprovals: new Map(),
	sessionStreaming: new Map(),
	isAgentRunning: false,
	error: null,
};

// Create debounced save function (saves 1 second after last change)
const debouncedSave = createDebouncedSessionSave(1000);

// =============================================================================
// Store
// =============================================================================

export const useAgentStore = create<AgentStore>()(
	immer((set, get) => ({
		...initialState,

		loadPersistedSessions: () => {
			const persisted = loadSessions();
			if (persisted) {
				set((state) => {
					state.sessions = persisted.sessions;
					state.messages = persisted.messages;
					// Initialize empty streaming state for each loaded session
					for (const sessionId of persisted.sessions.keys()) {
						if (!state.sessionStreaming.has(sessionId)) {
							state.sessionStreaming.set(sessionId, createDefaultStreamState());
						}
					}
				});
			}
		},

		persistSessions: () => {
			const state = get();
			debouncedSave.save(state.sessions, state.messages);
		},

		createSession: async (model?: string) => {
			try {
				const sessionId = await backend.createAgentSession(model);

				set((state) => {
					state.sessions.set(sessionId, {
						id: sessionId,
						createdAt: new Date(),
						model: model || 'claude-sonnet-4-20250514',
					});
					state.messages.set(sessionId, []);
					state.sessionStreaming.set(sessionId, createDefaultStreamState());
				});

				// Persist after creating session
				get().persistSessions();

				return sessionId;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.error(`Failed to create session: ${errorMsg}`);
				throw error;
			}
		},

		setActiveSession: (sessionId: string) => {
			set((state) => {
				if (state.sessions.has(sessionId)) {
					state.activeSessionId = sessionId;
				}
			});
		},

		deleteSession: (sessionId: string) => {
			set((state) => {
				state.sessions.delete(sessionId);
				state.messages.delete(sessionId);
				state.sessionStreaming.delete(sessionId);
				if (state.activeSessionId === sessionId) {
					const remaining = Array.from(state.sessions.keys());
					state.activeSessionId = remaining.length > 0 ? remaining[0] : null;
				}
			});
			// Persist after deletion
			get().persistSessions();
		},

		renameSession: (sessionId: string, name: string) => {
			set((state) => {
				const session = state.sessions.get(sessionId);
				if (session) {
					const trimmed = name.trim();
					session.name = trimmed || undefined;
				}
			});
			get().persistSessions();
		},

		sendMessage: async (sessionId: string, content: string, mode: MessageMode, attachments?: Attachment[], mentions?: FileMention[]) => {
			console.log('[Store SEND] sessionId:', sessionId, 'content:', content, 'mode:', mode);
			if (!sessionId) {
				console.error('[Store] No session ID provided!');
				return;
			}

			// Add user message
			get().addUserMessage(sessionId, content, mode, attachments, mentions);

			// Create placeholder for assistant response
			const assistantMessageId = `msg-${Date.now()}-assistant`;
			console.log('[Store] Created assistant placeholder:', assistantMessageId);

			set((state) => {
				const sessionMessages = state.messages.get(sessionId) || [];
				sessionMessages.push({
					id: assistantMessageId,
					role: 'assistant',
					content: '',
					timestamp: new Date(),
					isStreaming: true,
				});
				state.messages.set(sessionId, sessionMessages);

				// Update per-session streaming state
				const streamState = getOrCreateStreamState(state.sessionStreaming, sessionId);
				streamState.streamingMessageId = assistantMessageId;
				streamState.streamingContent = '';
				streamState.isStreaming = true;
				streamState.error = null;
			});

			try {
				// Build system prompt based on mode
				const systemPrompt = mode === 'planning'
					? 'You are a thoughtful assistant. Take your time to think through problems step by step before providing solutions.'
					: undefined;

				console.log('[Store] Calling backend.sendAgentMessage sessionId:', sessionId, 'systemPrompt:', systemPrompt);
				await backend.sendAgentMessage(sessionId, content, systemPrompt);
				console.log('[Store] backend.sendAgentMessage returned (streaming should start via events)');
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.error('[Store] sendAgentMessage failed:', errorMsg);
				set((state) => {
					const streamState = getOrCreateStreamState(state.sessionStreaming, sessionId);
					streamState.error = `Failed to send message: ${errorMsg}`;
					streamState.isStreaming = false;
					streamState.streamingMessageId = null;
				});
			}
		},

		addUserMessage: (sessionId: string, content: string, mode: MessageMode, attachments?: Attachment[], mentions?: FileMention[]) => {
			const messageId = `msg-${Date.now()}-user`;

			set((state) => {
				const sessionMessages = state.messages.get(sessionId) || [];
				sessionMessages.push({
					id: messageId,
					role: 'user',
					content,
					timestamp: new Date(),
					mode,
					attachments: attachments?.length ? attachments : undefined,
					mentions: mentions?.length ? mentions : undefined,
				});
				state.messages.set(sessionId, sessionMessages);
			});

			// Persist after adding user message (for title generation)
			get().persistSessions();

			return messageId;
		},

		handleAgentChunk: (conversationId: string, content: string) => {
			console.log('[Store CHUNK] conversationId:', conversationId, 'content:', content);
			set((state) => {
				const streamState = getOrCreateStreamState(state.sessionStreaming, conversationId);
				streamState.streamingContent += content;
				console.log('[Store] streamingContent now:', streamState.streamingContent.length, 'chars');

				// Update the streaming message
				const messages = state.messages.get(conversationId);
				if (messages && streamState.streamingMessageId) {
					const msg = messages.find((m) => m.id === streamState.streamingMessageId);
					if (msg) {
						msg.content = streamState.streamingContent;
						console.log('[Store] Updated message content');
					} else {
						console.warn('[Store] Could not find streaming message:', streamState.streamingMessageId);
					}
				} else {
					console.warn('[Store] No messages for conversationId:', conversationId, 'or no streamingMessageId:', streamState.streamingMessageId);
				}
			});
		},

		handleAgentToolStart: (conversationId: string, toolCall: AgentToolCall) => {
			set((state) => {
				const streamState = getOrCreateStreamState(state.sessionStreaming, conversationId);
				streamState.activeToolCalls.set(toolCall.id, {
					id: toolCall.id,
					name: toolCall.name,
					arguments: toolCall.arguments,
					status: 'running',
				});

				// Add tool call to streaming message
				const messages = state.messages.get(conversationId);
				if (messages && streamState.streamingMessageId) {
					const msg = messages.find((m) => m.id === streamState.streamingMessageId);
					if (msg) {
						if (!msg.toolCalls) msg.toolCalls = [];
						msg.toolCalls.push({
							id: toolCall.id,
							name: toolCall.name,
							arguments: toolCall.arguments,
							status: 'running',
						});
					}
				}
			});
		},

		handleAgentToolEnd: (conversationId: string, toolCallId: string, result: string) => {
			set((state) => {
				const streamState = getOrCreateStreamState(state.sessionStreaming, conversationId);
				const toolCall = streamState.activeToolCalls.get(toolCallId);
				if (toolCall) {
					toolCall.status = 'completed';
					toolCall.result = result;
				}

				// Update tool call in message
				const messages = state.messages.get(conversationId);
				if (messages && streamState.streamingMessageId) {
					const msg = messages.find((m) => m.id === streamState.streamingMessageId);
					if (msg?.toolCalls) {
						const tc = msg.toolCalls.find((t) => t.id === toolCallId);
						if (tc) {
							tc.status = 'completed';
							tc.result = result;
						}
					}
				}
			});
		},

		handleToolApprovalNeeded: (conversationId: string, toolCall: ToolCallWithStatus) => {
			set((state) => {
				// Track in pending approvals map
				state.pendingToolApprovals.set(toolCall.tool_call.id, toolCall);

				// Also add to the streaming message's tool calls as pending_approval
				const messages = state.messages.get(conversationId);
				if (messages && state.streamingMessageId) {
					const msg = messages.find((m) => m.id === state.streamingMessageId);
					if (msg) {
						if (!msg.toolCalls) msg.toolCalls = [];
						msg.toolCalls.push({
							id: toolCall.tool_call.id,
							name: toolCall.tool_call.name,
							arguments: toolCall.tool_call.arguments,
							status: 'pending_approval',
							needsApproval: true,
						});
					}
				}
			});
		},

		resolveToolApproval: (toolCallId: string, approved: boolean) => {
			set((state) => {
				state.pendingToolApprovals.delete(toolCallId);

				// Update tool call status in all session messages
				for (const [, sessionMessages] of state.messages) {
					for (const msg of sessionMessages) {
						if (msg.toolCalls) {
							const tc = msg.toolCalls.find((t) => t.id === toolCallId);
							if (tc) {
								tc.status = approved ? 'running' : 'error';
								if (!approved) {
									tc.result = 'Rejected by user';
								}
							}
						}
					}
				}
			});
		},

		handleAgentComplete: (conversationId: string, message: AgentMessage) => {
			console.log('[Store COMPLETE] conversationId:', conversationId, 'message:', message);
			set((state) => {
				const streamState = getOrCreateStreamState(state.sessionStreaming, conversationId);

				// Finalize the streaming message
				const messages = state.messages.get(conversationId);
				if (messages && streamState.streamingMessageId) {
					const msg = messages.find((m) => m.id === streamState.streamingMessageId);
					if (msg) {
						console.log('[Store] Finalizing message, content length:', message.content.length);
						msg.content = message.content;
						msg.isStreaming = false;
						if (message.tool_calls) {
							msg.toolCalls = message.tool_calls.map((tc: AgentToolCall) => ({
								id: tc.id,
								name: tc.name,
								arguments: tc.arguments,
								status: 'completed' as const,
								result: streamState.activeToolCalls.get(tc.id)?.result,
							}));
						}
					}
				}

				// Reset per-session streaming state
				streamState.streamingMessageId = null;
				streamState.streamingContent = '';
				streamState.activeToolCalls = new Map();
				streamState.isStreaming = false;
			});

			// Persist after message completion
			get().persistSessions();
		},

		handleAgentError: (conversationId: string, error: string) => {
			console.error('[Store ERROR] conversationId:', conversationId, 'error:', error);
			set((state) => {
				const streamState = getOrCreateStreamState(state.sessionStreaming, conversationId);
				streamState.error = error;
				streamState.isStreaming = false;

				// Mark streaming message as error
				const messages = state.messages.get(conversationId);
				if (messages && streamState.streamingMessageId) {
					const msg = messages.find((m) => m.id === streamState.streamingMessageId);
					if (msg) {
						msg.isStreaming = false;
						msg.content = `Error: ${error}`;
					}
				}

				streamState.streamingMessageId = null;
				streamState.streamingContent = '';
				streamState.activeToolCalls = new Map();
			});
		},

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

// Legacy selectors — kept for backward compatibility but delegate to per-session state
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

		// Build a key from session ids + names + last message timestamps to detect changes
		const entries = Array.from(state.sessions.values());
		const key = entries.map(s => {
			const msgs = state.messages.get(s.id);
			const lastTs = (msgs && msgs.length > 0) ? msgs[msgs.length - 1].timestamp.getTime() : 0;
			return `${s.id}:${s.name || ''}:${lastTs}`;
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

export const usePendingToolApprovals = (): ToolCallWithStatus[] => {
	const approvals = useAgentStore((state) => state.pendingToolApprovals);
	if (approvals.size === 0) return EMPTY_APPROVALS;
	return Array.from(approvals.values());
};
