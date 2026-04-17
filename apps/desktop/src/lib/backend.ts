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
	max_output_tokens: number;
}

// Re-export for convenience
export type { ProviderType, AuthMethodInfo, ClaudeSetupStatus };

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
 * Set model for a session — full model ID (e.g. 'claude-opus-4-7[1m]') or alias.
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

/**
 * Enable or disable Debug mode for a session.
 *
 * When enabled, the next user prompt is captured as the session goal and a
 * `session:goal_captured` event is emitted. The agent periodically asks the
 * user review questions (cadence configured via `.solo/settings.json`).
 */
export async function agentSetDebugMode(sessionId: string, enabled: boolean): Promise<void> {
	return invoke('agent_set_debug_mode', { sessionId, enabled });
}

/** Get Debug mode for a session. */
export async function agentGetDebugMode(sessionId: string): Promise<boolean> {
	return invoke<boolean>('agent_get_debug_mode', { sessionId });
}

/**
 * Set tool permission policy for a session
 */
export async function agentSetToolPolicy(
	sessionId: string,
	mode: 'ask-all' | 'smart' | 'approve-all',
	isWorktreeSession: boolean
): Promise<void> {
	return invoke('agent_set_tool_policy', { sessionId, mode: mode || 'ask-all', isWorktreeSession });
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

export async function waitForOAuthCallback(expectedState: string): Promise<{ code: string; state: string }> {
	const [code, state] = await invoke<[string, string]>('wait_for_oauth_callback', { expectedState });
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

// =============================================================================
// Settings & Permissions Commands
// =============================================================================

import type {
	SoloSettings,
	SettingsScope,
	PermissionsConfig,
	PermissionMode,
	PermissionCheckRequest,
	PermissionDecision,
} from '../bindings';

/** Load fully-merged settings (user → project → local) for a workspace. */
export async function settingsLoad(workspace: string): Promise<SoloSettings> {
	return invoke<SoloSettings>('settings_load', { workspace });
}

/** Load settings for a single scope (for the settings UI). */
export async function settingsLoadScope(
	scope: SettingsScope,
	workspace: string
): Promise<SoloSettings> {
	return invoke<SoloSettings>('settings_load_scope', { scope, workspace });
}

/** Save a scope's settings and broadcast a settings:changed event. */
export async function settingsSave(
	scope: SettingsScope,
	workspace: string,
	settings: SoloSettings
): Promise<void> {
	return invoke('settings_save', { scope, workspace, settings });
}

/** Append an allow rule to a scope (deduped). Returns the merged settings. */
export async function settingsAddAllowRule(
	scope: SettingsScope,
	workspace: string,
	rule: string
): Promise<SoloSettings> {
	return invoke<SoloSettings>('settings_add_allow_rule', { scope, workspace, rule });
}

/** Append a deny rule to a scope (deduped). Returns the merged settings. */
export async function settingsAddDenyRule(
	scope: SettingsScope,
	workspace: string,
	rule: string
): Promise<SoloSettings> {
	return invoke<SoloSettings>('settings_add_deny_rule', { scope, workspace, rule });
}

/** Append an ask rule to a scope (deduped). Returns the merged settings. */
export async function settingsAddAskRule(
	scope: SettingsScope,
	workspace: string,
	rule: string
): Promise<SoloSettings> {
	return invoke<SoloSettings>('settings_add_ask_rule', { scope, workspace, rule });
}

/** Convenience: fetch just the merged permissions config. */
export async function settingsGetPermissions(workspace: string): Promise<PermissionsConfig> {
	return invoke<PermissionsConfig>('settings_get_permissions', { workspace });
}

/** Resolve the default mode for a new session from merged settings. */
export async function settingsDefaultMode(workspace: string): Promise<PermissionMode> {
	return invoke<PermissionMode>('settings_default_mode', { workspace });
}

/**
 * Run the permission decision pipeline for a tool call.
 *
 * Agents should call this BEFORE emitting any permission request UI, so
 * Accept-mode auto-approvals don't flash a modal before resolving.
 */
export async function permissionsCheck(
	workspace: string,
	request: PermissionCheckRequest
): Promise<PermissionDecision> {
	return invoke<PermissionDecision>('permissions_check', { workspace, request });
}

// =============================================================================
// Plan File Commands
// =============================================================================

/** Generate a fresh plan slug that doesn't collide with existing files. */
export async function planNewSlug(workspace: string): Promise<string> {
	return invoke<string>('plan_new_slug', { workspace });
}

/** Write plan content atomically. Returns the absolute path on disk. */
export async function planWrite(
	workspace: string,
	slug: string,
	content: string
): Promise<string> {
	return invoke<string>('plan_write', { workspace, slug, content });
}

/** Read plan contents. Returns null when missing. */
export async function planRead(workspace: string, slug: string): Promise<string | null> {
	return invoke<string | null>('plan_read', { workspace, slug });
}

/** List all plan slugs in the workspace, sorted. */
export async function planList(workspace: string): Promise<string[]> {
	return invoke<string[]>('plan_list', { workspace });
}

/** Delete a plan file. Idempotent. */
export async function planDelete(workspace: string, slug: string): Promise<void> {
	return invoke('plan_delete', { workspace, slug });
}

/** Resolve the absolute path for a plan slug without reading the file. */
export async function planPath(workspace: string, slug: string): Promise<string> {
	return invoke<string>('plan_path', { workspace, slug });
}
