/**
 * Tauri IPC utilities for agent communication (bridge pattern)
 *
 * Listens to agent:* events emitted by the Rust agent bridge.
 * Each event type has its own Tauri channel (not a single BackendEvent union).
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
	AgentMessageEvent,
	AgentPermissionRequestEvent,
	AgentSessionInitEvent,
	AgentModeChangedEvent,
	AgentTurnStartEvent,
	AgentErrorEvent,
	BridgeAgentMessage,
	PermissionRequest,
} from '../../bindings';

// =============================================================================
// Commands (invoke wrappers)
// =============================================================================

/** Refine a voice transcript using LLM (calls through the agent bridge) */
export const refineTranscript = (transcript: string, context?: string) =>
	invoke<string>('agent_refine_transcript', { transcript, context });

// =============================================================================
// Event Handlers
// =============================================================================

export interface AgentEventHandlers {
	onMessage?: (sessionId: string, message: BridgeAgentMessage) => void;
	onPermissionRequest?: (request: PermissionRequest) => void;
	onSessionInit?: (sessionId: string, sdkSessionId: string, isResumed: boolean, isForked: boolean) => void;
	onTurnStart?: (sessionId: string, turnNumber: number) => void;
	onPlanModeChanged?: (sessionId: string, enabled: boolean) => void;
	onAcceptModeChanged?: (sessionId: string, enabled: boolean) => void;
	onDebugModeChanged?: (sessionId: string, enabled: boolean) => void;
	onSessionGoalCaptured?: (sessionId: string, goal: string, capturedAt: number) => void;
	onError?: (message: string, stack?: string) => void;
	onReady?: () => void;
}

// =============================================================================
// Event Listener
// =============================================================================

/**
 * Listen to all agent events from the bridge.
 * Returns a cleanup function that removes all listeners.
 */
export async function listenToAgentEvents(
	handlers: AgentEventHandlers
): Promise<UnlistenFn> {
	const unlistens: UnlistenFn[] = [];

	if (handlers.onMessage) {
		const h = handlers.onMessage;
		unlistens.push(
			await listen<AgentMessageEvent>('agent:message', (event) => {
				h(event.payload.sessionId, event.payload.message);
			})
		);
	}

	if (handlers.onPermissionRequest) {
		const h = handlers.onPermissionRequest;
		unlistens.push(
			await listen<AgentPermissionRequestEvent>('agent:permission_request', (event) => {
				console.log('[DIAG] agent:permission_request received', event.payload.toolName, event.payload.requestId);
				h({
					sessionId: event.payload.sessionId,
					toolName: event.payload.toolName,
					toolInput: event.payload.toolInput,
					requestId: event.payload.requestId,
				});
			})
		);
	}

	if (handlers.onSessionInit) {
		const h = handlers.onSessionInit;
		unlistens.push(
			await listen<AgentSessionInitEvent>('agent:session_init', (event) => {
				h(
					event.payload.sessionId,
					event.payload.sdkSessionId,
					event.payload.isResumed,
					event.payload.isForked,
				);
			})
		);
	}

	if (handlers.onTurnStart) {
		const h = handlers.onTurnStart;
		unlistens.push(
			await listen<AgentTurnStartEvent>('agent:turn_start', (event) => {
				h(event.payload.sessionId, event.payload.turnNumber);
			})
		);
	}

	if (handlers.onPlanModeChanged) {
		const h = handlers.onPlanModeChanged;
		unlistens.push(
			await listen<AgentModeChangedEvent>('agent:plan_mode_changed', (event) => {
				h(event.payload.sessionId, event.payload.enabled);
			})
		);
	}

	if (handlers.onAcceptModeChanged) {
		const h = handlers.onAcceptModeChanged;
		unlistens.push(
			await listen<AgentModeChangedEvent>('agent:accept_mode_changed', (event) => {
				h(event.payload.sessionId, event.payload.enabled);
			})
		);
	}

	if (handlers.onDebugModeChanged) {
		const h = handlers.onDebugModeChanged;
		unlistens.push(
			await listen<AgentModeChangedEvent>('agent:debug_mode_changed', (event) => {
				h(event.payload.sessionId, event.payload.enabled);
			})
		);
	}

	if (handlers.onSessionGoalCaptured) {
		const h = handlers.onSessionGoalCaptured;
		unlistens.push(
			await listen<{ sessionId: string; goal: string; capturedAt: number }>(
				'agent:session_goal_captured',
				(event) => {
					h(event.payload.sessionId, event.payload.goal, event.payload.capturedAt);
				}
			)
		);
	}

	if (handlers.onError) {
		const h = handlers.onError;
		unlistens.push(
			await listen<AgentErrorEvent>('agent:error', (event) => {
				h(event.payload.message, event.payload.stack);
			})
		);
	}

	if (handlers.onReady) {
		const h = handlers.onReady;
		unlistens.push(
			await listen('agent:ready', () => {
				h();
			})
		);
	}

	return () => {
		for (const u of unlistens) u();
	};
}
