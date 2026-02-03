/**
 * useTauriChat Hook
 *
 * React hook for managing chat state with the Tauri backend.
 * Provides a similar interface to AI SDK's useChat but routes through Tauri.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { BackendEvent, AgentToolCall, ToolCallWithStatus } from '../bindings';

// =============================================================================
// Types
// =============================================================================

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	toolCalls?: AgentToolCall[];
	pendingToolApprovals?: ToolCallWithStatus[];
	createdAt: Date;
	isStreaming?: boolean;
}

export interface UseTauriChatOptions {
	sessionId?: string;
	systemPrompt?: string;
	onError?: (error: Error) => void;
	onToolApprovalNeeded?: (toolCall: ToolCallWithStatus) => void;
}

export interface UseTauriChatReturn {
	messages: ChatMessage[];
	input: string;
	setInput: (input: string) => void;
	handleSubmit: (e?: React.FormEvent) => Promise<void>;
	isLoading: boolean;
	error: Error | null;
	sessionId: string | null;
	createSession: (model?: string) => Promise<string>;
	clearMessages: () => void;
	stop: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useTauriChat(options: UseTauriChatOptions = {}): UseTauriChatReturn {
	const { systemPrompt, onError, onToolApprovalNeeded } = options;

	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [sessionId, setSessionId] = useState<string | null>(options.sessionId ?? null);

	const currentMessageRef = useRef<ChatMessage | null>(null);
	const unlistenRef = useRef<UnlistenFn | null>(null);

	// Stable refs for callbacks to avoid listener churn
	const onErrorRef = useRef(onError);
	onErrorRef.current = onError;
	const onToolApprovalNeededRef = useRef(onToolApprovalNeeded);
	onToolApprovalNeededRef.current = onToolApprovalNeeded;

	// Set up event listener
	useEffect(() => {
		const setupListener = async () => {
			// Clean up existing listener
			if (unlistenRef.current) {
				unlistenRef.current();
			}

			unlistenRef.current = await listen<BackendEvent>('backend-event', (event) => {
				const payload = event.payload;

				// Only process events for our session
				if ('conversation_id' in payload.payload && payload.payload.conversation_id !== sessionId) {
					return;
				}

				switch (payload.type) {
					case 'agent:chunk':
						setMessages((prev) => {
							const lastMessage = prev[prev.length - 1];
							if (lastMessage?.isStreaming) {
								return [
									...prev.slice(0, -1),
									{
										...lastMessage,
										content: lastMessage.content + payload.payload.content,
									},
								];
							}
							return prev;
						});
						break;

					case 'agent:tool_start':
						setMessages((prev) => {
							const lastMessage = prev[prev.length - 1];
							if (lastMessage?.isStreaming) {
								const toolCalls = lastMessage.toolCalls || [];
								return [
									...prev.slice(0, -1),
									{
										...lastMessage,
										toolCalls: [...toolCalls, payload.payload.tool_call],
									},
								];
							}
							return prev;
						});
						break;

					case 'agent:tool_approval_needed':
						onToolApprovalNeededRef.current?.(payload.payload.tool_call);
						setMessages((prev) => {
							const lastMessage = prev[prev.length - 1];
							if (lastMessage?.isStreaming) {
								const pendingApprovals = lastMessage.pendingToolApprovals || [];
								return [
									...prev.slice(0, -1),
									{
										...lastMessage,
										pendingToolApprovals: [...pendingApprovals, payload.payload.tool_call],
									},
								];
							}
							return prev;
						});
						break;

					case 'agent:complete':
						setMessages((prev) => {
							const lastMessage = prev[prev.length - 1];
							if (lastMessage?.isStreaming) {
								return [
									...prev.slice(0, -1),
									{
										...lastMessage,
										content: payload.payload.message.content,
										toolCalls: payload.payload.message.tool_calls ?? undefined,
										isStreaming: false,
									},
								];
							}
							return prev;
						});
						setIsLoading(false);
						currentMessageRef.current = null;
						break;

					case 'agent:error':
						const err = new Error(payload.payload.error);
						setError(err);
						onErrorRef.current?.(err);
						setIsLoading(false);
						setMessages((prev) => {
							const lastMessage = prev[prev.length - 1];
							if (lastMessage?.isStreaming) {
								return prev.slice(0, -1);
							}
							return prev;
						});
						currentMessageRef.current = null;
						break;
				}
			});
		};

		if (sessionId) {
			setupListener();
		}

		return () => {
			if (unlistenRef.current) {
				unlistenRef.current();
			}
		};
	}, [sessionId]);

	// Create a new session
	const createSession = useCallback(async (model?: string): Promise<string> => {
		try {
			const newSessionId = await invoke<string>('agent_create_session', { model });
			setSessionId(newSessionId);
			setMessages([]);
			setError(null);
			return newSessionId;
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			setError(error);
			onErrorRef.current?.(error);
			throw error;
		}
	}, []);

	// Submit a message
	const handleSubmit = useCallback(async (e?: React.FormEvent) => {
		e?.preventDefault();

		if (!input.trim() || isLoading) return;
		if (!sessionId) {
			const error = new Error('No session. Call createSession first.');
			setError(error);
			onErrorRef.current?.(error);
			return;
		}

		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: input.trim(),
			createdAt: new Date(),
		};

		const assistantMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'assistant',
			content: '',
			createdAt: new Date(),
			isStreaming: true,
		};

		setMessages((prev) => [...prev, userMessage, assistantMessage]);
		setInput('');
		setIsLoading(true);
		setError(null);
		currentMessageRef.current = assistantMessage;

		try {
			await invoke('agent_send_message', {
				sessionId,
				content: userMessage.content,
				systemPrompt,
			});
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			setError(error);
			onErrorRef.current?.(error);
			setIsLoading(false);
			// Remove the streaming assistant message on error
			setMessages((prev) => prev.slice(0, -1));
			currentMessageRef.current = null;
		}
	}, [input, isLoading, sessionId, systemPrompt]);

	// Clear all messages
	const clearMessages = useCallback(() => {
		setMessages([]);
		setError(null);
	}, []);

	// Stop current generation (placeholder - needs backend support)
	const stop = useCallback(() => {
		// TODO: Implement abort in backend
		console.warn('Stop not yet implemented');
	}, []);

	return {
		messages,
		input,
		setInput,
		handleSubmit,
		isLoading,
		error,
		sessionId,
		createSession,
		clearMessages,
		stop,
	};
}

export default useTauriChat;
