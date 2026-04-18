import { create } from "zustand";

import {
	getProviders,
	getActiveProvider,
	setActiveProvider as setActiveProviderBackend,
	getProviderStatus,
	setCredentials as setCredentialsBackend,
	clearCredentials as clearCredentialsBackend,
	getModels,
	getAuthMethod,
	startOAuthFlow as startOAuthFlowBackend,
	disconnectOAuth as disconnectOAuthBackend,
	listProfiles as listProfilesBackend,
	setActiveProfile as setActiveProfileBackend,
	removeProfile as removeProfileBackend,
	signOutProfile as signOutProfileBackend,
} from "../lib/backend";
import type {
	ProviderType,
	ProviderStatus,
	ModelInfo,
	AuthMethodInfo,
	ProfileSummary,
} from "../lib/backend";

interface ProviderState {
	// Available providers
	providers: string[];
	// Currently active provider
	activeProvider: string | null;
	// Provider status map
	providerStatus: Record<string, ProviderStatus>;
	// Auth method info per provider
	authMethodInfo: Record<string, AuthMethodInfo>;
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
	// Profiles per provider.
	profiles: Record<string, ProfileSummary[]>;
	// Currently-active profile name per provider (empty string if none).
	activeProfile: Record<string, string>;
}

interface ProviderActions {
	initialize: () => Promise<void>;
	setActiveProvider: (provider: string) => Promise<void>;
	refreshProviderStatus: (provider: string) => Promise<void>;
	refreshAuthMethod: (provider: string) => Promise<void>;
	setCredentials: (provider: ProviderType, apiKey: string) => Promise<void>;
	setSelectedModel: (modelId: string) => void;
	clearError: () => void;
	clearCredentials: (provider: string) => Promise<void>;
	startOAuthFlow: (provider: string, method: string) => Promise<void>;
	disconnectOAuth: (provider: string) => Promise<void>;
	refreshProfiles: (provider: string) => Promise<void>;
	setActiveProfile: (provider: string, profileName: string) => Promise<void>;
	removeProfile: (provider: string, profileName: string) => Promise<void>;
	signOutProfile: (provider: string, profileName?: string) => Promise<void>;
}

type ProviderStore = ProviderState & ProviderActions;

export const useProviderStore = create<ProviderStore>()((set, get) => ({
	providers: [],
	activeProvider: null,
	providerStatus: {},
	authMethodInfo: {},
	models: [],
	selectedModel: null,
	isLoading: false,
	error: null,
	isInitialized: false,
	oauthPending: {},
	profiles: {},
	activeProfile: {},

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
			const profileMap: Record<string, ProfileSummary[]> = {};
			const activeProfileMap: Record<string, string> = {};
			for (const provider of providers) {
				const status = await getProviderStatus(provider);
				statusMap[provider] = status;

				// Load profiles (empty array is fine if none exist).
				try {
					const profs = await listProfilesBackend(provider);
					profileMap[provider] = profs;
					activeProfileMap[provider] = profs.find((p) => p.isActive)?.name ?? "";
				} catch (e) {
					console.warn(`listProfiles failed for ${provider}:`, e);
					profileMap[provider] = [];
					activeProfileMap[provider] = "";
				}
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
				profiles: profileMap,
				activeProfile: activeProfileMap,
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

	setSelectedModel: (modelId: string) => {
		set({ selectedModel: modelId });
	},

	clearError: () => {
		set({ error: null });
	},

	clearCredentials: async (provider: string) => {
		set({ isLoading: true, error: null });
		try {
			await clearCredentialsBackend(provider);
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

	startOAuthFlow: async (provider: string, method: string) => {
		set((state) => ({
			oauthPending: { ...state.oauthPending, [provider]: true },
		}));
		try {
			await startOAuthFlowBackend(provider, method as 'browser' | 'paste-code');
			await get().refreshProviderStatus(provider);
			await get().refreshAuthMethod(provider);
		} catch (error) {
			set({
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			set((state) => ({
				oauthPending: { ...state.oauthPending, [provider]: false },
			}));
		}
	},

	disconnectOAuth: async (provider: string) => {
		try {
			await disconnectOAuthBackend(provider);
			await get().refreshProviderStatus(provider);
			await get().refreshAuthMethod(provider);
		} catch (error) {
			set({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},

	refreshProfiles: async (provider: string) => {
		try {
			const profiles = await listProfilesBackend(provider);
			const active = profiles.find((p) => p.isActive)?.name ?? "";
			set((state) => ({
				profiles: { ...state.profiles, [provider]: profiles },
				activeProfile: { ...state.activeProfile, [provider]: active },
			}));
		} catch (error) {
			console.error(`Failed to refresh profiles for ${provider}:`, error);
		}
	},

	setActiveProfile: async (provider: string, profileName: string) => {
		try {
			await setActiveProfileBackend(provider, profileName);
			await get().refreshProfiles(provider);
			await get().refreshProviderStatus(provider);
		} catch (error) {
			set({
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	},

	removeProfile: async (provider: string, profileName: string) => {
		try {
			await removeProfileBackend(provider, profileName);
			await get().refreshProfiles(provider);
			await get().refreshProviderStatus(provider);
		} catch (error) {
			set({
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	},

	signOutProfile: async (provider: string, profileName?: string) => {
		try {
			await signOutProfileBackend(provider, profileName);
			await get().refreshProfiles(provider);
			await get().refreshProviderStatus(provider);
			await get().refreshAuthMethod(provider);
		} catch (error) {
			set({
				error: error instanceof Error ? error.message : String(error),
			});
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

export const useProviderProfiles = (provider: string): ProfileSummary[] => {
	return useProviderStore((state) => state.profiles[provider] ?? []);
};

export const useActiveProfile = (provider: string): string => {
	return useProviderStore((state) => state.activeProfile[provider] ?? "");
};
