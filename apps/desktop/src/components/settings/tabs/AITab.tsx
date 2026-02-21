/**
 * AITab - AI provider and behavior settings
 * Shows both Anthropic and OpenAI providers as separate cards
 */

import { useCallback, useState, useEffect, useMemo } from 'react';
import { CheckCircle, WarningCircle, CircleNotch, Clock, Terminal, Sparkle, ArrowClockwise, XCircle, ShieldCheck, TreeStructure } from '@phosphor-icons/react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useProviderStore, useOAuthPending } from '../../../stores/provider-store';
import { useShallow } from 'zustand/react/shallow';
import { SettingRow, SelectDropdown, ToggleSwitch, NumberInput, PasswordInput } from '../controls';
import { ClaudeLoginModal } from '../ClaudeLoginModal';
import { verifyClaudeSetup } from '../../../lib/backend';
import { getSetupCommands, setSetupCommands } from '../../../lib/tauri/worktree';
import { toast } from 'sonner';
import type { ProviderType, AuthMethodInfo, ClaudeSetupStatus } from '../../../lib/backend';

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
      <div className="flex items-center gap-1.5 text-xs text-amber-600">
        <WarningCircle className="w-3.5 h-3.5" />
        Not configured
      </div>
    );
  }

  const isOAuth = authInfo.authType === 'o-auth' || authInfo.authType === 'claude-o-auth';

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle className="w-3.5 h-3.5" />
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
}: ProviderCardProps) {
  const isAnthropic = provider === 'anthropic';
  const isClaudeCodeAuth = authInfo?.authType === 'claude-o-auth';
  const isOpenAIOAuth = provider === 'openai' && authInfo?.authType === 'o-auth';
  const isSoloOAuth = authInfo?.credentialSource === 'solo-oauth';
  const isConnectedViaOAuth = isClaudeCodeAuth || isOpenAIOAuth || isSoloOAuth;

  const providerConfig = isAnthropic
    ? {
        name: 'Anthropic (Claude)',
        icon: Terminal,
        iconColor: 'text-[#d97706]',
        buttonColor: 'bg-[#d97706] hover:bg-[#b45309]',
        buttonText: 'Sign in with Claude Code',
        buttonSubtext: 'For free API access via Claude Code CLI',
      }
    : {
        name: 'OpenAI',
        icon: Sparkle,
        iconColor: 'text-[#10a37f]',
        buttonColor: 'bg-[#10a37f] hover:bg-[#0d8c6d]',
        buttonText: 'Sign in with ChatGPT',
        buttonSubtext: 'For ChatGPT Pro/Plus subscribers (free API)',
      };

  const Icon = providerConfig.icon;

  return (
    <div
      className={`p-4 rounded-none border bg-card/50 space-y-4 transition-all duration-200 ${
        isActive
          ? 'border-primary/50 ring-2 ring-primary/20'
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
            className={`w-full h-10 px-4 ${providerConfig.buttonColor} text-white rounded-none text-sm font-medium active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed`}
          >
            {isOAuthPending ? (
              <>
                <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />
                Waiting for sign in...
              </>
            ) : (
              <>
                <Icon className="w-4 h-4" />
                {providerConfig.buttonText}
              </>
            )}
          </button>
          <div className="text-xs text-muted-foreground mt-2 text-center">
            {providerConfig.buttonSubtext}
          </div>

          {/* Divider with "or" */}
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>
        </div>
      )}

      {/* Connected notice — shown for OAuth and API key connections */}
      {isConnectedViaOAuth && (
        <div className="p-3 bg-muted/40 rounded-none text-xs text-muted-foreground">
          <p className="mb-2">
            {isClaudeCodeAuth
              ? 'Using credentials from Claude Code.'
              : 'Connected via ChatGPT account.'}
          </p>
          {isClaudeCodeAuth ? (
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

      {/* API key connected notice — only when connected via API key (not OAuth) */}
      {!isConnectedViaOAuth && hasCredentials && authInfo?.authType === 'api-key' && (
        <div className="p-3 bg-muted/40 rounded-none text-xs text-muted-foreground">
          <p className="mb-2">Connected via API key.</p>
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
            <div className="flex items-center gap-1.5 text-xs text-green-600">
              <CheckCircle className="w-3.5 h-3.5" />
              Saved
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
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
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-none text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

    </div>
  );
}

/**
 * Diagnostic panel showing Claude Code CLI setup status
 */
function ClaudeSetupDiagnostic() {
  const [status, setStatus] = useState<ClaudeSetupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await verifyClaudeSetup();
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Run on mount
  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const StatusRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono">{children}</span>
    </div>
  );

  const StatusIcon = ({ ok }: { ok: boolean | null | undefined }) => {
    if (ok === null || ok === undefined) {
      return <span className="text-muted-foreground">—</span>;
    }
    return ok ? (
      <CheckCircle className="w-3.5 h-3.5 text-green-600 inline" />
    ) : (
      <XCircle className="w-3.5 h-3.5 text-red-500 inline" />
    );
  };

  return (
    <div className="p-4 rounded-none border border-border bg-card/50 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Claude Code Setup</span>
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <ArrowClockwise className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Checking...' : 'Recheck'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-500 bg-red-500/10 px-2 py-1 rounded-none">
          {error}
        </div>
      )}

      {status && (
        <div className="divide-y divide-border/50">
          <StatusRow label="CLI installed">
            <span className="flex items-center gap-1.5">
              <StatusIcon ok={status.cliInstalled} />
              {status.cliPath ?? 'Not found'}
            </span>
          </StatusRow>
          <StatusRow label="Credentials">
            <span className="flex items-center gap-1.5">
              <StatusIcon ok={status.credentialsFound} />
              {status.credentialSource ?? 'None'}
            </span>
          </StatusRow>
          {status.requiresCliMode && (
            <StatusRow label="Mode">
              <span className="flex items-center gap-1.5">
                <StatusIcon ok={status.cliModeAvailable} />
                {status.cliModeAvailable ? 'CLI Mode (Subscription)' : 'CLI required'}
              </span>
            </StatusRow>
          )}
          <StatusRow label="Token expiry">
            <span className="flex items-center gap-1.5">
              <StatusIcon ok={status.credentialsFound ? !status.tokenExpired : null} />
              {status.tokenExpiresInSeconds != null
                ? status.tokenExpiresInSeconds > 0
                  ? formatExpiryTime(status.tokenExpiresInSeconds)
                  : 'Expired'
                : '—'}
            </span>
          </StatusRow>
          {status.scopes && (
            <StatusRow label="Scopes">
              <span className="text-[10px] text-muted-foreground">
                {status.scopes.join(', ')}
              </span>
            </StatusRow>
          )}
          <StatusRow label="Status">
            <span className="flex items-center gap-1.5">
              <StatusIcon ok={status.apiVerified} />
              {status.apiVerified === true
                ? status.requiresCliMode ? 'Ready (via CLI)' : 'Working'
                : status.apiVerified === false
                  ? 'Failed'
                  : 'Not checked'}
            </span>
          </StatusRow>
          {status.error && (
            <div className="pt-1.5 text-[10px] text-red-500/80 break-all">
              {status.error}
            </div>
          )}
          {status.requiresCliMode && !status.cliInstalled && (
            <div className="pt-2 text-[10px] text-amber-600 bg-amber-500/10 px-2 py-1.5 rounded-none">
              Subscription tokens require the Claude CLI. Install with:<br />
              <code className="text-[10px]">npm i -g @anthropic-ai/claude-code</code>
            </div>
          )}
        </div>
      )}

      {!status && !loading && !error && (
        <div className="text-xs text-muted-foreground text-center py-2">
          Click Recheck to verify setup
        </div>
      )}
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
  const refreshAuthMethod = useProviderStore((s) => s.refreshAuthMethod);
  const startOAuthFlow = useProviderStore((s) => s.startOAuthFlow);
  const disconnectOAuth = useProviderStore((s) => s.disconnectOAuth);
  const clearCredentials = useProviderStore((s) => s.clearCredentials);

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
      refreshAuthMethod('anthropic');
      refreshAuthMethod('openai');
    }
  }, [isInitialized, refreshAuthMethod]);

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
    refreshAuthMethod('anthropic');
  }, [refreshAuthMethod]);

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
      await refreshAuthMethod(provider);
    } catch (err) {
      console.error(`Failed to disconnect ${provider}:`, err);
    }
  }, [authMethodInfo, clearCredentials, disconnectOAuth, refreshAuthMethod]);

  if (!isInitialized && isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <CircleNotch weight="bold" className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Providers Section */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Providers
        </h3>
        <div className="space-y-3">
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
          />
        </div>
      </div>

      {/* Claude Code Setup Diagnostic */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Diagnostics
        </h3>
        <ClaudeSetupDiagnostic />
      </div>

      {/* Model Selection - show when there are models for the active provider */}
      {models.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
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
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Behavior
        </h3>
        <div className="divide-y divide-border">
          <SettingRow
            label="Max Tokens"
            description="Maximum response length (1024-32768)"
          >
            <NumberInput
              value={maxTokens}
              min={1024}
              max={32768}
              step={256}
              onChange={setMaxTokens}
            />
          </SettingRow>

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
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <TreeStructure className="w-3.5 h-3.5" />
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
            className="w-full h-24 px-3 py-2 bg-background border border-border rounded-none text-xs text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y disabled:opacity-50"
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
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
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
