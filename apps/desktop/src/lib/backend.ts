/**
 * Backend API wrappers for provider management
 *
 * NOTE: These are currently stub implementations. The Rust backend
 * doesn't have provider commands yet. When implemented, replace these
 * with actual Tauri invoke calls.
 *
 * TODO: Implement in Rust backend:
 * - get_providers
 * - get_active_provider
 * - set_active_provider
 * - get_provider_status
 * - has_credentials
 * - set_credentials
 * - get_models
 */

import type {
	ProviderType,
	ProviderStatus,
	ModelInfo,
} from '../bindings';

// Re-export types for convenience
export type { ProviderType, ProviderStatus, ModelInfo };

/**
 * Get list of available providers
 * @returns Array of provider names
 */
export async function getProviders(): Promise<string[]> {
	// TODO: Replace with invoke('get_providers')
	return ['anthropic', 'openai'];
}

/**
 * Get the currently active provider
 * @returns Active provider name
 */
export async function getActiveProvider(): Promise<string> {
	// TODO: Replace with invoke('get_active_provider')
	return 'anthropic';
}

/**
 * Set the active provider
 * @param provider - Provider name to activate
 */
export async function setActiveProvider(provider: string): Promise<void> {
	// TODO: Replace with invoke('set_active_provider', { provider })
	console.log(`[stub] Setting active provider to: ${provider}`);
}

/**
 * Get status for a specific provider
 * @param provider - Provider name
 * @returns Provider status including credentials info
 */
export async function getProviderStatus(provider: string): Promise<ProviderStatus> {
	// TODO: Replace with invoke('get_provider_status', { provider })
	const providerType: ProviderType = provider.toLowerCase() === 'anthropic' ? 'Anthropic' : 'OpenAI';
	return {
		provider: providerType,
		has_credentials: false,
		credential_source: null,
		is_active: provider.toLowerCase() === 'anthropic',
	};
}

/**
 * Check if a provider has credentials configured
 * @param provider - Provider name
 * @returns True if credentials exist
 */
export async function hasCredentials(provider: string): Promise<boolean> {
	// TODO: Replace with invoke('has_credentials', { provider })
	const status = await getProviderStatus(provider);
	return status.has_credentials;
}

/**
 * Set credentials for a provider
 * @param provider - Provider type
 * @param apiKey - API key to store
 */
export async function setCredentials(provider: ProviderType, apiKey: string): Promise<void> {
	// TODO: Replace with invoke('set_credentials', { provider, api_key: apiKey })
	console.log(`[stub] Setting credentials for ${provider}: ${apiKey.slice(0, 8)}...`);
}

/**
 * Get available models for all providers
 * @returns Array of model info
 */
export async function getModels(): Promise<ModelInfo[]> {
	// TODO: Replace with invoke('get_models')
	return [
		{
			id: 'claude-sonnet-4-20250514',
			display_name: 'Claude Sonnet 4',
			alias: 'sonnet',
			provider: 'Anthropic',
			is_default: true,
			description: 'Best balance of speed and intelligence',
		},
		{
			id: 'claude-opus-4-20250514',
			display_name: 'Claude Opus 4',
			alias: 'opus',
			provider: 'Anthropic',
			is_default: false,
			description: 'Most capable model for complex tasks',
		},
		{
			id: 'claude-3-5-haiku-20241022',
			display_name: 'Claude 3.5 Haiku',
			alias: 'haiku',
			provider: 'Anthropic',
			is_default: false,
			description: 'Fastest model for simple tasks',
		},
		{
			id: 'gpt-4o',
			display_name: 'GPT-4o',
			alias: 'gpt4o',
			provider: 'OpenAI',
			is_default: true,
			description: 'OpenAI flagship model',
		},
		{
			id: 'gpt-4o-mini',
			display_name: 'GPT-4o Mini',
			alias: 'gpt4o-mini',
			provider: 'OpenAI',
			is_default: false,
			description: 'Fast and affordable',
		},
	];
}
