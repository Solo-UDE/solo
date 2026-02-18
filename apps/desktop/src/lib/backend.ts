/**
 * Backend API wrappers for provider and agent commands
 *
 * Type-safe wrappers around Tauri invoke calls.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
	ProviderType,
	OAuthMethod,
	OAuthFlowResult,
	AuthMethodInfo,
	AuthType,
	ClaudeSetupStatus,
	SessionConfig,
	AttachmentContentBlock,
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
	context_window: number;
}

// Re-export for convenience
export type { ProviderType, OAuthMethod, OAuthFlowResult, AuthMethodInfo, AuthType, ClaudeSetupStatus };

// =============================================================================
// Provider Commands
// =============================================================================

export async function getProviders(): Promise<string[]> {
	return invoke<string[]>('get_providers');
}

export async function getActiveProvider(): Promise<string> {
	return invoke<string>('get_active_provider');
}

export async function setActiveProvider(provider: string): Promise<void> {
	return invoke('set_active_provider', { provider });
}

export async function getProviderStatus(provider: string): Promise<ProviderStatus> {
	return invoke<ProviderStatus>('get_provider_status', { provider });
}

export async function hasCredentials(provider: string): Promise<boolean> {
	return invoke<boolean>('has_credentials', { provider });
}

export async function setCredentials(provider: ProviderType, apiKey: string): Promise<void> {
	return invoke('set_credentials', { provider, apiKey });
}

export async function clearCredentials(provider: string): Promise<void> {
	return invoke('clear_credentials', { provider });
}

// =============================================================================
// Model Commands
// =============================================================================

export async function getModels(): Promise<ModelInfo[]> {
	return invoke<ModelInfo[]>('get_models');
}

export async function getModelsForProvider(provider: string): Promise<ModelInfo[]> {
	return invoke<ModelInfo[]>('get_models_for_provider_cmd', { provider });
}

// =============================================================================
// Agent Session Commands (bridge-based)
// =============================================================================

/**
 * Create a new agent session
 * @param sessionId - Client-generated session ID
 * @param config - Optional session configuration
 */
export async function agentCreateSession(sessionId: string, config?: SessionConfig): Promise<void> {
	return invoke('agent_create_session', { sessionId, config });
}

/**
 * Delete an agent session
 */
export async function agentDeleteSession(sessionId: string): Promise<void> {
	return invoke('agent_delete_session', { sessionId });
}

/**
 * Send a message to an agent session
 */
export async function agentSendMessage(
	sessionId: string,
	message: string,
	attachments?: AttachmentContentBlock[]
): Promise<void> {
	return invoke('agent_send_message', { sessionId, message, attachments });
}

/**
 * Interrupt a running agent session
 */
export async function agentInterrupt(sessionId: string): Promise<void> {
	return invoke('agent_interrupt', { sessionId });
}

/**
 * Check if a session is ready
 */
export async function agentIsSessionReady(sessionId: string): Promise<boolean> {
	return invoke<boolean>('agent_is_session_ready', { sessionId });
}

/**
 * Get the SDK session ID for persistence/resume
 */
export async function agentGetSdkSessionId(sessionId: string): Promise<string | null> {
	return invoke<string | null>('agent_get_sdk_session_id', { sessionId });
}

/**
 * Respond to a permission request
 */
export async function agentRespondPermission(
	requestId: string,
	decision: 'approve' | 'deny',
	always: boolean = false,
	answers?: Record<string, string>
): Promise<void> {
	return invoke('agent_respond_permission', { requestId, decision, always, answers });
}

/**
 * Set model for a session (haiku | sonnet | opus)
 */
export async function agentSetModel(sessionId: string, model: string): Promise<void> {
	return invoke('agent_set_model', { sessionId, model });
}

/**
 * Set thinking mode for a session
 */
export async function agentSetThinkingMode(
	sessionId: string,
	enabled: boolean,
	maxTokens?: number
): Promise<void> {
	return invoke('agent_set_thinking_mode', { sessionId, enabled, maxTokens });
}

/**
 * Get thinking mode for a session
 */
export async function agentGetThinkingMode(sessionId: string): Promise<boolean> {
	return invoke<boolean>('agent_get_thinking_mode', { sessionId });
}

/**
 * Set plan mode for a session
 */
export async function agentSetPlanMode(sessionId: string, enabled: boolean): Promise<void> {
	return invoke('agent_set_plan_mode', { sessionId, enabled });
}

/**
 * Get plan mode for a session
 */
export async function agentGetPlanMode(sessionId: string): Promise<boolean> {
	return invoke<boolean>('agent_get_plan_mode', { sessionId });
}

/**
 * Set accept mode for a session
 */
export async function agentSetAcceptMode(sessionId: string, enabled: boolean): Promise<void> {
	return invoke('agent_set_accept_mode', { sessionId, enabled });
}

/**
 * Get accept mode for a session
 */
export async function agentGetAcceptMode(sessionId: string): Promise<boolean> {
	return invoke<boolean>('agent_get_accept_mode', { sessionId });
}

// =============================================================================
// OAuth Commands
// =============================================================================

export async function startOAuthFlow(
	provider: string,
	method: OAuthMethod
): Promise<OAuthFlowResult> {
	return invoke<OAuthFlowResult>('start_oauth_flow', { provider, method });
}

export async function completeOAuthFlow(
	code: string,
	oauthState: string
): Promise<void> {
	return invoke('complete_oauth_flow', { code, oauthState });
}

export async function waitForOAuthCallback(): Promise<{ code: string; state: string }> {
	const [code, state] = await invoke<[string, string]>('wait_for_oauth_callback');
	return { code, state };
}

export async function getAuthMethod(provider: string): Promise<AuthMethodInfo> {
	return invoke<AuthMethodInfo>('get_auth_method', { provider });
}

export async function disconnectOAuth(provider: string): Promise<void> {
	return invoke('disconnect_oauth', { provider });
}

// =============================================================================
// Claude Code CLI Commands
// =============================================================================

export async function checkClaudeCliInstalled(): Promise<boolean> {
	return invoke<boolean>('check_claude_cli_installed');
}

export async function installClaudeCli(): Promise<void> {
	return invoke('install_claude_cli');
}

export async function startClaudeLogin(): Promise<void> {
	return invoke('start_claude_login');
}

export async function checkClaudeAuthStatus(): Promise<boolean> {
	return invoke<boolean>('check_claude_auth_status');
}

export async function verifyClaudeSetup(): Promise<ClaudeSetupStatus> {
	return invoke<ClaudeSetupStatus>('verify_claude_setup');
}
