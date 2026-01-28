/**
 * Backend API wrappers for provider management
 *
 * Type-safe wrappers around Tauri invoke calls for agent and provider commands.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
	ProviderType,
	AgentMessage,
} from '../bindings';

// =============================================================================
// Types
// =============================================================================

export interface ProviderStatus {
	provider: ProviderType;
	has_credentials: boolean;
	credential_source: string | null;
	is_active: boolean;
}

export interface ModelInfo {
	id: string;
	display_name: string;
	alias: string;
	provider: ProviderType;
	is_default: boolean;
	description: string;
}

// Re-export for convenience
export type { ProviderType };

// =============================================================================
// Provider Commands
// =============================================================================

/**
 * Get list of available providers
 * @returns Array of provider names
 */
export async function getProviders(): Promise<string[]> {
	return invoke<string[]>('get_providers');
}

/**
 * Get the currently active provider
 * @returns Active provider name
 */
export async function getActiveProvider(): Promise<string> {
	return invoke<string>('get_active_provider');
}

/**
 * Set the active provider
 * @param provider - Provider name to activate
 */
export async function setActiveProvider(provider: string): Promise<void> {
	return invoke('set_active_provider', { provider });
}

/**
 * Get status for a specific provider
 * @param provider - Provider name
 * @returns Provider status including credentials info
 */
export async function getProviderStatus(provider: string): Promise<ProviderStatus> {
	return invoke<ProviderStatus>('get_provider_status', { provider });
}

/**
 * Check if a provider has credentials configured
 * @param provider - Provider name
 * @returns True if credentials exist
 */
export async function hasCredentials(provider: string): Promise<boolean> {
	return invoke<boolean>('has_credentials', { provider });
}

/**
 * Set credentials for a provider
 * @param provider - Provider type
 * @param apiKey - API key to store
 */
export async function setCredentials(provider: ProviderType, apiKey: string): Promise<void> {
	return invoke('set_credentials', { provider, apiKey });
}

// =============================================================================
// Model Commands
// =============================================================================

/**
 * Get available models for all providers
 * @returns Array of model info
 */
export async function getModels(): Promise<ModelInfo[]> {
	return invoke<ModelInfo[]>('get_models');
}

/**
 * Get models for a specific provider
 * @param provider - Provider name
 * @returns Array of model info
 */
export async function getModelsForProvider(provider: string): Promise<ModelInfo[]> {
	return invoke<ModelInfo[]>('get_models_for_provider_cmd', { provider });
}

// =============================================================================
// Session Commands
// =============================================================================

/**
 * Create a new agent session
 * @param model - Optional model to use for the session
 * @returns Session ID
 */
export async function createAgentSession(model?: string): Promise<string> {
	return invoke<string>('agent_create_session', { model });
}

/**
 * Send a message to the agent
 * @param sessionId - Session ID
 * @param content - Message content
 * @param systemPrompt - Optional system prompt
 */
export async function sendAgentMessage(
	sessionId: string,
	content: string,
	systemPrompt?: string
): Promise<void> {
	return invoke('agent_send_message', { sessionId, content, systemPrompt });
}

/**
 * Get conversation history for a session
 * @param sessionId - Session ID
 * @returns Array of messages
 */
export async function getAgentHistory(sessionId: string): Promise<AgentMessage[]> {
	return invoke<AgentMessage[]>('agent_get_history', { sessionId });
}

/**
 * Clear conversation history for a session
 * @param sessionId - Session ID
 */
export async function clearAgentHistory(sessionId: string): Promise<void> {
	return invoke('agent_clear_history', { sessionId });
}
