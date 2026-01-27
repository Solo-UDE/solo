/**
 * Agent Zustand Store
 * Manages agent sessions, messages, and streaming state
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { AgentMessage, AgentToolCall } from '../bindings';
import * as backend from '../lib/backend';

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

	// Message handling
	sendMessage: (content: string, mode: MessageMode) => Promise<void>;
	addUserMessage: (sessionId: string, content: string, mode: MessageMode) => string;

	// Streaming handlers (called from event listener)
	handleAgentChunk: (conversationId: string, content: string) => void;
	handleAgentToolStart: (conversationId: string, toolCall: AgentToolCall) => void;
	handleAgentToolEnd: (conversationId: string, toolCallId: string, result: string) => void;
	handleAgentComplete: (conversationId: string, message: AgentMessage) => void;
	handleAgentError: (conversationId: string, error: string) => void;

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

// =============================================================================
// Store
// =============================================================================

export const useAgentStore = create<AgentStore>()(
	immer((set, get) => ({
		...initialState,

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

		sendMessage: async (content: string, mode: MessageMode) => {
			const sessionId = get().activeSessionId;
			if (!sessionId) {
				set((state) => {
					state.error = 'No active session';
				});
				return;
			}

			// Add user message
			get().addUserMessage(sessionId, content, mode);

			// Create placeholder for assistant response
			const assistantMessageId = `msg-${Date.now()}-assistant`;

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

				await backend.sendAgentMessage(sessionId, content, systemPrompt);
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
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

			return messageId;
		},

		handleAgentChunk: (conversationId: string, content: string) => {
			set((state) => {
				state.streamingContent += content;

				// Update the streaming message
				const messages = state.messages.get(conversationId);
				if (messages && state.streamingMessageId) {
					const msg = messages.find((m) => m.id === state.streamingMessageId);
					if (msg) {
						msg.content = state.streamingContent;
					}
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
			set((state) => {
				// Finalize the streaming message
				const messages = state.messages.get(conversationId);
				if (messages && state.streamingMessageId) {
					const msg = messages.find((m) => m.id === state.streamingMessageId);
					if (msg) {
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
		},

		handleAgentError: (conversationId: string, error: string) => {
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
