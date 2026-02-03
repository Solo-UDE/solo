import { create } from "zustand";

import {
	getProviders,
	getActiveProvider,
	setActiveProvider as setActiveProviderBackend,
	getProviderStatus,
	setCredentials as setCredentialsBackend,
	getModels,
	startOAuthFlow as startOAuthFlowBackend,
	completeOAuthFlow as completeOAuthFlowBackend,
	waitForOAuthCallback,
	getAuthMethod,
	disconnectOAuth as disconnectOAuthBackend,
} from "../lib/backend";
import type {
	ProviderType,
	ProviderStatus,
	ModelInfo,
	OAuthMethod,
	AuthMethodInfo,
} from "../lib/backend";

interface ProviderState {
	// Available providers
	providers: string[];
	// Currently active provider
	activeProvider: string | null;
	// Provider status map
	providerStatus: Record<string, ProviderStatus>;
	// Available models
	models: ModelInfo[];
	// Selected model for the active provider
	selectedModel: string | null;
	// Loading state
	isLoading: boolean;
	// Error state
	error: string | null;
	// Initialization state
	isInitialized: boolean;
	// OAuth pending state per provider
	oauthPending: Record<string, boolean>;
	// Auth method info per provider
	authMethodInfo: Record<string, AuthMethodInfo>;
}

interface ProviderActions {
	initialize: () => Promise<void>;
	setActiveProvider: (provider: string) => Promise<void>;
	refreshProviderStatus: (provider: string) => Promise<void>;
	setCredentials: (provider: ProviderType, apiKey: string) => Promise<void>;
	setSelectedModel: (modelId: string) => void;
	clearError: () => void;
	// OAuth actions
	startOAuthFlow: (provider: string, method: OAuthMethod) => Promise<string>;
	completeOAuthFlow: (code: string, state: string) => Promise<void>;
	refreshAuthMethod: (provider: string) => Promise<void>;
	disconnectOAuth: (provider: string) => Promise<void>;
}

type ProviderStore = ProviderState & ProviderActions;

export const useProviderStore = create<ProviderStore>()((set, get) => ({
	providers: [],
	activeProvider: null,
	providerStatus: {},
	models: [],
	selectedModel: null,
	isLoading: false,
	error: null,
	isInitialized: false,
	oauthPending: {},
	authMethodInfo: {},

	initialize: async () => {
		if (get().isInitialized) return;

		set({ isLoading: true, error: null });
		try {
			// Fetch available providers
			const providers = await getProviders();

			// Fetch active provider
			const activeProvider = await getActiveProvider();

			// Fetch provider statuses
			const statusMap: Record<string, ProviderStatus> = {};
			for (const provider of providers) {
				const status = await getProviderStatus(provider);
				statusMap[provider] = status;
			}

			// Fetch all models
			const models = await getModels();

			// Set default selected model based on active provider
			const defaultModel = models.find(
				(m: ModelInfo) =>
					m.provider.toLowerCase() === activeProvider.toLowerCase() &&
					m.is_default
			);

			set({
				providers,
				activeProvider,
				providerStatus: statusMap,
				models,
				selectedModel: defaultModel?.id ?? null,
				isLoading: false,
				isInitialized: true,
			});
		} catch (error) {
			set({
				error: error instanceof Error ? error.message : String(error),
				isLoading: false,
			});
		}
	},

	setActiveProvider: async (provider: string) => {
		set({ isLoading: true, error: null });
		try {
			await setActiveProviderBackend(provider);

			// Update selected model to default for new provider
			const models = get().models;
			const defaultModel = models.find(
				(m) =>
					m.provider.toLowerCase() === provider.toLowerCase() && m.is_default
			);

			set({
				activeProvider: provider,
				selectedModel: defaultModel?.id ?? null,
				isLoading: false,
			});
		} catch (error) {
			set({
				error: error instanceof Error ? error.message : String(error),
				isLoading: false,
			});
		}
	},

	refreshProviderStatus: async (provider: string) => {
		try {
			const status = await getProviderStatus(provider);
			set((state) => ({
				providerStatus: {
					...state.providerStatus,
					[provider]: status,
				},
			}));
		} catch (error) {
			console.error(`Failed to refresh status for ${provider}:`, error);
		}
	},

	setCredentials: async (provider: ProviderType, apiKey: string) => {
		set({ isLoading: true, error: null });
		try {
			await setCredentialsBackend(provider, apiKey);

			// Refresh provider status
			const providerStr =
				provider === "Anthropic" ? "anthropic" : "openai";
			await get().refreshProviderStatus(providerStr);

			set({ isLoading: false });
		} catch (error) {
			set({
				error: error instanceof Error ? error.message : String(error),
				isLoading: false,
			});
			throw error;
		}
	},

	setSelectedModel: (modelId: string) => {
		set({ selectedModel: modelId });
	},

	clearError: () => {
		set({ error: null });
	},

	// OAuth actions
	startOAuthFlow: async (provider: string, method: OAuthMethod) => {
		set((state) => ({
			oauthPending: { ...state.oauthPending, [provider]: true },
			error: null,
		}));

		try {
			const result = await startOAuthFlowBackend(provider, method);

			// If using browser method, wait for the callback
			if (method === "browser") {
				// Start waiting for the callback in the background
				waitForOAuthCallback()
					.then(async ({ code, state: oauthState }) => {
						try {
							await get().completeOAuthFlow(code, oauthState);
						} catch (err) {
							console.error("OAuth completion failed:", err);
							set((state) => ({
								oauthPending: { ...state.oauthPending, [provider]: false },
								error: err instanceof Error ? err.message : String(err),
							}));
						}
					})
					.catch((err) => {
						console.error("OAuth callback failed:", err);
						set((state) => ({
							oauthPending: { ...state.oauthPending, [provider]: false },
							error: err instanceof Error ? err.message : String(err),
						}));
					});
			}

			return result.auth_url;
		} catch (error) {
			set((state) => ({
				oauthPending: { ...state.oauthPending, [provider]: false },
				error: error instanceof Error ? error.message : String(error),
			}));
			throw error;
		}
	},

	completeOAuthFlow: async (code: string, state: string) => {
		try {
			await completeOAuthFlowBackend(code, state);

			// Refresh auth method info for all providers
			const providers = get().providers;
			for (const provider of providers) {
				await get().refreshAuthMethod(provider);
				await get().refreshProviderStatus(provider);
			}

			// Clear pending state
			set({ oauthPending: {} });
		} catch (error) {
			set({
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	},

	refreshAuthMethod: async (provider: string) => {
		try {
			const info = await getAuthMethod(provider);
			set((state) => ({
				authMethodInfo: {
					...state.authMethodInfo,
					[provider]: info,
				},
			}));
		} catch (error) {
			console.error(`Failed to refresh auth method for ${provider}:`, error);
		}
	},

	disconnectOAuth: async (provider: string) => {
		set({ isLoading: true, error: null });
		try {
			await disconnectOAuthBackend(provider);
			await get().refreshAuthMethod(provider);
			await get().refreshProviderStatus(provider);
			set({ isLoading: false });
		} catch (error) {
			set({
				error: error instanceof Error ? error.message : String(error),
				isLoading: false,
			});
			throw error;
		}
	},
}));

// Selector hooks
export const useActiveProvider = (): string | null => {
	return useProviderStore((state) => state.activeProvider);
};

export const useProviders = (): string[] => {
	return useProviderStore((state) => state.providers);
};

export const useProviderStatus = (
	provider: string
): ProviderStatus | undefined => {
	return useProviderStore((state) => state.providerStatus[provider]);
};

export const useModels = (): ModelInfo[] => {
	return useProviderStore((state) => state.models);
};

export const useModelsForProvider = (provider: string): ModelInfo[] => {
	return useProviderStore((state) =>
		state.models.filter(
			(m) => m.provider.toLowerCase() === provider.toLowerCase()
		)
	);
};

export const useSelectedModel = (): string | null => {
	return useProviderStore((state) => state.selectedModel);
};

export const useProviderLoading = (): boolean => {
	return useProviderStore((state) => state.isLoading);
};

export const useProviderError = (): string | null => {
	return useProviderStore((state) => state.error);
};

export const useProviderInitialized = (): boolean => {
	return useProviderStore((state) => state.isInitialized);
};

export const useHasCredentials = (provider: string): boolean => {
	return useProviderStore(
		(state) => state.providerStatus[provider]?.has_credentials ?? false
	);
};

export const useOAuthPending = (provider: string): boolean => {
	return useProviderStore(
		(state) => state.oauthPending[provider] ?? false
	);
};

export const useAuthMethodInfo = (provider: string): AuthMethodInfo | undefined => {
	return useProviderStore((state) => state.authMethodInfo[provider]);
};
