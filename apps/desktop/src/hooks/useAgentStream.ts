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
import type { BridgeAgentMessage, PermissionRequest } from '../bindings';

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
		onMessage: useAgentStore((s) => s.handleAgentMessage),
		onPermissionRequest: useAgentStore((s) => s.handlePermissionRequest),
		onSessionInit: useAgentStore((s) => s.handleSessionInit),
		onTurnStart: useAgentStore((s) => s.handleTurnStart),
		onError: useAgentStore((s) => s.handleError),
		onPlanModeChanged: useAgentStore((s) => s.handlePlanModeChanged),
		onAcceptModeChanged: useAgentStore((s) => s.handleAcceptModeChanged),
	};

	useEffect(() => {
		if (!enabled) return;

		let cancelled = false;
		let unlisten: (() => void) | null = null;

		// Proxy handlers delegate through the ref so we always call the latest
		const proxy: AgentEventHandlers = {
			onMessage: (sessionId: string, message: BridgeAgentMessage) =>
				handlersRef.current.onMessage?.(sessionId, message),
			onPermissionRequest: (request: PermissionRequest) =>
				handlersRef.current.onPermissionRequest?.(request),
			onSessionInit: (sessionId, sdkSessionId, isResumed, isForked) =>
				handlersRef.current.onSessionInit?.(sessionId, sdkSessionId, isResumed, isForked),
			onTurnStart: (sessionId, turnNumber) =>
				handlersRef.current.onTurnStart?.(sessionId, turnNumber),
			onError: (message, stack) =>
				handlersRef.current.onError?.(message, stack),
			onPlanModeChanged: (sessionId, enabled) =>
				handlersRef.current.onPlanModeChanged?.(sessionId, enabled),
			onAcceptModeChanged: (sessionId, enabled) =>
				handlersRef.current.onAcceptModeChanged?.(sessionId, enabled),
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
