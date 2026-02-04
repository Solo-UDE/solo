/**
 * Singleton agent stream listener
 *
 * Sets up ONE Tauri event listener for all agent streaming events.
 * Dispatches to the agent store's per-session handlers.
 *
 * Uses a ref-based proxy pattern so the listener is registered exactly once
 * (on mount) and always delegates to the latest store actions without needing
 * to tear down / re-register when action references change.
 *
 * The `cancelled` flag guards against the React StrictMode double-invoke
 * pattern where cleanup runs before the async `listen()` promise resolves.
 */

import { useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agentStore';
import { listenToAgentEvents, type AgentEventHandlers } from '../lib/tauri/agent';

interface UseAgentStreamOptions {
	enabled?: boolean;
}

export function useAgentStream(options: UseAgentStreamOptions = {}): void {
	const { enabled = true } = options;

	// Keep a mutable ref to the latest handlers so the event listener always
	// calls the most recent store actions without re-subscribing.
	const handlersRef = useRef<AgentEventHandlers>({});

	// Update handlers ref on every render (cheap, no effect dependency)
	handlersRef.current = {
		onChunk: useAgentStore((s) => s.handleAgentChunk),
		onToolStart: useAgentStore((s) => s.handleAgentToolStart),
		onToolEnd: useAgentStore((s) => s.handleAgentToolEnd),
		onToolApprovalNeeded: useAgentStore((s) => s.handleToolApprovalNeeded),
		onComplete: useAgentStore((s) => s.handleAgentComplete),
		onError: useAgentStore((s) => s.handleAgentError),
		onTurnStart: useAgentStore((s) => s.handleTurnStart),
		onLoopComplete: useAgentStore((s) => s.handleLoopComplete),
		onAborted: useAgentStore((s) => s.handleAborted),
	};

	useEffect(() => {
		if (!enabled) return;

		let cancelled = false;
		let unlisten: (() => void) | null = null;

		// Proxy handlers delegate through the ref so we always call the latest
		const proxy: AgentEventHandlers = {
			onChunk: (id, content) => handlersRef.current.onChunk?.(id, content),
			onToolStart: (id, tc) => handlersRef.current.onToolStart?.(id, tc),
			onToolEnd: (id, tcId, result) => handlersRef.current.onToolEnd?.(id, tcId, result),
			onToolApprovalNeeded: (id, tc) => handlersRef.current.onToolApprovalNeeded?.(id, tc),
			onComplete: (id, msg) => handlersRef.current.onComplete?.(id, msg),
			onError: (id, err) => handlersRef.current.onError?.(id, err),
			onTurnStart: (id, turn) => handlersRef.current.onTurnStart?.(id, turn),
			onLoopComplete: (id, turns) => handlersRef.current.onLoopComplete?.(id, turns),
			onAborted: (id, reason) => handlersRef.current.onAborted?.(id, reason),
		};

		listenToAgentEvents(proxy)
			.then((fn) => {
				if (cancelled) {
					// Effect was cleaned up before the listener was ready — tear it down immediately
					fn();
					return;
				}
				unlisten = fn;
			})
			.catch((error) => {
				console.error('Failed to listen to agent events:', error);
			});

		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, [enabled]); // Only re-run when enabled changes — handlers are accessed via ref
}
