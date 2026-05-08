/**
 * AITab - AI provider and behavior settings
 * Shows both Anthropic and OpenAI providers as separate cards
 */

import { useCallback, useState, useEffect, useMemo } from 'react';
import { CheckCircledIcon, ExclamationTriangleIcon, CrossCircledIcon, ReloadIcon, StarFilledIcon } from '@radix-ui/react-icons';
import { Loader2, Clock, Terminal, ShieldCheck, Network } from 'lucide-react';
import { ListSkeleton } from '../../ui/skeletons';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useProviderStore, useOAuthPending } from '../../../stores/provider-store';
import { useShallow } from 'zustand/react/shallow';
import { SettingRow, SelectDropdown, ToggleSwitch, NumberInput, PasswordInput } from '../controls';
import { ClaudeLoginModal } from '../ClaudeLoginModal';
import { verifyProviderModel } from '../../../lib/backend';
import { getSetupCommands, setSetupCommands } from '../../../lib/tauri/worktree';
import { toast } from 'sonner';
import { ProfileRow } from '../ProfileRow';
import type { ProviderType, AuthMethodInfo, ModelInfo, ProfileSummary, ProviderModelDiagnostic } from '../../../lib/backend';

/**
 * Format seconds into a human-readable string
 */
function formatExpiryTime(seconds: number): string {
  if (seconds <= 0) return 'Expired';
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
  return `${Math.floor(seconds / 86400)} days`;
}

/**
 * Connection status badge for provider cards
 */
function ConnectionStatusBadge({
  authInfo,
}: {
  authInfo: AuthMethodInfo | undefined;
}) {
  if (!authInfo || authInfo.authType === 'none') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-warning">
        <ExclamationTriangleIcon className="w-3.5 h-3.5" />
        Not configured
      </div>
    );
  }

  const isOAuth = authInfo.authType === 'o-auth' || authInfo.authType === 'claude-o-auth';

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs text-success">
        <CheckCircledIcon className="w-3.5 h-3.5" />
        Connected
      </div>
      {isOAuth && authInfo.expiresInSeconds !== null && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          {formatExpiryTime(Number(authInfo.expiresInSeconds))}
        </div>
      )}
    </div>
  );
}

/**
 * Provider card component for displaying individual provider configuration
 */
interface ProviderCardProps {
  provider: 'anthropic' | 'openai';
  isActive: boolean;
  onSetActive: () => void;
  authInfo: AuthMethodInfo | undefined;
  onOAuthLogin: () => void;
  onDisconnect?: () => void;
  isOAuthPending: boolean;
  apiKeyInput: string;
  onApiKeyChange: (value: string) => void;
  onApiKeySave: () => void;
  isSaving: boolean;
  hasCredentials: boolean;
  profiles?: ProfileSummary[];
  onSetActiveProfile?: (name: string) => Promise<void>;
  onRemoveProfile?: (name: string) => Promise<void>;
  onAddAnotherAccount?: () => Promise<void>;
}

function ProviderCard({
  provider,
  isActive,
  onSetActive,
  authInfo,
  onOAuthLogin,
  onDisconnect,
  isOAuthPending,
  apiKeyInput,
  onApiKeyChange,
  onApiKeySave,
  isSaving,
  hasCredentials,
  profiles,
  onSetActiveProfile,
  onRemoveProfile,
  onAddAnotherAccount,
}: ProviderCardProps) {
  const isAnthropic = provider === 'anthropic';
  const isClaudeCodeAuth = authInfo?.authType === 'claude-o-auth';
  const isCodexCliAuth =
    provider === 'openai' &&
    (authInfo?.credentialSource === 'codex-oauth-file' ||
      authInfo?.credentialSource === 'codex-o-auth-file');
  const isOpenAIOAuth = provider === 'openai' && authInfo?.authType === 'o-auth';
  const isSoloOAuth = authInfo?.credentialSource === 'solo-oauth';
  const isConnectedViaOAuth = isClaudeCodeAuth || isOpenAIOAuth || isSoloOAuth || isCodexCliAuth;

  const providerConfig = isAnthropic
    ? {
        name: 'Anthropic (Claude)',
        icon: Terminal,
        iconColor: 'text-[#d97706]',
        buttonColor: 'bg-[#d97706] hover:bg-[#b45309]',
        buttonText: 'Sign in with Claude Code',
        buttonSubtext: 'Use your Claude Code membership',
      }
    : {
        name: 'OpenAI',
        icon: StarFilledIcon,
        iconColor: 'text-[#10a37f]',
        buttonColor: 'bg-[#10a37f] hover:bg-[#0d8c6d]',
        buttonText: 'Sign in with ChatGPT',
        buttonSubtext: 'Use your ChatGPT membership',
      };

  const Icon = providerConfig.icon;

  return (
    <div
      className={`p-3 rounded-none border bg-card/60 space-y-3 transition-colors duration-150 ${
        isActive
          ? 'border-primary/50 shadow-[0_0_0_1px_rgba(16,163,127,0.14)]'
          : 'border-border hover:border-border/80'
      }`}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Radio button for active selection */}
          <button
            type="button"
            onClick={onSetActive}
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
              isActive
                ? 'border-primary bg-primary'
                : 'border-muted-foreground/40 hover:border-muted-foreground'
            }`}
          >
            {isActive && <div className="w-2 h-2 rounded-full bg-primary-foreground" />}
          </button>

          {/* Provider icon and name */}
          <Icon className={`w-5 h-5 ${providerConfig.iconColor}`} />
          <span className="text-sm font-medium text-foreground">{providerConfig.name}</span>
        </div>

        {/* Connection status */}
        <ConnectionStatusBadge authInfo={authInfo} />
      </div>

      {/* Divider */}
      <div className="h-px bg-border/60" />

      {/* OAuth Button - show when not connected via OAuth */}
      {!isConnectedViaOAuth && (
        <div>
          <button
            type="button"
            onClick={onOAuthLogin}
            disabled={isOAuthPending}
            className={`w-full h-9 px-3 ${providerConfig.buttonColor} text-white rounded-none text-sm font-medium active:scale-[0.96] transition-colors duration-150 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed`}
          >
            {isOAuthPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Waiting for sign in...
              </>
            ) : (
              <>
                <Icon className="w-4 h-4" />
                {providerConfig.buttonText}
              </>
            )}
          </button>
          <div className="text-[11px] text-muted-foreground mt-1.5 text-center">
            {providerConfig.buttonSubtext}
          </div>

          {/* Divider with "or" */}
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>
        </div>
      )}

      {/* Connected notice — shown for OAuth and API key connections */}
      {isConnectedViaOAuth && (
        <div className="p-2.5 bg-muted/40 rounded-none text-xs text-muted-foreground">
          <p className="mb-1.5">
            {isClaudeCodeAuth
              ? 'Using credentials from Claude Code.'
              : isCodexCliAuth
                ? 'Using credentials from Codex CLI.'
                : 'Connected via ChatGPT account.'}
          </p>
          {isClaudeCodeAuth || isCodexCliAuth ? (
            <>
              <button
                type="button"
                onClick={onOAuthLogin}
                className="text-primary hover:underline"
              >
                Sign in again
              </button>
              <span className="mx-1">·</span>
              <button
                type="button"
                onClick={onDisconnect}
                className="text-destructive hover:underline"
              >
                Disconnect
              </button>
              <span className="mx-1">or</span>
              <span>add an API key below to override.</span>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onDisconnect}
                className="text-destructive hover:underline"
              >
                Disconnect
              </button>
              <span className="mx-1">or</span>
              <span>add an API key below to override.</span>
            </>
          )}
        </div>
      )}

      {/* Multi-account profile sub-list */}
      {profiles && profiles.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">Accounts</div>
          <div className="space-y-1.5">
            {profiles.map((p) => (
              <ProfileRow
                key={p.name}
                profile={p}
                onSetActive={() => {
                  void onSetActiveProfile?.(p.name);
                }}
                onRemove={() => {
                  void onRemoveProfile?.(p.name);
                }}
              />
            ))}
          </div>
          {onAddAnotherAccount && (
            <button
              type="button"
              onClick={() => void onAddAnotherAccount()}
              className="w-full text-xs text-primary hover:text-primary/80 py-1.5 border border-dashed border-border hover:border-primary/40 rounded-none transition-colors"
            >
              + Add another account
            </button>
          )}
        </div>
      )}

      {/* API key connected notice — only when connected via API key (not OAuth) */}
      {!isConnectedViaOAuth && hasCredentials && authInfo?.authType === 'api-key' && (
        <div className="p-2.5 bg-muted/40 rounded-none text-xs text-muted-foreground">
          <p className="mb-1.5">Connected via API key.</p>
          <button
            type="button"
            onClick={onDisconnect}
            className="text-destructive hover:underline"
          >
            Remove API key
          </button>
        </div>
      )}

      {/* API Key Input */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-muted-foreground">API Key</div>
          {hasCredentials && authInfo?.authType === 'api-key' && (
            <div className="flex items-center gap-1.5 text-xs text-success">
              <CheckCircledIcon className="w-3.5 h-3.5" />
              Saved
            </div>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <PasswordInput
            value={apiKeyInput}
            onChange={onApiKeyChange}
            placeholder={hasCredentials && authInfo?.authType === 'api-key' ? '••••••••••••••••' : 'Enter API key...'}
            disabled={isSaving}
          />
          <button
            type="button"
            onClick={onApiKeySave}
            disabled={!apiKeyInput.trim() || isSaving}
            className="h-9 px-3 bg-primary text-primary-foreground rounded-none text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.96] transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

    </div>
  );
}

function ProviderDiagnostics({
  activeProvider,
  selectedModel,
  models,
}: {
  activeProvider: string | null;
  selectedModel: string | null;
  models: ModelInfo[];
}) {
  const providerOptions = useMemo(
    () => [
      { label: 'Anthropic', value: 'anthropic' },
      { label: 'OpenAI', value: 'openai' },
    ],
    []
  );
  const [provider, setProvider] = useState<string>(activeProvider ?? 'anthropic');
  const [model, setModel] = useState<string>(selectedModel ?? '');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ProviderModelDiagnostic | null>(null);

  const providerModels = useMemo(
    () => models.filter((m) => m.provider.toLowerCase() === provider.toLowerCase()),
    [models, provider]
  );

  const modelOptions = useMemo(
    () => providerModels.map((m) => ({ label: m.display_name, value: m.id })),
    [providerModels]
  );

  useEffect(() => {
    if (activeProvider) {
      setProvider(activeProvider);
    }
  }, [activeProvider]);

  useEffect(() => {
    const currentModelIsValid = providerModels.some((m) => m.id === model);
    const selectedModelIsValid = providerModels.some((m) => m.id === selectedModel);
    const nextModel = selectedModelIsValid
      ? selectedModel
      : providerModels.find((m) => m.is_default)?.id ?? providerModels[0]?.id ?? '';

    if (!currentModelIsValid && nextModel && nextModel !== model) {
      setModel(nextModel);
      setResult(null);
    }
  }, [model, providerModels, selectedModel]);

  const runCheck = useCallback(async () => {
    if (!model) return;

    setChecking(true);
    setResult(null);
    try {
      const diagnostic = await verifyProviderModel(provider, model);
      setResult(diagnostic);
    } catch (err) {
      setResult({
        provider: provider as ProviderType,
        model,
        ok: false,
        authenticated: false,
        credentialSource: null,
        status: 'error',
        message: 'Diagnostic failed',
        latencyMs: null,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setChecking(false);
    }
  }, [model, provider]);

  const resultTone = result?.ok
    ? 'text-success'
    : result
      ? 'text-destructive'
      : 'text-muted-foreground';

  return (
    <div className="rounded-none border border-border bg-card/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Provider Check</div>
            <div className="text-[11px] text-muted-foreground truncate">
              Validate credentials against a selected model.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={checking || !model}
          className="h-9 px-3 rounded-none bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.96] transition-colors flex items-center gap-1.5"
        >
          <ReloadIcon className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
          {checking ? 'Checking' : 'Check'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-2">
        <SelectDropdown
          value={provider}
          options={providerOptions}
          onChange={(nextProvider) => {
            setProvider(nextProvider);
            setResult(null);
          }}
          disabled={checking}
          className="w-full min-w-0 h-9"
        />
        <SelectDropdown
          value={model}
          options={modelOptions}
          onChange={(nextModel) => {
            setModel(nextModel);
            setResult(null);
          }}
          disabled={checking || modelOptions.length === 0}
          className="w-full min-w-0 h-9"
        />
      </div>

      <div className="min-h-9 rounded-none bg-muted/35 px-3 py-2 text-xs">
        {checking ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Running a live model check...
          </div>
        ) : result ? (
          <div className="space-y-1.5">
            <div className={`flex items-center gap-2 ${resultTone}`}>
              {result.ok ? (
                <CheckCircledIcon className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <CrossCircledIcon className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="font-medium text-foreground">{result.message}</span>
              {result.latencyMs != null && (
                <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                  {result.latencyMs} ms
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>Source: {result.credentialSource ?? 'none'}</span>
              <span>Model: {result.model}</span>
            </div>
            {result.error && (
              <div className="text-[11px] text-destructive/80 break-words">{result.error}</div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5" />
            Pick a provider and model, then run a check.
          </div>
        )}
      </div>
    </div>
  );
}

export function AITab() {
  // Per-provider API key input state
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({
    anthropic: '',
    openai: '',
  });
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [isClaudeLoginOpen, setIsClaudeLoginOpen] = useState(false);

  // Provider store - use useShallow for stable references
  const {
    activeProvider,
    isLoading,
    isInitialized,
    models: allModels,
    selectedModel,
    providerStatus: allProviderStatus,
    authMethodInfo,
  } = useProviderStore(
    useShallow((s) => ({
      activeProvider: s.activeProvider,
      isLoading: s.isLoading,
      isInitialized: s.isInitialized,
      models: s.models,
      selectedModel: s.selectedModel,
      providerStatus: s.providerStatus,
      authMethodInfo: s.authMethodInfo,
    }))
  );

  // Derive filtered models with useMemo to avoid new array references
  const models = useMemo(
    () =>
      activeProvider
        ? allModels.filter((m) => m.provider.toLowerCase() === activeProvider.toLowerCase())
        : [],
    [allModels, activeProvider]
  );

  const initialize = useProviderStore((s) => s.initialize);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);
  const setCredentials = useProviderStore((s) => s.setCredentials);
  const setSelectedModel = useProviderStore((s) => s.setSelectedModel);
  const refreshProviderStatus = useProviderStore((s) => s.refreshProviderStatus);
  const refreshAuthMethod = useProviderStore((s) => s.refreshAuthMethod);
  const startOAuthFlow = useProviderStore((s) => s.startOAuthFlow);
  const disconnectOAuth = useProviderStore((s) => s.disconnectOAuth);
  const clearCredentials = useProviderStore((s) => s.clearCredentials);
  const providerProfiles = useProviderStore((s) => s.profiles);
  const refreshProfiles = useProviderStore((s) => s.refreshProfiles);
  const setActiveProfileAction = useProviderStore((s) => s.setActiveProfile);
  const removeProfileAction = useProviderStore((s) => s.removeProfile);

  // Check if OAuth is pending for each provider
  const isAnthropicOAuthPending = useOAuthPending('anthropic');
  const isOpenAIOAuthPending = useOAuthPending('openai');

  // Settings store (AI behavior)
  const streaming = useSettingsStore((s) => s.ai.streaming);
  const autoApproveTools = useSettingsStore((s) => s.ai.autoApproveTools);
  const toolPermissionPolicy = useSettingsStore((s) => s.ai.toolPermissionPolicy);
  const maxTokens = useSettingsStore((s) => s.ai.maxTokens);
  const customApiUrl = useSettingsStore((s) => s.ai.customApiUrl);

  const setStreaming = useSettingsStore((s) => s.setStreaming);
  const setAutoApproveTools = useSettingsStore((s) => s.setAutoApproveTools);
  const setToolPermissionPolicy = useSettingsStore((s) => s.setToolPermissionPolicy);
  const setMaxTokens = useSettingsStore((s) => s.setMaxTokens);
  const setCustomApiUrl = useSettingsStore((s) => s.setCustomApiUrl);

  // Worktree setup commands state
  const [setupCommandsText, setSetupCommandsText] = useState('');
  const [isLoadingSetup, setIsLoadingSetup] = useState(false);
  const [isSavingSetup, setIsSavingSetup] = useState(false);

  useEffect(() => {
    setIsLoadingSetup(true);
    getSetupCommands()
      .then((config) => {
        setSetupCommandsText(config.commands.join('\n'));
      })
      .catch(() => {
        // No commands configured yet
      })
      .finally(() => setIsLoadingSetup(false));
  }, []);

  const handleSaveSetupCommands = useCallback(async () => {
    setIsSavingSetup(true);
    try {
      const commands = setupCommandsText.split('\n').filter((line) => line.trim());
      await setSetupCommands({ commands });
      toast.success('Setup commands saved');
    } catch (err) {
      toast.error('Failed to save setup commands', { description: String(err) });
    } finally {
      setIsSavingSetup(false);
    }
  }, [setupCommandsText]);

  // Initialize provider store on mount
  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

  // Refresh auth method info for both providers on init
  useEffect(() => {
    if (isInitialized) {
      refreshProviderStatus('anthropic');
      refreshProviderStatus('openai');
      refreshAuthMethod('anthropic');
      refreshAuthMethod('openai');
    }
  }, [isInitialized, refreshAuthMethod, refreshProviderStatus]);

  // Preload profiles for both providers on mount
  useEffect(() => {
    refreshProfiles('anthropic');
    refreshProfiles('openai');
  }, [refreshProfiles]);

  // Model options - memoized to prevent new references
  const modelOptions = useMemo(
    () =>
      models.map((m) => ({
        label: m.display_name,
        value: m.id,
      })),
    [models]
  );

  // Handle API key submission for a specific provider
  const handleApiKeySubmit = useCallback(async (provider: 'anthropic' | 'openai') => {
    const apiKey = apiKeyInputs[provider];
    if (!apiKey?.trim()) return;

    setSavingProvider(provider);
    try {
      const providerType: ProviderType = provider === 'anthropic' ? 'anthropic' : 'openai';
      await setCredentials(providerType, apiKey.trim());
      await refreshAuthMethod(provider);
      setApiKeyInputs((prev) => ({ ...prev, [provider]: '' }));
    } catch (err) {
      console.error(`Failed to save ${provider} API key:`, err);
    } finally {
      setSavingProvider(null);
    }
  }, [apiKeyInputs, setCredentials, refreshAuthMethod]);

  // Handle API key input change for a specific provider
  const handleApiKeyChange = useCallback((provider: string, value: string) => {
    setApiKeyInputs((prev) => ({ ...prev, [provider]: value }));
  }, []);

  const handleClaudeLoginSuccess = useCallback(() => {
    // Refresh auth method to pick up new Claude Code credentials
    refreshProviderStatus('anthropic');
    refreshAuthMethod('anthropic');
  }, [refreshAuthMethod, refreshProviderStatus]);

  const handleOpenAIOAuthLogin = useCallback(async () => {
    try {
      await startOAuthFlow('openai', 'browser');
      // The OAuth flow will complete via callback and update state automatically
    } catch (err) {
      console.error('Failed to start OpenAI OAuth flow:', err);
    }
  }, [startOAuthFlow]);

  const handleDisconnect = useCallback(async (provider: 'anthropic' | 'openai') => {
    try {
      const authType = authMethodInfo[provider]?.authType;
      if (authType === 'api-key') {
        await clearCredentials(provider);
      } else if (authType === 'o-auth' || authType === 'claude-o-auth') {
        await disconnectOAuth(provider);
      }
      await refreshProviderStatus(provider);
      await refreshAuthMethod(provider);
    } catch (err) {
      console.error(`Failed to disconnect ${provider}:`, err);
    }
  }, [authMethodInfo, clearCredentials, disconnectOAuth, refreshAuthMethod, refreshProviderStatus]);

  if (!isInitialized && isLoading) {
    return (
      <div className="py-4">
        <ListSkeleton rows={5} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Providers Section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Providers
        </h3>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {/* Anthropic Card */}
          <ProviderCard
            provider="anthropic"
            isActive={activeProvider === 'anthropic'}
            onSetActive={() => setActiveProvider('anthropic')}
            authInfo={authMethodInfo['anthropic']}
            onOAuthLogin={() => setIsClaudeLoginOpen(true)}
            onDisconnect={() => handleDisconnect('anthropic')}
            isOAuthPending={isAnthropicOAuthPending}
            apiKeyInput={apiKeyInputs.anthropic}
            onApiKeyChange={(value) => handleApiKeyChange('anthropic', value)}
            onApiKeySave={() => handleApiKeySubmit('anthropic')}
            isSaving={savingProvider === 'anthropic'}
            hasCredentials={allProviderStatus['anthropic']?.has_credentials ?? false}
            profiles={providerProfiles.anthropic ?? []}
            onSetActiveProfile={async (name) => {
              await setActiveProfileAction('anthropic', name);
            }}
            onRemoveProfile={async (name) => {
              await removeProfileAction('anthropic', name);
            }}
            onAddAnotherAccount={() => {
              setIsClaudeLoginOpen(true);
              return Promise.resolve();
            }}
          />

          {/* OpenAI Card */}
          <ProviderCard
            provider="openai"
            isActive={activeProvider === 'openai'}
            onSetActive={() => setActiveProvider('openai')}
            authInfo={authMethodInfo['openai']}
            onOAuthLogin={handleOpenAIOAuthLogin}
            onDisconnect={() => handleDisconnect('openai')}
            isOAuthPending={isOpenAIOAuthPending}
            apiKeyInput={apiKeyInputs.openai}
            onApiKeyChange={(value) => handleApiKeyChange('openai', value)}
            onApiKeySave={() => handleApiKeySubmit('openai')}
            isSaving={savingProvider === 'openai'}
            hasCredentials={allProviderStatus['openai']?.has_credentials ?? false}
            profiles={providerProfiles.openai ?? []}
            onSetActiveProfile={async (name) => {
              await setActiveProfileAction('openai', name);
            }}
            onRemoveProfile={async (name) => {
              await removeProfileAction('openai', name);
            }}
            onAddAnotherAccount={handleOpenAIOAuthLogin}
          />
        </div>
      </div>

      {/* Provider Diagnostics */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Diagnostics
        </h3>
        <ProviderDiagnostics
          activeProvider={activeProvider}
          selectedModel={selectedModel}
          models={allModels}
        />
      </div>

      {/* Model Selection - show when there are models for the active provider */}
      {models.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Model
          </h3>
          <div className="divide-y divide-border">
            <SettingRow
              label="Default Model"
              description="Model to use for AI features"
            >
              <SelectDropdown
                value={selectedModel ?? ''}
                options={modelOptions}
                onChange={setSelectedModel}
                disabled={isLoading}
              />
            </SettingRow>
          </div>
        </div>
      )}

      {/* Behavior Section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Behavior
        </h3>
        <div className="divide-y divide-border">
          {(() => {
            // Slider ceiling = active model's declared output-token capacity.
            // Server-side clamp in Claude Code still enforces the model's true upperLimit.
            const activeModel = allModels.find((m) => m.id === selectedModel);
            const modelMax = activeModel?.max_output_tokens ?? 32_768;
            const clampedValue = Math.min(maxTokens, modelMax);
            return (
              <SettingRow
                label="Max Output Tokens"
                description={`Cap per response (1024–${modelMax.toLocaleString()}${activeModel ? ` for ${activeModel.display_name}` : ''})`}
              >
                <NumberInput
                  value={clampedValue}
                  min={1024}
                  max={modelMax}
                  step={256}
                  onChange={setMaxTokens}
                />
              </SettingRow>
            );
          })()}

          <SettingRow
            label="Stream Responses"
            description="Show AI responses as they generate"
          >
            <ToggleSwitch checked={streaming} onChange={setStreaming} />
          </SettingRow>

          <SettingRow
            label="Tool Permissions"
            description="Control when tools need manual approval"
          >
            <SelectDropdown
              value={toolPermissionPolicy}
              options={[
                { label: 'Ask for all tools', value: 'ask-all' },
                { label: 'Smart (tier-based)', value: 'smart' },
                { label: 'Auto-approve all', value: 'approve-all' },
              ]}
              onChange={setToolPermissionPolicy}
            />
          </SettingRow>

          {toolPermissionPolicy !== 'approve-all' && (
            <SettingRow
              label="Auto-approve Tools"
              description="Let AI execute tools without confirmation"
            >
              <ToggleSwitch checked={autoApproveTools} onChange={setAutoApproveTools} />
            </SettingRow>
          )}
        </div>
      </div>

      {/* Worktree Setup Section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Network className="w-3.5 h-3.5" />
          Worktree Setup
        </h3>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Shell commands to run after creating a new worktree (one per line)
          </div>
          <textarea
            value={setupCommandsText}
            onChange={(e) => setSetupCommandsText(e.target.value)}
            disabled={isLoadingSetup}
            placeholder={'bun install\nbun run build'}
            className="w-full h-24 px-3 py-2 bg-background border border-border rounded-none text-xs text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y disabled:opacity-50 scrollbar-none"
          />
          <button
            onClick={handleSaveSetupCommands}
            disabled={isSavingSetup}
            className="h-8 px-4 text-xs bg-primary text-primary-foreground rounded-none hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSavingSetup ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Advanced Section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Advanced
        </h3>
        <div className="divide-y divide-border">
          <div className="py-4">
            <div className="text-sm font-medium text-foreground mb-1">Custom API URL</div>
            <div className="text-xs text-muted-foreground mb-3">
              Override the default API endpoint (leave empty for default)
            </div>
            <input
              type="text"
              value={customApiUrl}
              onChange={(e) => setCustomApiUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full px-3 py-2 bg-background border border-border rounded-none text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
      </div>

      {/* Claude Login Modal */}
      <ClaudeLoginModal
        isOpen={isClaudeLoginOpen}
        onClose={() => setIsClaudeLoginOpen(false)}
        onSuccess={handleClaudeLoginSuccess}
      />
    </div>
  );
}
