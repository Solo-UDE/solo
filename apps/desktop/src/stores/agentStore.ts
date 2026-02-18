/**
 * Agent Zustand Store
 * Manages agent sessions, messages, and streaming state
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { AgentMessage, AgentToolCall } from '../bindings';
import * as backend from '../lib/backend';
import {
	loadSessions,
	createDebouncedSessionSave,
} from '../lib/sessionPersistence';
import { DEFAULT_MODEL_ID } from '../lib/constants';
import { useProviderStore } from './provider-store';

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
	status: 'pending' | 'running' | 'completed' | 'error';
	result?: string;
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
	turnNumber?: number;
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

	// Per-session streaming state
	sessionStreaming: Map<string, SessionStreamState>;

	// Model selection
	selectedModel: string;

	// UI state
	isAgentRunning: boolean;
	error: string | null;
}

interface AgentActions {
	// Session management
	createSession: (model?: string) => Promise<string>;
	updateSessionModel: (sessionId: string, model: string) => Promise<void>;
	setActiveSession: (sessionId: string) => void;
	deleteSession: (sessionId: string) => void;
	renameSession: (sessionId: string, name: string) => void;

	// Model selection
	setSelectedModel: (model: string) => void;

	// Message handling
	sendMessage: (sessionId: string, content: string, mode: MessageMode, attachments?: Attachment[], mentions?: FileMention[]) => Promise<void>;
	addUserMessage: (sessionId: string, content: string, mode: MessageMode, attachments?: Attachment[], mentions?: FileMention[]) => string;

	// Streaming handlers (called from event listener)
	handleAgentChunk: (conversationId: string, content: string) => void;
	handleAgentToolStart: (conversationId: string, toolCall: AgentToolCall) => void;
	handleAgentToolEnd: (conversationId: string, toolCallId: string, result: string) => void;
	handleAgentComplete: (conversationId: string, message: AgentMessage) => void;
	handleAgentError: (conversationId: string, error: string) => void;
	handleTurnStart: (conversationId: string, turnNumber: number) => void;
	handleLoopComplete: (conversationId: string, totalTurns: number) => void;
	handleAborted: (conversationId: string, reason: string) => void;

	// Persistence
	loadPersistedSessions: () => void;
	persistSessions: () => void;

	// Abort
	abortSession: (sessionId: string) => Promise<void>;

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
	streamingMessageId: null,
	streamingContent: '',
	activeToolCalls: new Map(),
	sessionStreaming: new Map(),
	selectedModel: DEFAULT_MODEL_ID,
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
						model: model || DEFAULT_MODEL_ID,
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

		updateSessionModel: async (sessionId: string, model: string) => {
			try {
				await backend.updateSessionModel(sessionId, model);
				set((state) => {
					const session = state.sessions.get(sessionId);
					if (session) {
						session.model = model;
					}
				});
			} catch (error) {
				console.error('Failed to update session model:', error);
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

		setSelectedModel: (model: string) => {
			set((state) => {
				state.selectedModel = model;
			});
		},

		sendMessage: async (sessionId: string, content: string, mode: MessageMode, attachments?: Attachment[], mentions?: FileMention[]) => {
			console.log('[Store SEND] sessionId:', sessionId, 'content:', content, 'mode:', mode);
			if (!sessionId) {
				console.error('[Store] No session ID provided!');
				return;
			}

			// Add user message
			get().addUserMessage(sessionId, content, mode, attachments, mentions);

			// Initialize streaming state — the actual assistant placeholder message
			// is created by handleTurnStart() when the backend emits TurnStart.
			set((state) => {
				const streamState = getOrCreateStreamState(state.sessionStreaming, sessionId);
				streamState.isStreaming = true;
				streamState.error = null;
			});

			const selectedModel = useProviderStore.getState().selectedModel || get().selectedModel;

			try {
				console.log('[Store] Calling backend.sendAgentMessageServer sessionId:', sessionId, 'model:', selectedModel, 'mode:', mode);
				await backend.sendAgentMessageServer(sessionId, content, selectedModel, mode);
				console.log('[Store] backend.sendAgentMessageServer returned (streaming should start via events)');
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
			console.log('[Store TOOL_START]', toolCall.name, toolCall.id);
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
			console.log('[Store TOOL_END]', toolCallId, 'resultLen:', result.length);
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

		handleAgentComplete: (conversationId: string, message: AgentMessage) => {
			console.log('[Store COMPLETE] conversationId:', conversationId, 'message:', message);
			set((state) => {
				const streamState = getOrCreateStreamState(state.sessionStreaming, conversationId);

				// Finalize the streaming message text content
				const messages = state.messages.get(conversationId);
				if (messages && streamState.streamingMessageId) {
					const msg = messages.find((m) => m.id === streamState.streamingMessageId);
					if (msg) {
						console.log('[Store] Finalizing message, content length:', message.content.length);
						// Use pre-computed text field, or extract text from ContentBlock[]
						msg.content = message.text
							?? (Array.isArray(message.content)
								? message.content
									.filter((block: { type: string }) => block.type === 'text')
									.map((block: { type: string; text?: string }) => block.text ?? '')
									.join('')
								: String(message.content));
						msg.isStreaming = false;
					}
				}

				// Reset streaming content (text accumulation is done) but keep
				// streamingMessageId alive so tool events can still reference it.
				// Full reset happens in handleLoopComplete.
				streamState.streamingContent = '';
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

				const messages = state.messages.get(conversationId);
				if (messages && streamState.streamingMessageId) {
					// Mark existing streaming message as error
					const msg = messages.find((m) => m.id === streamState.streamingMessageId);
					if (msg) {
						msg.isStreaming = false;
						msg.content = `Error: ${error}`;
					}
				} else if (messages) {
					// No streaming message yet (error before TurnStart) — create one
					messages.push({
						id: `msg-${Date.now()}-error`,
						role: 'assistant',
						content: `Error: ${error}`,
						timestamp: new Date(),
						isStreaming: false,
					});
					state.messages.set(conversationId, messages);
				}

				streamState.streamingMessageId = null;
				streamState.streamingContent = '';
				streamState.activeToolCalls = new Map();
			});
		},

		handleTurnStart: (conversationId: string, turnNumber: number) => {
			console.log('[Store TURN_START] conversationId:', conversationId, 'turn:', turnNumber);
			set((state) => {
				const streamState = getOrCreateStreamState(state.sessionStreaming, conversationId);
				const messages = state.messages.get(conversationId) || [];

				// Create a new assistant placeholder message for this turn
				const newMsgId = `msg-${Date.now()}-assistant-t${turnNumber}`;
				messages.push({
					id: newMsgId,
					role: 'assistant',
					content: '',
					timestamp: new Date(),
					isStreaming: true,
					turnNumber,
				});
				state.messages.set(conversationId, messages);

				streamState.streamingMessageId = newMsgId;
				streamState.streamingContent = '';
				streamState.activeToolCalls = new Map();
				streamState.isStreaming = true;
			});
		},

		handleLoopComplete: (conversationId: string, totalTurns: number) => {
			console.log('[Store LOOP_COMPLETE] conversationId:', conversationId, 'totalTurns:', totalTurns);
			set((state) => {
				const streamState = getOrCreateStreamState(state.sessionStreaming, conversationId);

				// Mark current streaming message as done if still active
				const messages = state.messages.get(conversationId);
				if (messages && streamState.streamingMessageId) {
					const msg = messages.find((m) => m.id === streamState.streamingMessageId);
					if (msg) {
						msg.isStreaming = false;
						// Safety net: mark any still-running tool calls as completed
						if (msg.toolCalls) {
							for (const tc of msg.toolCalls) {
								if (tc.status === 'running' || tc.status === 'pending') {
									tc.status = 'completed';
								}
							}
						}
					}
				}

				// Full reset of streaming state
				streamState.streamingMessageId = null;
				streamState.streamingContent = '';
				streamState.activeToolCalls = new Map();
				streamState.isStreaming = false;
			});

			get().persistSessions();
		},

		handleAborted: (conversationId: string, reason: string) => {
			console.log('[Store ABORTED] conversationId:', conversationId, 'reason:', reason);
			set((state) => {
				const streamState = getOrCreateStreamState(state.sessionStreaming, conversationId);
				streamState.error = `Aborted: ${reason}`;
				streamState.isStreaming = false;
				streamState.streamingMessageId = null;
				streamState.streamingContent = '';
				streamState.activeToolCalls = new Map();
			});
		},

		abortSession: async (sessionId: string) => {
			try {
				await backend.abortAgentSession(sessionId);
			} catch (error) {
				console.error('Failed to abort session:', error);
			}
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

// Legacy selectors
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

export const useSelectedModel = (): string => {
	return useAgentStore((state) => state.selectedModel);
};
