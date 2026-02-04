/**
 * Tauri IPC utilities for agent communication
 *
 * Provides typed wrappers for Tauri events and commands related to the AI agent.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BackendEvent, AgentToolCall, AgentMessage, ToolCallWithStatus } from '../../bindings';

// =============================================================================
// Event Types
// =============================================================================

export interface AgentEventHandlers {
	onChunk?: (conversationId: string, content: string) => void;
	onToolStart?: (conversationId: string, toolCall: AgentToolCall) => void;
	onToolEnd?: (conversationId: string, toolCallId: string, result: string) => void;
	onToolApprovalNeeded?: (conversationId: string, toolCall: ToolCallWithStatus) => void;
	onComplete?: (conversationId: string, message: AgentMessage) => void;
	onError?: (conversationId: string, error: string) => void;
	onTurnStart?: (conversationId: string, turnNumber: number) => void;
	onLoopComplete?: (conversationId: string, totalTurns: number) => void;
	onAborted?: (conversationId: string, reason: string) => void;
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
	return listen<BackendEvent>('agent-event', (event) => {
		const payload = event.payload;

		switch (payload.type) {
			case 'agent:chunk':
				handlers.onChunk?.(
					payload.payload.conversation_id,
					payload.payload.content
				);
				break;

			case 'agent:tool_start':
				handlers.onToolStart?.(
					payload.payload.conversation_id,
					payload.payload.tool_call
				);
				break;

			case 'agent:tool_end':
				handlers.onToolEnd?.(
					payload.payload.conversation_id,
					payload.payload.tool_call_id,
					payload.payload.result
				);
				break;

			case 'agent:tool_approval_needed':
				handlers.onToolApprovalNeeded?.(
					payload.payload.conversation_id,
					payload.payload.tool_call
				);
				break;

			case 'agent:complete':
				handlers.onComplete?.(
					payload.payload.conversation_id,
					payload.payload.message
				);
				break;

			case 'agent:error':
				handlers.onError?.(
					payload.payload.conversation_id,
					payload.payload.error
				);
				break;

			case 'agent:turn_start':
				handlers.onTurnStart?.(
					payload.payload.conversation_id,
					payload.payload.turn_number
				);
				break;

			case 'agent:loop_complete':
				handlers.onLoopComplete?.(
					payload.payload.conversation_id,
					payload.payload.total_turns
				);
				break;

			case 'agent:aborted':
				handlers.onAborted?.(
					payload.payload.conversation_id,
					payload.payload.reason
				);
				break;
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
		onToolApprovalNeeded: (id, toolCall) => {
			if (id === sessionId) handlers.onToolApprovalNeeded?.(id, toolCall);
		},
		onComplete: (id, message) => {
			if (id === sessionId) handlers.onComplete?.(id, message);
		},
		onError: (id, error) => {
			if (id === sessionId) handlers.onError?.(id, error);
		},
		onTurnStart: (id, turnNumber) => {
			if (id === sessionId) handlers.onTurnStart?.(id, turnNumber);
		},
		onLoopComplete: (id, totalTurns) => {
			if (id === sessionId) handlers.onLoopComplete?.(id, totalTurns);
		},
		onAborted: (id, reason) => {
			if (id === sessionId) handlers.onAborted?.(id, reason);
		},
	});
}
