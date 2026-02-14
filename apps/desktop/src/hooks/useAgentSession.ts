/**
 * Hook for managing agent sessions
 *
 * Provides session lifecycle management and message sending.
 * Accepts an explicit sessionId for tab-scoped usage.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
	useAgentStore,
	useSessionMessages,
	useIsSessionStreaming,
	useSessionError,
} from '../stores/agentStore';
import type { Message, MessageMode, AgentSession } from '../stores/agentStore';

export interface UseAgentSessionOptions {
	/** Explicit session ID to use (from tab data) */
	sessionId: string | null;
	/** Auto-create a session if sessionId is null */
	autoCreate?: boolean;
	/** Default model for new sessions */
	defaultModel?: string;
}

export interface UseAgentSessionReturn {
	/** Current session */
	session: AgentSession | null;
	/** Current session ID */
	sessionId: string | null;
	/** Messages in the current session */
	messages: Message[];
	/** Whether the agent is currently processing */
	isRunning: boolean;
	/** Current error message */
	error: string | null;
	/** Create a new session */
	createSession: (model?: string) => Promise<string>;
	/** Send a message */
	sendMessage: (content: string, mode?: MessageMode) => Promise<void>;
	/** Clear any error */
	clearError: () => void;
}

/**
 * Hook for managing agent sessions, scoped to a specific session ID.
 */
export function useAgentSession(
	options: UseAgentSessionOptions
): UseAgentSessionReturn {
	const { sessionId: propSessionId, autoCreate = false, defaultModel } = options;

	// Local session ID for auto-created sessions
	const [localSessionId, setLocalSessionId] = useState<string | null>(null);
	const effectiveSessionId = propSessionId ?? localSessionId;

	// Session data from store
	const sessions = useAgentStore((state) => state.sessions);
	const session = effectiveSessionId ? sessions.get(effectiveSessionId) ?? null : null;

	// Per-session messages and streaming state
	const messages = useSessionMessages(effectiveSessionId);
	const isRunning = useIsSessionStreaming(effectiveSessionId);
	const error = useSessionError(effectiveSessionId);

	const storeCreateSession = useAgentStore((state) => state.createSession);
	const storeSendMessage = useAgentStore((state) => state.sendMessage);
	const storeClearError = useAgentStore((state) => state.clearError);

	// Track if we've attempted auto-creation
	const autoCreated = useRef(false);

	// Auto-create session if requested and no session ID provided
	useEffect(() => {
		if (autoCreate && !propSessionId && !localSessionId && !autoCreated.current) {
			autoCreated.current = true;

			// Reuse the most recent existing session instead of creating a duplicate
			const existingSessions = useAgentStore.getState().sessions;
			if (existingSessions.size > 0) {
				const mostRecent = [...existingSessions.values()]
					.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
				if (mostRecent) {
					setLocalSessionId(mostRecent.id);
					return;
				}
			}

			storeCreateSession(defaultModel)
				.then((newId) => {
					setLocalSessionId(newId);
				})
				.catch(console.error);
		}
	}, [autoCreate, propSessionId, localSessionId, defaultModel, storeCreateSession]);

	const createSession = useCallback(
		async (model?: string) => {
			return storeCreateSession(model || defaultModel);
		},
		[storeCreateSession, defaultModel]
	);

	const sendMessage = useCallback(
		async (content: string, mode: MessageMode = 'planning') => {
			if (!content.trim() || !effectiveSessionId) return;
			await storeSendMessage(effectiveSessionId, content, mode);
		},
		[storeSendMessage, effectiveSessionId]
	);

	const clearError = useCallback(() => {
		if (effectiveSessionId) {
			storeClearError(effectiveSessionId);
		}
	}, [storeClearError, effectiveSessionId]);

	return {
		session,
		sessionId: effectiveSessionId,
		messages,
		isRunning,
		error,
		createSession,
		sendMessage,
		clearError,
	};
}
