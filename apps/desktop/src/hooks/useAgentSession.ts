/**
 * Hook for managing agent sessions
 *
 * Provides session lifecycle management and message sending.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useAgentStore, useActiveSession, useActiveSessionId, useActiveSessionMessages } from '../stores/agentStore';
import type { MessageMode } from '../stores/agentStore';

export interface UseAgentSessionOptions {
	/** Auto-create a session if none exists */
	autoCreate?: boolean;
	/** Default model for new sessions */
	defaultModel?: string;
}

export interface UseAgentSessionReturn {
	/** Current session */
	session: ReturnType<typeof useActiveSession>;
	/** Current session ID */
	sessionId: string | null;
	/** Messages in the current session */
	messages: ReturnType<typeof useActiveSessionMessages>;
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
 * Hook for managing agent sessions
 *
 * @example
 * ```tsx
 * function ChatPanel() {
 *   const { session, messages, sendMessage, isRunning } = useAgentSession({
 *     autoCreate: true,
 *   });
 *
 *   const handleSubmit = (content: string) => {
 *     sendMessage(content, 'planning');
 *   };
 *
 *   return (
 *     <div>
 *       {messages.map(msg => <Message key={msg.id} {...msg} />)}
 *       <Input onSubmit={handleSubmit} disabled={isRunning} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useAgentSession(
	options: UseAgentSessionOptions = {}
): UseAgentSessionReturn {
	const { autoCreate = false, defaultModel } = options;

	const session = useActiveSession();
	const sessionId = useActiveSessionId();
	const messages = useActiveSessionMessages();
	const isRunning = useAgentStore((state) => state.isAgentRunning);
	const error = useAgentStore((state) => state.error);

	const storeCreateSession = useAgentStore((state) => state.createSession);
	const storeSendMessage = useAgentStore((state) => state.sendMessage);
	const storeClearError = useAgentStore((state) => state.clearError);

	// Track if we've attempted auto-creation
	const autoCreated = useRef(false);

	// Auto-create session if requested
	useEffect(() => {
		if (autoCreate && !sessionId && !autoCreated.current) {
			autoCreated.current = true;
			storeCreateSession(defaultModel).catch(console.error);
		}
	}, [autoCreate, sessionId, defaultModel, storeCreateSession]);

	const createSession = useCallback(
		async (model?: string) => {
			return storeCreateSession(model || defaultModel);
		},
		[storeCreateSession, defaultModel]
	);

	const sendMessage = useCallback(
		async (content: string, mode: MessageMode = 'planning') => {
			if (!content.trim()) return;
			await storeSendMessage(content, mode);
		},
		[storeSendMessage]
	);

	const clearError = useCallback(() => {
		storeClearError();
	}, [storeClearError]);

	return {
		session,
		sessionId,
		messages,
		isRunning,
		error,
		createSession,
		sendMessage,
		clearError,
	};
}
