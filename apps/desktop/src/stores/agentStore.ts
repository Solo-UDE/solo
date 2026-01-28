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

export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
	mode?: MessageMode;
	toolCalls?: ToolCallState[];
	isStreaming?: boolean;
}

export interface AgentSession {
	id: string;
	createdAt: Date;
	model: string;
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

	// UI state
	isAgentRunning: boolean;
	error: string | null;
}

interface AgentActions {
	// Session management
	createSession: (model?: string) => Promise<string>;
	setActiveSession: (sessionId: string) => void;
	deleteSession: (sessionId: string) => void;

	// Message handling
	sendMessage: (content: string, mode: MessageMode) => Promise<void>;
	addUserMessage: (sessionId: string, content: string, mode: MessageMode) => string;

	// Streaming handlers (called from event listener)
	handleAgentChunk: (conversationId: string, content: string) => void;
	handleAgentToolStart: (conversationId: string, toolCall: AgentToolCall) => void;
	handleAgentToolEnd: (conversationId: string, toolCallId: string, result: string) => void;
	handleAgentComplete: (conversationId: string, message: AgentMessage) => void;
	handleAgentError: (conversationId: string, error: string) => void;

	// Persistence
	loadPersistedSessions: () => void;
	persistSessions: () => void;

	// Utilities
	clearError: () => void;
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
					state.activeSessionId = sessionId;
				});

				// Persist after creating session
				get().persistSessions();

				return sessionId;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				set((state) => {
					state.error = `Failed to create session: ${errorMsg}`;
				});
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
				if (state.activeSessionId === sessionId) {
					// Switch to another session or null
					const remaining = Array.from(state.sessions.keys());
					state.activeSessionId = remaining.length > 0 ? remaining[0] : null;
				}
			});
			// Persist after deletion
			get().persistSessions();
		},

		sendMessage: async (content: string, mode: MessageMode) => {
			console.log('[Store SEND] content:', content, 'mode:', mode);
			const sessionId = get().activeSessionId;
			if (!sessionId) {
				console.error('[Store] No active session!');
				set((state) => {
					state.error = 'No active session';
				});
				return;
			}
			console.log('[Store] Active sessionId:', sessionId);

			// Add user message
			get().addUserMessage(sessionId, content, mode);

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
				state.streamingMessageId = assistantMessageId;
				state.streamingContent = '';
				state.isAgentRunning = true;
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
					state.error = `Failed to send message: ${errorMsg}`;
					state.isAgentRunning = false;
					state.streamingMessageId = null;
				});
			}
		},

		addUserMessage: (sessionId: string, content: string, mode: MessageMode) => {
			const messageId = `msg-${Date.now()}-user`;

			set((state) => {
				const sessionMessages = state.messages.get(sessionId) || [];
				sessionMessages.push({
					id: messageId,
					role: 'user',
					content,
					timestamp: new Date(),
					mode,
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
				state.streamingContent += content;
				console.log('[Store] streamingContent now:', state.streamingContent.length, 'chars');

				// Update the streaming message
				const messages = state.messages.get(conversationId);
				if (messages && state.streamingMessageId) {
					const msg = messages.find((m) => m.id === state.streamingMessageId);
					if (msg) {
						msg.content = state.streamingContent;
						console.log('[Store] Updated message content');
					} else {
						console.warn('[Store] Could not find streaming message:', state.streamingMessageId);
					}
				} else {
					console.warn('[Store] No messages for conversationId:', conversationId, 'or no streamingMessageId:', state.streamingMessageId);
				}
			});
		},

		handleAgentToolStart: (conversationId: string, toolCall: AgentToolCall) => {
			set((state) => {
				state.activeToolCalls.set(toolCall.id, {
					id: toolCall.id,
					name: toolCall.name,
					arguments: toolCall.arguments,
					status: 'running',
				});

				// Add tool call to streaming message
				const messages = state.messages.get(conversationId);
				if (messages && state.streamingMessageId) {
					const msg = messages.find((m) => m.id === state.streamingMessageId);
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
				const toolCall = state.activeToolCalls.get(toolCallId);
				if (toolCall) {
					toolCall.status = 'completed';
					toolCall.result = result;
				}

				// Update tool call in message
				const messages = state.messages.get(conversationId);
				if (messages && state.streamingMessageId) {
					const msg = messages.find((m) => m.id === state.streamingMessageId);
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
				// Finalize the streaming message
				const messages = state.messages.get(conversationId);
				if (messages && state.streamingMessageId) {
					const msg = messages.find((m) => m.id === state.streamingMessageId);
					if (msg) {
						console.log('[Store] Finalizing message, content length:', message.content.length);
						msg.content = message.content;
						msg.isStreaming = false;
						if (message.tool_calls) {
							msg.toolCalls = message.tool_calls.map((tc) => ({
								id: tc.id,
								name: tc.name,
								arguments: tc.arguments,
								status: 'completed' as const,
								result: state.activeToolCalls.get(tc.id)?.result,
							}));
						}
					}
				}

				// Reset streaming state
				state.streamingMessageId = null;
				state.streamingContent = '';
				state.activeToolCalls = new Map();
				state.isAgentRunning = false;
			});

			// Persist after message completion
			get().persistSessions();
		},

		handleAgentError: (conversationId: string, error: string) => {
			console.error('[Store ERROR] conversationId:', conversationId, 'error:', error);
			set((state) => {
				state.error = error;
				state.isAgentRunning = false;
				state.streamingMessageId = null;
				state.streamingContent = '';
				state.activeToolCalls = new Map();

				// Mark streaming message as error
				const messages = state.messages.get(conversationId);
				if (messages && state.streamingMessageId) {
					const msg = messages.find((m) => m.id === state.streamingMessageId);
					if (msg) {
						msg.isStreaming = false;
						msg.content = `Error: ${error}`;
					}
				}
			});
		},

		clearError: () => {
			set((state) => {
				state.error = null;
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

// To avoid infinite loops in React 19's useSyncExternalStore, we use stable
// references and memoize results at the store level instead of in selectors.

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

export const useIsAgentRunning = (): boolean => {
	return useAgentStore((state) => state.isAgentRunning);
};

export const useAgentError = (): string | null => {
	return useAgentStore((state) => state.error);
};

export const useSessions = (): AgentSession[] => {
	const sessions = useAgentStore((state) => state.sessions);
	if (sessions.size === 0) return EMPTY_SESSIONS;
	return Array.from(sessions.values());
};
