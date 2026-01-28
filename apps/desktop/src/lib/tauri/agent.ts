/**
 * Tauri IPC utilities for agent communication
 *
 * Provides typed wrappers for Tauri events and commands related to the AI agent.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BackendEvent, AgentToolCall, AgentMessage } from '../../bindings';

// =============================================================================
// Event Types
// =============================================================================

export interface AgentEventHandlers {
	onChunk?: (conversationId: string, content: string) => void;
	onToolStart?: (conversationId: string, toolCall: AgentToolCall) => void;
	onToolEnd?: (conversationId: string, toolCallId: string, result: string) => void;
	onComplete?: (conversationId: string, message: AgentMessage) => void;
	onError?: (conversationId: string, error: string) => void;
}

// =============================================================================
// Event Listener
// =============================================================================

/**
 * Listen to agent events from the backend
 *
 * @param handlers - Event handlers for different agent events
 * @returns Cleanup function to stop listening
 *
 * @example
 * ```ts
 * const cleanup = await listenToAgentEvents({
 *   onChunk: (id, content) => console.log('Chunk:', content),
 *   onComplete: (id, msg) => console.log('Complete:', msg),
 *   onError: (id, err) => console.error('Error:', err),
 * });
 *
 * // Later, to cleanup:
 * cleanup();
 * ```
 */
export async function listenToAgentEvents(
	handlers: AgentEventHandlers
): Promise<UnlistenFn> {
	console.log('[Agent] Setting up event listener for backend-event');

	return listen<BackendEvent>('backend-event', (event) => {
		const payload = event.payload;

		// Log ALL raw events for debugging
		console.log('[Agent RAW EVENT]', payload.type, payload);

		switch (payload.type) {
			case 'agent:chunk':
				console.log('[Agent CHUNK]', payload.payload.content);
				handlers.onChunk?.(
					payload.payload.conversation_id,
					payload.payload.content
				);
				break;

			case 'agent:tool_start':
				console.log('[Agent TOOL_START]', payload.payload.tool_call);
				handlers.onToolStart?.(
					payload.payload.conversation_id,
					payload.payload.tool_call
				);
				break;

			case 'agent:tool_end':
				console.log('[Agent TOOL_END]', payload.payload.tool_call_id, payload.payload.result);
				handlers.onToolEnd?.(
					payload.payload.conversation_id,
					payload.payload.tool_call_id,
					payload.payload.result
				);
				break;

			case 'agent:complete':
				console.log('[Agent COMPLETE]', payload.payload.message);
				handlers.onComplete?.(
					payload.payload.conversation_id,
					payload.payload.message
				);
				break;

			case 'agent:error':
				console.log('[Agent ERROR]', payload.payload.error);
				handlers.onError?.(
					payload.payload.conversation_id,
					payload.payload.error
				);
				break;

			default:
				console.log('[Agent UNKNOWN EVENT]', payload);
		}
	});
}

/**
 * Listen to agent events for a specific session
 *
 * @param sessionId - Session ID to filter events for
 * @param handlers - Event handlers
 * @returns Cleanup function
 */
export async function listenToSessionEvents(
	sessionId: string,
	handlers: AgentEventHandlers
): Promise<UnlistenFn> {
	return listenToAgentEvents({
		onChunk: (id, content) => {
			if (id === sessionId) handlers.onChunk?.(id, content);
		},
		onToolStart: (id, toolCall) => {
			if (id === sessionId) handlers.onToolStart?.(id, toolCall);
		},
		onToolEnd: (id, toolCallId, result) => {
			if (id === sessionId) handlers.onToolEnd?.(id, toolCallId, result);
		},
		onComplete: (id, message) => {
			if (id === sessionId) handlers.onComplete?.(id, message);
		},
		onError: (id, error) => {
			if (id === sessionId) handlers.onError?.(id, error);
		},
	});
}
