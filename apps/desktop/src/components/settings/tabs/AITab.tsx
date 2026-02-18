/**
 * AITab - AI provider and behavior settings
 * Shows provider cards with API key inputs and model selection
 */

import { useCallback, useState, useEffect, useMemo } from 'react';
import { CheckCircle, WarningCircle, CircleNotch, Terminal, Sparkle } from '@phosphor-icons/react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useProviderStore } from '../../../stores/provider-store';
import { useShallow } from 'zustand/react/shallow';
import { SettingRow, SelectDropdown, ToggleSwitch, NumberInput, PasswordInput } from '../controls';
import type { ProviderType } from '../../../lib/backend';

/**
 * Connection status badge for provider cards
 */
function ConnectionStatusBadge({ hasCredentials }: { hasCredentials: boolean }) {
  if (!hasCredentials) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-600">
        <WarningCircle className="w-3.5 h-3.5" />
        Not configured
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-green-600">
      <CheckCircle className="w-3.5 h-3.5" />
      Connected
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
  onDisconnect?: () => void;
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
  onDisconnect,
  apiKeyInput,
  onApiKeyChange,
  onApiKeySave,
  isSaving,
  hasCredentials,
}: ProviderCardProps) {
  const isAnthropic = provider === 'anthropic';

  const providerConfig = isAnthropic
    ? {
        name: 'Anthropic (Claude)',
        icon: Terminal,
        iconColor: 'text-[#d97706]',
      }
    : {
        name: 'OpenAI',
        icon: Sparkle,
        iconColor: 'text-[#10a37f]',
      };

  const Icon = providerConfig.icon;

  return (
    <div
      className={`p-4 rounded-xl border bg-card/50 space-y-4 transition-[border-color,box-shadow] duration-200 ${
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
        <ConnectionStatusBadge hasCredentials={hasCredentials} />
      </div>

      {/* Divider */}
      <div className="h-px bg-border/60" />

      {/* Connected notice — shown when API key is set */}
      {hasCredentials && (
        <div className="p-3 bg-muted/40 rounded-lg text-xs text-muted-foreground">
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
          {hasCredentials && (
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
            placeholder={hasCredentials ? '••••••••••••••••' : 'Enter API key...'}
            disabled={isSaving}
          />
          <button
            type="button"
            onClick={onApiKeySave}
            disabled={!apiKeyInput.trim() || isSaving}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
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

  // Provider store - use useShallow for stable references
  const {
    activeProvider,
    isLoading,
    isInitialized,
    models: allModels,
    selectedModel,
    providerStatus: allProviderStatus,
  } = useProviderStore(
    useShallow((s) => ({
      activeProvider: s.activeProvider,
      isLoading: s.isLoading,
      isInitialized: s.isInitialized,
      models: s.models,
      selectedModel: s.selectedModel,
      providerStatus: s.providerStatus,
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
  const clearCredentials = useProviderStore((s) => s.clearCredentials);

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
      setApiKeyInputs((prev) => ({ ...prev, [provider]: '' }));
    } catch (err) {
      console.error(`Failed to save ${provider} API key:`, err);
    } finally {
      setSavingProvider(null);
    }
  }, [apiKeyInputs, setCredentials]);

  // Handle API key input change for a specific provider
  const handleApiKeyChange = useCallback((provider: string, value: string) => {
    setApiKeyInputs((prev) => ({ ...prev, [provider]: value }));
  }, []);

  const handleDisconnect = useCallback(async (provider: 'anthropic' | 'openai') => {
    try {
      await clearCredentials(provider);
    } catch (err) {
      console.error(`Failed to disconnect ${provider}:`, err);
    }
  }, [clearCredentials]);

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
        <h3 className="text-xs font-semibold text-muted-foreground mb-3">
          Providers
        </h3>
        <div className="space-y-3">
          {/* Anthropic Card */}
          <ProviderCard
            provider="anthropic"
            isActive={activeProvider === 'anthropic'}
            onSetActive={() => setActiveProvider('anthropic')}
            onDisconnect={() => handleDisconnect('anthropic')}
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
            onDisconnect={() => handleDisconnect('openai')}
            apiKeyInput={apiKeyInputs.openai}
            onApiKeyChange={(value) => handleApiKeyChange('openai', value)}
            onApiKeySave={() => handleApiKeySubmit('openai')}
            isSaving={savingProvider === 'openai'}
            hasCredentials={allProviderStatus['openai']?.has_credentials ?? false}
          />
        </div>
      </div>

      {/* Model Selection - show when there are models for the active provider */}
      {models.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-3">
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
        <h3 className="text-xs font-semibold text-muted-foreground mb-4">
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
        <h3 className="text-xs font-semibold text-muted-foreground mb-4">
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
              className="w-full px-3 py-2 bg-muted/40 border-none rounded-lg text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
