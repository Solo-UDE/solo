/**
 * AITab - AI provider and behavior settings
 */

import { useCallback, useState, useEffect, useMemo } from 'react';
import { CheckCircle, AlertCircle, Loader2, Clock, Terminal, Sparkles } from 'lucide-react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useProviderStore, useOAuthPending } from '../../../stores/provider-store';
import { useShallow } from 'zustand/react/shallow';
import { SettingRow, SelectDropdown, ToggleSwitch, NumberInput, PasswordInput } from '../controls';
import { ClaudeLoginModal } from '../ClaudeLoginModal';
import type { ProviderType, AuthMethodInfo } from '../../../lib/backend';

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
 * Auth status indicator component
 */
function AuthStatus({
  authInfo,
  provider,
}: {
  authInfo: AuthMethodInfo | undefined;
  provider: string | null;
}) {
  if (!authInfo || authInfo.authType === 'none') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-600">
        <AlertCircle className="w-3.5 h-3.5" />
        Not configured
      </div>
    );
  }

  const isOAuth = authInfo.authType === 'o-auth' || authInfo.authType === 'claude-o-auth';

  // Determine the display text based on auth type and provider
  const getAuthDisplayText = () => {
    if (authInfo.authType === 'api-key') {
      return 'Connected via API Key';
    }
    if (authInfo.authType === 'claude-o-auth') {
      return 'Connected via Claude Code';
    }
    if (authInfo.authType === 'o-auth') {
      // For OpenAI OAuth, show "Connected via ChatGPT"
      if (provider === 'openai') {
        return 'Connected via ChatGPT';
      }
      return 'Connected via OAuth';
    }
    return 'Connected';
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle className="w-3.5 h-3.5" />
        <span>{getAuthDisplayText()}</span>
      </div>
      {isOAuth && authInfo.expiresInSeconds !== null && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          {formatExpiryTime(authInfo.expiresInSeconds)}
        </div>
      )}
    </div>
  );
}

export function AITab() {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isClaudeLoginOpen, setIsClaudeLoginOpen] = useState(false);

  // Provider store - use useShallow for stable references
  const {
    providers,
    activeProvider,
    isLoading,
    isInitialized,
    models: allModels,
    selectedModel,
    providerStatus: allProviderStatus,
    authMethodInfo,
  } = useProviderStore(
    useShallow((s) => ({
      providers: s.providers,
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

  const providerStatus = activeProvider ? allProviderStatus[activeProvider] : undefined;
  const currentAuthInfo = activeProvider ? authMethodInfo[activeProvider] : undefined;

  const initialize = useProviderStore((s) => s.initialize);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);
  const setCredentials = useProviderStore((s) => s.setCredentials);
  const setSelectedModel = useProviderStore((s) => s.setSelectedModel);
  const refreshAuthMethod = useProviderStore((s) => s.refreshAuthMethod);
  const startOAuthFlow = useProviderStore((s) => s.startOAuthFlow);
  const disconnectOAuth = useProviderStore((s) => s.disconnectOAuth);

  // Check if OAuth is pending for OpenAI
  const isOpenAIOAuthPending = useOAuthPending('openai');

  // Settings store (AI behavior)
  const streaming = useSettingsStore((s) => s.ai.streaming);
  const autoApproveTools = useSettingsStore((s) => s.ai.autoApproveTools);
  const maxTokens = useSettingsStore((s) => s.ai.maxTokens);
  const customApiUrl = useSettingsStore((s) => s.ai.customApiUrl);

  const setStreaming = useSettingsStore((s) => s.setStreaming);
  const setAutoApproveTools = useSettingsStore((s) => s.setAutoApproveTools);
  const setMaxTokens = useSettingsStore((s) => s.setMaxTokens);
  const setCustomApiUrl = useSettingsStore((s) => s.setCustomApiUrl);

  // Initialize provider store on mount
  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

  // Refresh auth method info when provider changes
  useEffect(() => {
    if (activeProvider && isInitialized) {
      refreshAuthMethod(activeProvider);
    }
  }, [activeProvider, isInitialized, refreshAuthMethod]);

  // Provider options - memoized to prevent new references
  const providerOptions = useMemo(
    () =>
      providers.map((p) => ({
        label: p.charAt(0).toUpperCase() + p.slice(1),
        value: p,
      })),
    [providers]
  );

  // Model options - memoized to prevent new references
  const modelOptions = useMemo(
    () =>
      models.map((m) => ({
        label: m.display_name,
        value: m.id,
      })),
    [models]
  );

  const handleProviderChange = useCallback(
    (provider: string) => {
      setActiveProvider(provider);
      setApiKeyInput('');
    },
    [setActiveProvider]
  );

  const handleApiKeySubmit = useCallback(async () => {
    if (!activeProvider || !apiKeyInput.trim()) return;

    setIsSaving(true);
    try {
      const providerType: ProviderType =
        activeProvider === 'anthropic' ? 'Anthropic' : 'OpenAI';
      await setCredentials(providerType, apiKeyInput.trim());
      await refreshAuthMethod(activeProvider);
      setApiKeyInput('');
    } catch (err) {
      console.error('Failed to save API key:', err);
    } finally {
      setIsSaving(false);
    }
  }, [activeProvider, apiKeyInput, setCredentials, refreshAuthMethod]);

  const handleClaudeLoginSuccess = useCallback(() => {
    // Refresh auth method to pick up new Claude Code credentials
    if (activeProvider === 'anthropic') {
      refreshAuthMethod(activeProvider);
    }
  }, [activeProvider, refreshAuthMethod]);

  const handleOpenAIOAuthLogin = useCallback(async () => {
    try {
      await startOAuthFlow('openai', 'browser');
      // The OAuth flow will complete via callback and update state automatically
    } catch (err) {
      console.error('Failed to start OpenAI OAuth flow:', err);
    }
  }, [startOAuthFlow]);

  const handleOpenAIDisconnect = useCallback(async () => {
    try {
      await disconnectOAuth('openai');
      await refreshAuthMethod('openai');
    } catch (err) {
      console.error('Failed to disconnect OpenAI OAuth:', err);
    }
  }, [disconnectOAuth, refreshAuthMethod]);

  const hasCredentials = providerStatus?.has_credentials ?? false;
  const isClaudeCodeAuth = currentAuthInfo?.authType === 'claude-o-auth';
  const isOpenAIOAuth = activeProvider === 'openai' && currentAuthInfo?.authType === 'o-auth';

  if (!isInitialized && isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Provider Section */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Provider
        </h3>
        <div className="divide-y divide-border">
          <SettingRow
            label="Active Provider"
            description="AI service to use for completions"
          >
            <SelectDropdown
              value={activeProvider ?? ''}
              options={providerOptions}
              onChange={handleProviderChange}
              disabled={isLoading}
            />
          </SettingRow>

          {/* Authentication Section */}
          <div className="py-3">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-medium text-foreground">Authentication</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {activeProvider === 'anthropic'
                    ? 'Sign in with Claude or use an API key'
                    : 'Sign in with ChatGPT or use an API key'}
                </div>
              </div>
              <AuthStatus authInfo={currentAuthInfo} provider={activeProvider} />
            </div>

            {/* Sign in with Claude button - only for Anthropic when not already connected via Claude Code */}
            {activeProvider === 'anthropic' && !isClaudeCodeAuth && (
              <div className="mb-4">
                <button
                  type="button"
                  onClick={() => setIsClaudeLoginOpen(true)}
                  className="w-full h-10 px-4 bg-[#d97706] hover:bg-[#b45309] text-white rounded-lg text-sm font-medium active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2"
                >
                  <Terminal className="w-4 h-4" />
                  Sign in with Claude
                </button>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">or use API key</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              </div>
            )}

            {/* Sign in with ChatGPT button - only for OpenAI when not already connected via OAuth */}
            {activeProvider === 'openai' && !isOpenAIOAuth && (
              <div className="mb-4">
                <button
                  type="button"
                  onClick={handleOpenAIOAuthLogin}
                  disabled={isOpenAIOAuthPending}
                  className="w-full h-10 px-4 bg-[#10a37f] hover:bg-[#0d8c6d] text-white rounded-lg text-sm font-medium active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isOpenAIOAuthPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Waiting for sign in...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Sign in with ChatGPT
                    </>
                  )}
                </button>
                <div className="text-xs text-muted-foreground mt-2 text-center">
                  For ChatGPT Pro/Plus subscribers (free API access)
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">or use API key</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              </div>
            )}

            {/* Note about OpenAI OAuth - show when connected via ChatGPT */}
            {isOpenAIOAuth && (
              <div className="mb-3 p-3 bg-muted/40 rounded-lg text-xs text-muted-foreground">
                <p className="mb-2">Connected via ChatGPT account.</p>
                <button
                  type="button"
                  onClick={handleOpenAIDisconnect}
                  className="text-destructive hover:underline"
                >
                  Disconnect
                </button>
                <span className="mx-1">or</span>
                <span>add an API key below to override.</span>
              </div>
            )}

            {/* Note about Claude Code OAuth - show when connected via Claude Code */}
            {isClaudeCodeAuth && (
              <div className="mb-3 p-3 bg-muted/40 rounded-lg text-xs text-muted-foreground">
                <p className="mb-2">Using credentials from Claude Code.</p>
                <button
                  type="button"
                  onClick={() => setIsClaudeLoginOpen(true)}
                  className="text-primary hover:underline"
                >
                  Sign in again
                </button>
                <span className="mx-1">or</span>
                <span>add an API key below to override.</span>
              </div>
            )}

            {/* API Key Input */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted-foreground">
                  Stored securely in your system keychain
                </div>
                {hasCredentials && currentAuthInfo?.authType === 'api-key' && (
                  <div className="flex items-center gap-1.5 text-xs text-green-600">
                    <CheckCircle className="w-3.5 h-3.5" />
                    API Key saved
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <PasswordInput
                  value={apiKeyInput}
                  onChange={setApiKeyInput}
                  placeholder={hasCredentials ? '••••••••••••••••' : 'Enter API key...'}
                  disabled={isSaving}
                />
                <button
                  type="button"
                  onClick={handleApiKeySubmit}
                  disabled={!apiKeyInput.trim() || isSaving}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>

          {models.length > 0 && (
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
          )}
        </div>
      </div>

      {/* Behavior Section */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
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
            label="Auto-approve Tools"
            description="Let AI execute tools without confirmation"
          >
            <ToggleSwitch checked={autoApproveTools} onChange={setAutoApproveTools} />
          </SettingRow>
        </div>
      </div>

      {/* Advanced Section */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Advanced
        </h3>
        <div className="divide-y divide-border">
          <div className="py-3">
            <div className="text-sm font-medium text-foreground mb-1">Custom API URL</div>
            <div className="text-xs text-muted-foreground mb-2">
              Override the default API endpoint (leave empty for default)
            </div>
            <input
              type="text"
              value={customApiUrl}
              onChange={(e) => setCustomApiUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
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
