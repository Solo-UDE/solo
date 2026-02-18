/**
 * Custom Tauri Transport for AI SDK useChat
 *
 * Bridges AI SDK's useChat hook with the Rust backend,
 * keeping API keys secure in the backend while using
 * AI SDK's excellent UI state management.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { BackendEvent, AgentMessage, AgentToolCall, ContentBlock } from '../../bindings';

// =============================================================================
// Types
// =============================================================================

export interface TauriChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	toolCalls?: AgentToolCall[];
	createdAt?: Date;
}

export interface TauriChatRequest {
	sessionId: string;
	content: string;
	systemPrompt?: string;
}

export interface StreamCallbacks {
	onChunk?: (content: string) => void;
	onToolStart?: (toolCall: AgentToolCall) => void;
	onToolEnd?: (toolCallId: string, result: string) => void;
	onComplete?: (message: AgentMessage) => void;
	onError?: (error: string) => void;
}

// =============================================================================
// Tauri Chat Transport
// =============================================================================

/**
 * Creates a transport that bridges useChat with Tauri backend
 *
 * @example
 * ```typescript
 * const transport = createTauriChatTransport(sessionId);
 *
 * const { messages, input, handleSubmit, status } = useChat({
 *   // Use custom fetch that goes through Tauri
 *   fetch: transport.fetch,
 *   onFinish: transport.onFinish,
 * });
 * ```
 */
export function createTauriChatTransport(sessionId: string) {
	let unlisten: UnlistenFn | null = null;
	let currentCallbacks: StreamCallbacks = {};

	/**
	 * Set up event listeners for streaming responses
	 */
	async function setupListeners(callbacks: StreamCallbacks): Promise<void> {
		// Clean up any existing listener
		if (unlisten) {
			unlisten();
		}

		currentCallbacks = callbacks;

		unlisten = await listen<BackendEvent>('agent-event', (event) => {
			const payload = event.payload;

			switch (payload.type) {
				case 'agent:chunk':
					if (payload.payload.conversation_id === sessionId) {
						currentCallbacks.onChunk?.(payload.payload.content);
					}
					break;

				case 'agent:tool_start':
					if (payload.payload.conversation_id === sessionId) {
						currentCallbacks.onToolStart?.(payload.payload.tool_call);
					}
					break;

				case 'agent:tool_end':
					if (payload.payload.conversation_id === sessionId) {
						currentCallbacks.onToolEnd?.(
							payload.payload.tool_call_id,
							payload.payload.result
						);
					}
					break;

				case 'agent:complete':
					if (payload.payload.conversation_id === sessionId) {
						currentCallbacks.onComplete?.(payload.payload.message);
					}
					break;

				case 'agent:error':
					if (payload.payload.conversation_id === sessionId) {
						currentCallbacks.onError?.(payload.payload.error);
					}
					break;
			}
		});
	}

	/**
	 * Send a message through the Tauri backend
	 */
	async function sendMessage(
		content: string,
		systemPrompt?: string,
		callbacks?: StreamCallbacks
	): Promise<void> {
		if (callbacks) {
			await setupListeners(callbacks);
		}

		await invoke('agent_send_message_server', {
			sessionId,
			content,
			systemPrompt,
		});
	}

	/**
	 * Clean up listeners
	 */
	function cleanup(): void {
		if (unlisten) {
			unlisten();
			unlisten = null;
		}
	}

	return {
		sendMessage,
		setupListeners,
		cleanup,
		sessionId,
	};
}

// =============================================================================
// AI SDK Compatible Chat Adapter
// =============================================================================

export interface ChatAdapterOptions {
	sessionId: string;
	systemPrompt?: string;
	onMessage?: (message: TauriChatMessage) => void;
	onError?: (error: Error) => void;
}

/**
 * Creates an adapter for managing chat state compatible with AI SDK patterns
 *
 * This provides a similar interface to useChat but routes through Tauri.
 */
export function createChatAdapter(options: ChatAdapterOptions) {
	const { sessionId, systemPrompt, onMessage, onError } = options;
	const transport = createTauriChatTransport(sessionId);

	let messages: TauriChatMessage[] = [];
	let isLoading = false;
	let currentAssistantMessage: TauriChatMessage | null = null;

	/**
	 * Append a message to the chat
	 */
	async function append(content: string): Promise<void> {
		// Add user message
		const userMessage: TauriChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content,
			createdAt: new Date(),
		};
		messages = [...messages, userMessage];
		onMessage?.(userMessage);

		// Create placeholder assistant message
		currentAssistantMessage = {
			id: crypto.randomUUID(),
			role: 'assistant',
			content: '',
			createdAt: new Date(),
		};
		messages = [...messages, currentAssistantMessage];
		isLoading = true;

		try {
			await transport.sendMessage(content, systemPrompt, {
				onChunk: (chunk) => {
					if (currentAssistantMessage) {
						currentAssistantMessage.content += chunk;
						onMessage?.(currentAssistantMessage);
					}
				},
				onToolStart: (toolCall) => {
					if (currentAssistantMessage) {
						currentAssistantMessage.toolCalls = [
							...(currentAssistantMessage.toolCalls || []),
							toolCall,
						];
						onMessage?.(currentAssistantMessage);
					}
				},
				onComplete: (message) => {
					if (currentAssistantMessage) {
						currentAssistantMessage.content = message.text ?? '';
						const toolUseBlocks = message.content
							.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
							.map(b => ({ id: b.id, name: b.name, arguments: b.arguments }));
						if (toolUseBlocks.length > 0) {
							currentAssistantMessage.toolCalls = toolUseBlocks;
						}
						onMessage?.(currentAssistantMessage);
					}
					isLoading = false;
					currentAssistantMessage = null;
				},
				onError: (error) => {
					isLoading = false;
					currentAssistantMessage = null;
					onError?.(new Error(error));
				},
			});
		} catch (err) {
			isLoading = false;
			currentAssistantMessage = null;
			onError?.(err instanceof Error ? err : new Error(String(err)));
		}
	}

	/**
	 * Stop the current generation (not yet implemented in backend)
	 */
	function stop(): void {
		// TODO: Implement abort in Rust backend
		console.warn('Stop not yet implemented');
	}

	/**
	 * Set messages directly
	 */
	function setMessages(newMessages: TauriChatMessage[]): void {
		messages = newMessages;
	}

	/**
	 * Clear all messages
	 */
	function clearMessages(): void {
		messages = [];
	}

	/**
	 * Cleanup resources
	 */
	function cleanup(): void {
		transport.cleanup();
	}

	return {
		get messages() {
			return messages;
		},
		get isLoading() {
			return isLoading;
		},
		append,
		stop,
		setMessages,
		clearMessages,
		cleanup,
	};
}

// =============================================================================
// React Hook Compatible Interface
// =============================================================================

export interface UseTauriChatOptions {
	sessionId: string;
	systemPrompt?: string;
	initialMessages?: TauriChatMessage[];
}

/**
 * Creates a chat interface compatible with React's useState/useEffect patterns
 *
 * @example
 * ```typescript
 * // In a React component
 * const [chatState, setChatState] = useState(() =>
 *   createTauriChatState({ sessionId })
 * );
 *
 * // Or use with the useTauriChat hook (defined in hooks/)
 * ```
 */
export function createTauriChatState(options: UseTauriChatOptions) {
	const { sessionId, systemPrompt, initialMessages = [] } = options;

	return {
		sessionId,
		systemPrompt,
		messages: initialMessages,
		isLoading: false,
		error: null as Error | null,
	};
}

export type TauriChatState = ReturnType<typeof createTauriChatState>;
