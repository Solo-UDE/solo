/**
 * Singleton agent stream listener
 *
 * Sets up ONE Tauri event listener for all agent streaming events.
 * Dispatches to the agent store's per-session handlers.
 */

import { useEffect } from 'react';
import { useAgentStore } from '../stores/agentStore';
import { listenToAgentEvents, type AgentEventHandlers } from '../lib/tauri/agent';

interface UseAgentStreamOptions {
	enabled?: boolean;
}

/**
 * Hook that sets up a singleton agent stream listener.
 * Manages its own lifecycle via useEffect — call at the top level of a component.
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

	useEffect(() => {
		if (!enabled) {
			return;
		}

		// Track whether this effect instance has been cleaned up.
		// This handles the React.StrictMode async cleanup race where
		// cleanup runs before the async listenToAgentEvents resolves.
		let cancelled = false;
		let unlistenFn: (() => void) | null = null;

		const handlers: AgentEventHandlers = {
			onChunk: handleAgentChunk,
			onToolStart: handleAgentToolStart,
			onToolEnd: handleAgentToolEnd,
			onToolApprovalNeeded: handleToolApprovalNeeded,
			onComplete: handleAgentComplete,
			onError: handleAgentError,
		};

		listenToAgentEvents(handlers)
			.then((unlisten) => {
				if (cancelled) {
					// Effect was cleaned up before the listener resolved —
					// immediately unlisten to avoid a dangling listener.
					unlisten();
				} else {
					unlistenFn = unlisten;
				}
			})
			.catch((error) => {
				console.error('Failed to listen to agent events:', error);
			});

		return () => {
			cancelled = true;
			if (unlistenFn) {
				unlistenFn();
				unlistenFn = null;
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
