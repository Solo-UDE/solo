/**
 * AITab - AI provider and behavior settings
 */

import { useCallback, useState, useEffect, useMemo } from 'react';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useProviderStore } from '../../../stores/provider-store';
import { useShallow } from 'zustand/react/shallow';
import { SettingRow, SelectDropdown, ToggleSwitch, NumberInput, PasswordInput } from '../controls';
import type { ProviderType } from '../../../lib/backend';

export function AITab() {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Provider store - use useShallow for stable references
  const {
    providers,
    activeProvider,
    isLoading,
    isInitialized,
    models: allModels,
    selectedModel,
    providerStatus: allProviderStatus,
  } = useProviderStore(
    useShallow((s) => ({
      providers: s.providers,
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

  const providerStatus = activeProvider ? allProviderStatus[activeProvider] : undefined;

  const initialize = useProviderStore((s) => s.initialize);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);
  const setCredentials = useProviderStore((s) => s.setCredentials);
  const setSelectedModel = useProviderStore((s) => s.setSelectedModel);

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
      await setCredentials(activeProvider as ProviderType, apiKeyInput.trim());
      setApiKeyInput('');
    } catch (err) {
      console.error('Failed to save API key:', err);
    } finally {
      setIsSaving(false);
    }
  }, [activeProvider, apiKeyInput, setCredentials]);

  const hasCredentials = providerStatus?.has_credentials ?? false;

  if (!isInitialized && isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Provider Section */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
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

          <div className="py-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-medium text-foreground">API Key</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Stored securely in your system keychain
                </div>
              </div>
              {hasCredentials ? (
                <div className="flex items-center gap-1.5 text-xs text-green-600">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Connected
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-amber-600">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Not configured
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
                className="px-3 py-2 bg-primary text-primary-foreground rounded-none text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
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
            label="Auto-approve Tools"
            description="Let AI execute tools without confirmation"
          >
            <ToggleSwitch checked={autoApproveTools} onChange={setAutoApproveTools} />
          </SettingRow>
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
    </div>
  );
}
