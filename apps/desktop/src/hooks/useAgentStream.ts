/**
 * Singleton agent stream listener
 *
 * Sets up ONE Tauri event listener for all agent streaming events.
 * Dispatches to the agent store's per-session handlers.
 */

import { useAgentStore } from '../stores/agentStore';
import { listenToAgentEvents, type AgentEventHandlers } from '../lib/tauri/agent';

let _initialized = false;
let _cleanup: (() => void) | null = null;

/**
 * Initialize the singleton agent stream listener.
 * Safe to call multiple times — only the first call sets up the listener.
 */
export function initializeAgentStreamListener(): void {
	if (_initialized) return;
	_initialized = true;

	const handlers: AgentEventHandlers = {
		onChunk: (conversationId, content) => {
			useAgentStore.getState().handleAgentChunk(conversationId, content);
		},
		onToolStart: (conversationId, toolCall) => {
			useAgentStore.getState().handleAgentToolStart(conversationId, toolCall);
		},
		onToolEnd: (conversationId, toolCallId, result) => {
			useAgentStore.getState().handleAgentToolEnd(conversationId, toolCallId, result);
		},
		onComplete: (conversationId, message) => {
			useAgentStore.getState().handleAgentComplete(conversationId, message);
		},
		onError: (conversationId, error) => {
			useAgentStore.getState().handleAgentError(conversationId, error);
		},
	};

	listenToAgentEvents(handlers)
		.then((unlisten) => {
			_cleanup = unlisten;
		})
		.catch((error) => {
			console.error('Failed to initialize agent stream listener:', error);
			_initialized = false;
		});
}

/**
 * Teardown the singleton agent stream listener.
 */
export function teardownAgentStreamListener(): void {
	if (_cleanup) {
		_cleanup();
		_cleanup = null;
	}
	_initialized = false;
}
