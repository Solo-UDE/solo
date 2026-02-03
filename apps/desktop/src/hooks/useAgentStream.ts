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
 * Teardown the singleton agent stream listener.
 */
export function teardownAgentStreamListener(): void {
	if (_cleanup) {
		_cleanup();
		_cleanup = null;
	}
	_initialized = false;
}
