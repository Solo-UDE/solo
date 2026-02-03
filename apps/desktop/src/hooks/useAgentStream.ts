/**
 * Hook for listening to agent streaming events
 *
 * Automatically connects to the Tauri event system and updates the agent store.
 */

import { useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agentStore';
import { listenToAgentEvents, type AgentEventHandlers } from '../lib/tauri/agent';

export interface UseAgentStreamOptions {
	/** Whether to enable the stream listener */
	enabled?: boolean;
}

/**
 * Hook that listens to agent streaming events and updates the store
 *
 * This hook should be used at the top level of your agent UI to ensure
 * all streaming events are captured and the store is updated.
 *
 * @example
 * ```tsx
 * function AgentWindow() {
 *   // This hook automatically updates the agent store with streaming events
 *   useAgentStream({ enabled: true });
 *
 *   const messages = useActiveSessionMessages();
 *   // Messages will automatically update as chunks arrive
 *
 *   return <MessageFeed messages={messages} />;
 * }
 * ```
 */
export function useAgentStream(options: UseAgentStreamOptions = {}): void {
	const { enabled = true } = options;

	// Get store actions (stable references)
	const handleAgentChunk = useAgentStore((state) => state.handleAgentChunk);
	const handleAgentToolStart = useAgentStore((state) => state.handleAgentToolStart);
	const handleAgentToolEnd = useAgentStore((state) => state.handleAgentToolEnd);
	const handleToolApprovalNeeded = useAgentStore((state) => state.handleToolApprovalNeeded);
	const handleAgentComplete = useAgentStore((state) => state.handleAgentComplete);
	const handleAgentError = useAgentStore((state) => state.handleAgentError);

	// Track cleanup function
	const cleanupRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		if (!enabled) {
			// Cleanup existing listener if disabled
			if (cleanupRef.current) {
				cleanupRef.current();
				cleanupRef.current = null;
			}
			return;
		}

		const handlers: AgentEventHandlers = {
			onChunk: handleAgentChunk,
			onToolStart: handleAgentToolStart,
			onToolEnd: handleAgentToolEnd,
			onToolApprovalNeeded: handleToolApprovalNeeded,
			onComplete: handleAgentComplete,
			onError: handleAgentError,
		};

		// Start listening
		listenToAgentEvents(handlers)
			.then((unlisten) => {
				cleanupRef.current = unlisten;
			})
			.catch((error) => {
				console.error('Failed to listen to agent events:', error);
			});

		// Cleanup on unmount
		return () => {
			if (cleanupRef.current) {
				cleanupRef.current();
				cleanupRef.current = null;
			}
		};
	}, [
		enabled,
		handleAgentChunk,
		handleAgentToolStart,
		handleAgentToolEnd,
		handleToolApprovalNeeded,
		handleAgentComplete,
		handleAgentError,
	]);
}

/**
 * Hook that provides both session management and stream listening
 *
 * Combines useAgentSession and useAgentStream for convenience.
 */
export function useAgentSessionWithStream() {
	// Enable stream listening
	useAgentStream({ enabled: true });

	// Return session state
	const activeSessionId = useAgentStore((state) => state.activeSessionId);
	const sessions = useAgentStore((state) => state.sessions);
	const messages = useAgentStore((state) =>
		activeSessionId ? state.messages.get(activeSessionId) || [] : []
	);
	const isRunning = useAgentStore((state) => state.isAgentRunning);
	const error = useAgentStore((state) => state.error);

	const createSession = useAgentStore((state) => state.createSession);
	const sendMessage = useAgentStore((state) => state.sendMessage);
	const clearError = useAgentStore((state) => state.clearError);

	return {
		sessionId: activeSessionId,
		session: activeSessionId ? sessions.get(activeSessionId) : null,
		messages,
		isRunning,
		error,
		createSession,
		sendMessage,
		clearError,
	};
}
