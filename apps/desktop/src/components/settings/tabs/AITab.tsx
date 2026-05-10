/**
 * AITab - provider, model, and agent behavior settings.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock,
  KeyRound,
  Loader2,
  LogIn,
  Network,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  IconButton,
  Input,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@solo/ui';
import { ListSkeleton } from '../../ui/skeletons';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useProviderStore, useOAuthPending } from '../../../stores/provider-store';
import { useShallow } from 'zustand/react/shallow';
import { NumberInput, PasswordInput, SelectDropdown } from '../controls';
import { ClaudeLoginModal } from '../ClaudeLoginModal';
import { verifyProviderModel } from '../../../lib/backend';
import { getSetupCommands, setSetupCommands } from '../../../lib/tauri/worktree';
import { toast } from 'sonner';
import { ProfileRow } from '../ProfileRow';
import { AnthropicLogo, GeminiLogo, OpenAILogo } from '../../icons';
import { cn } from '../../../lib/utils';
import type {
  AuthMethodInfo,
  ModelInfo,
  ProfileSummary,
  ProviderModelDiagnostic,
  ProviderType,
} from '../../../lib/backend';

type AiProviderId = 'anthropic' | 'openai' | 'gemini';
type ModelCheckState = {
  checking: boolean;
  result: ProviderModelDiagnostic | null;
};

const PROVIDER_IDS: AiProviderId[] = ['anthropic', 'openai', 'gemini'];

const PROVIDER_META = {
  anthropic: {
    label: 'Claude',
    vendor: 'Anthropic',
    authLabel: 'Claude Code',
    logo: AnthropicLogo,
    accentClass: 'text-amber-500',
  },
  openai: {
    label: 'OpenAI',
    vendor: 'OpenAI',
    authLabel: 'ChatGPT',
    logo: OpenAILogo,
    accentClass: 'text-emerald-500',
  },
  gemini: {
    label: 'Gemini',
    vendor: 'Google',
    authLabel: 'API key',
    logo: GeminiLogo,
    accentClass: 'text-sky-500',
  },
} as const;

function formatExpiryTime(seconds: number): string {
  if (seconds <= 0) return 'Expired';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Number(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString();
}

function providerName(provider: string): string {
  return PROVIDER_META[provider as AiProviderId]?.label ?? provider;
}

function isOAuthAuth(authInfo?: AuthMethodInfo): boolean {
  return authInfo?.authType === 'o-auth' || authInfo?.authType === 'claude-o-auth';
}

function isConnected(authInfo: AuthMethodInfo | undefined, hasCredentials: boolean): boolean {
  return Boolean(authInfo?.isAuthenticated || authInfo?.authType === 'api-key' || hasCredentials);
}

function authSourceLabel(provider: AiProviderId, authInfo?: AuthMethodInfo, hasCredentials = false): string {
  if (!authInfo && !hasCredentials) return 'Not connected';
  if (authInfo?.authType === 'claude-o-auth') return 'Claude Code';
  if (authInfo?.authType === 'o-auth') {
    if (authInfo.credentialSource === 'codex-o-auth-file' || authInfo.credentialSource === 'codex-oauth-file') {
      return 'Codex CLI';
    }
    return provider === 'openai' ? 'ChatGPT' : 'OAuth';
  }
  if (authInfo?.authType === 'api-key' || hasCredentials) return 'API key';
  return 'Not connected';
}

function ModelCheckAction({
  modelName,
  check,
  disabled,
  onCheck,
}: {
  modelName: string;
  check?: ModelCheckState;
  disabled: boolean;
  onCheck: () => void;
}) {
  const result = check?.result;
  const checking = check?.checking ?? false;
  const label = checking
    ? `Checking ${modelName}`
    : result?.ok
      ? `${modelName} is ready`
      : result
        ? `${modelName} check failed`
        : `Check ${modelName}`;
  const detail = result?.error ?? result?.message ?? 'Run a live credential and model check.';

  const icon = checking ? (
    <Loader2 className="animate-spin" />
  ) : result?.ok ? (
    <CheckCircle2 />
  ) : result ? (
    <XCircle />
  ) : (
    <ShieldCheck />
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          variant={result ? 'muted' : 'ghost'}
          size="md"
          label={label}
          disabled={disabled || checking}
          onClick={onCheck}
          className={cn(
            "relative text-muted-foreground transition-[background-color,color,border-color,transform] before:absolute before:-inset-1.5 before:content-[''] active:scale-[0.96]",
            !result && 'opacity-65 hover:opacity-100',
            result?.ok && 'text-success hover:text-success',
            result && !result.ok && 'text-destructive hover:text-destructive',
          )}
        >
          {icon}
        </IconButton>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="max-w-[240px] space-y-1">
          <div className="font-medium">{label}</div>
          <div className="text-muted-foreground">{detail}</div>
          {result?.latencyMs != null ? (
            <div className="tabular-nums text-muted-foreground">{result.latencyMs} ms</div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function ProviderStatusBadge({
  provider,
  authInfo,
  hasCredentials,
}: {
  provider: AiProviderId;
  authInfo?: AuthMethodInfo;
  hasCredentials: boolean;
}) {
  const connected = isConnected(authInfo, hasCredentials);
  const source = authSourceLabel(provider, authInfo, hasCredentials);

  if (!connected) {
    return (
      <Badge variant="warning" size="sm" className="gap-1">
        <AlertTriangle className="size-3" />
        Needs key
      </Badge>
    );
  }

  return (
    <Badge variant="success" size="sm" className="gap-1">
      <CheckCircle2 className="size-3" />
      {source}
    </Badge>
  );
}

function SectionDisclosure({
  title,
  icon,
  summary,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-[10px] border border-border/60 bg-background/45 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-[background-color] hover:bg-muted/35"
          >
            <span className="flex size-7 items-center justify-center rounded-md bg-muted/50 text-muted-foreground">
              {icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{title}</span>
              {summary ? (
                <span className="block truncate text-[11px] text-muted-foreground">{summary}</span>
              ) : null}
            </span>
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-150',
                open && 'rotate-180',
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/55 px-3 py-3">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function CompactSettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(180px,auto)] sm:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{label}</div>
        {description ? <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</div> : null}
      </div>
      <div className="min-w-0 sm:justify-self-end">{children}</div>
    </div>
  );
}

function ModelRow({
  model,
  selected,
  check,
  disabled,
  onSelect,
  onCheck,
}: {
  model: ModelInfo;
  selected: boolean;
  check?: ModelCheckState;
  disabled: boolean;
  onSelect: (model: ModelInfo) => void;
  onCheck: (model: ModelInfo) => void;
}) {
  const provider = model.provider as AiProviderId;
  const meta = PROVIDER_META[provider];
  const Logo = meta.logo;

  return (
    <div
      className={cn(
        'group grid grid-cols-[minmax(0,1fr)_36px_36px] items-center gap-2 px-3 py-2 transition-[background-color,box-shadow] duration-150',
        selected ? 'bg-primary/5 shadow-[inset_2px_0_0_var(--primary)]' : 'hover:bg-muted/30',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/45 ring-1 ring-border/35">
          <Logo size={14} className={meta.accentClass} />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{model.display_name}</span>
            {selected ? (
              <span className="size-1.5 shrink-0 rounded-full bg-primary ring-4 ring-primary/10" />
            ) : null}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{providerName(model.provider)}</span>
            <span className="text-border">/</span>
            <span>{meta.vendor}</span>
            <span className="text-border">/</span>
            <span className="tabular-nums">{formatTokenCount(model.context_window)} context</span>
            <span className="text-border">/</span>
            <span className="tabular-nums">{formatTokenCount(model.max_output_tokens)} output</span>
          </div>
        </div>
      </div>

      <div className="flex justify-self-end">
        <ModelCheckAction
          modelName={model.display_name}
          check={check}
          disabled={disabled}
          onCheck={() => onCheck(model)}
        />
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex justify-self-end">
            <Switch
              size="md"
              checked={selected}
              disabled={disabled}
              aria-label={`Use ${model.display_name}`}
              onCheckedChange={(checked) => {
                if (checked) onSelect(model);
              }}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">Use this model</TooltipContent>
      </Tooltip>
    </div>
  );
}

function CredentialRow({
  provider,
  authInfo,
  hasCredentials,
  profiles,
  apiKeyInput,
  isSaving,
  isOAuthPending,
  onApiKeyChange,
  onApiKeySave,
  onOAuthLogin,
  onDisconnect,
  onSetActiveProfile,
  onRemoveProfile,
  onAddAnotherAccount,
}: {
  provider: AiProviderId;
  authInfo?: AuthMethodInfo;
  hasCredentials: boolean;
  profiles: ProfileSummary[];
  apiKeyInput: string;
  isSaving: boolean;
  isOAuthPending: boolean;
  onApiKeyChange: (value: string) => void;
  onApiKeySave: () => void;
  onOAuthLogin?: () => void;
  onDisconnect: () => void;
  onSetActiveProfile?: (name: string) => Promise<void>;
  onRemoveProfile?: (name: string) => Promise<void>;
  onAddAnotherAccount?: () => Promise<void>;
}) {
  const meta = PROVIDER_META[provider];
  const Logo = meta.logo;
  const hasOAuthLogin = provider !== 'gemini';
  const connected = isConnected(authInfo, hasCredentials);
  const oauth = isOAuthAuth(authInfo);
  const source = authSourceLabel(provider, authInfo, hasCredentials);
  const expiresIn = oauth && authInfo?.expiresInSeconds != null ? Number(authInfo.expiresInSeconds) : null;

  return (
    <div className="grid gap-3 border-t border-border/50 py-3 first:border-t-0 first:pt-0 last:pb-0 lg:grid-cols-[150px_minmax(0,1fr)]">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/45 ring-1 ring-border/35">
          <Logo size={15} className={meta.accentClass} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{meta.label}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <ProviderStatusBadge provider={provider} authInfo={authInfo} hasCredentials={hasCredentials} />
            {expiresIn != null ? (
              <Badge variant="secondary" size="sm" className="gap-1">
                <Clock className="size-3" />
                {formatExpiryTime(expiresIn)}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-w-0 space-y-2">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
          <PasswordInput
            value={apiKeyInput}
            onChange={onApiKeyChange}
            placeholder={hasCredentials && authInfo?.authType === 'api-key' ? 'Saved API key' : `${meta.vendor} API key`}
            disabled={isSaving}
          />
          <Button
            variant="primary"
            size="lg"
            loading={isSaving}
            disabled={!apiKeyInput.trim() || isSaving}
            onClick={onApiKeySave}
          >
            Save
          </Button>
          {connected ? (
            <IconButton
              variant="ghost"
              size="lg"
              label={`Disconnect ${meta.label}`}
              onClick={onDisconnect}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 />
            </IconButton>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CircleDot className="size-3" />
            {source}
          </span>
          {hasOAuthLogin && onOAuthLogin ? (
            <Button
              variant="outline"
              size="sm"
              loading={isOAuthPending}
              onClick={onOAuthLogin}
              leadingIcon={!isOAuthPending ? <LogIn /> : undefined}
            >
              {oauth ? 'Sign in again' : meta.authLabel}
            </Button>
          ) : null}
          {onAddAnotherAccount && profiles.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => void onAddAnotherAccount()}>
              Add account
            </Button>
          ) : null}
        </div>

        {profiles.length > 0 ? (
          <div className="grid gap-1.5 pt-1">
            {profiles.map((profile) => (
              <ProfileRow
                key={profile.name}
                profile={profile}
                onSetActive={() => {
                  void onSetActiveProfile?.(profile.name);
                }}
                onRemove={() => {
                  void onRemoveProfile?.(profile.name);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AITab() {
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<AiProviderId, string>>({
    anthropic: '',
    openai: '',
    gemini: '',
  });
  const [savingProvider, setSavingProvider] = useState<AiProviderId | null>(null);
  const [isClaudeLoginOpen, setIsClaudeLoginOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [showAllModels, setShowAllModels] = useState(false);
  const [checks, setChecks] = useState<Record<string, ModelCheckState>>({});
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [behaviorOpen, setBehaviorOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    })),
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

  const isAnthropicOAuthPending = useOAuthPending('anthropic');
  const isOpenAIOAuthPending = useOAuthPending('openai');

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

  const [setupCommandsText, setSetupCommandsText] = useState('');
  const [isLoadingSetup, setIsLoadingSetup] = useState(false);
  const [isSavingSetup, setIsSavingSetup] = useState(false);

  const activeModel = useMemo(
    () => allModels.find((model) => model.id === selectedModel) ?? null,
    [allModels, selectedModel],
  );

  const visibleProviders = useMemo(
    () =>
      PROVIDER_IDS.filter((provider) => allProviderStatus[provider] || authMethodInfo[provider] || allModels.some((model) => model.provider === provider)),
    [allModels, allProviderStatus, authMethodInfo],
  );

  const connectedCount = useMemo(
    () =>
      PROVIDER_IDS.filter((provider) =>
        isConnected(authMethodInfo[provider], allProviderStatus[provider]?.has_credentials ?? false),
      ).length,
    [allProviderStatus, authMethodInfo],
  );

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return allModels;

    return allModels.filter((model) => {
      const provider = providerName(model.provider);
      return [
        model.display_name,
        model.id,
        model.alias,
        model.description,
        provider,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [allModels, modelSearch]);

  const visibleModels = useMemo(
    () => (showAllModels || modelSearch.trim() ? filteredModels : filteredModels.slice(0, 8)),
    [filteredModels, modelSearch, showAllModels],
  );

  useEffect(() => {
    setIsLoadingSetup(true);
    getSetupCommands()
      .then((config) => {
        setSetupCommandsText(config.commands.join('\n'));
      })
      .catch(() => {
        // Empty setup commands are valid.
      })
      .finally(() => setIsLoadingSetup(false));
  }, []);

  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [initialize, isInitialized]);

  useEffect(() => {
    if (isInitialized) {
      PROVIDER_IDS.forEach((provider) => {
        void refreshProviderStatus(provider);
        void refreshAuthMethod(provider);
      });
    }
  }, [isInitialized, refreshAuthMethod, refreshProviderStatus]);

  useEffect(() => {
    PROVIDER_IDS.forEach((provider) => {
      void refreshProfiles(provider);
    });
  }, [refreshProfiles]);

  const handleRefreshProviders = useCallback(async () => {
    await Promise.all(
      PROVIDER_IDS.flatMap((provider) => [
        refreshProviderStatus(provider),
        refreshAuthMethod(provider),
        refreshProfiles(provider),
      ]),
    );
    toast.success('Providers refreshed');
  }, [refreshAuthMethod, refreshProfiles, refreshProviderStatus]);

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

  const handleApiKeySubmit = useCallback(async (provider: AiProviderId) => {
    const apiKey = apiKeyInputs[provider];
    if (!apiKey?.trim()) return;

    setSavingProvider(provider);
    try {
      await setCredentials(provider, apiKey.trim());
      await refreshProviderStatus(provider);
      await refreshAuthMethod(provider);
      setApiKeyInputs((prev) => ({ ...prev, [provider]: '' }));
      toast.success(`${PROVIDER_META[provider].label} API key saved`);
    } catch (err) {
      toast.error(`Failed to save ${PROVIDER_META[provider].label} key`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSavingProvider(null);
    }
  }, [apiKeyInputs, refreshAuthMethod, refreshProviderStatus, setCredentials]);

  const handleApiKeyChange = useCallback((provider: AiProviderId, value: string) => {
    setApiKeyInputs((prev) => ({ ...prev, [provider]: value }));
  }, []);

  const handleClaudeLoginSuccess = useCallback(() => {
    void refreshProviderStatus('anthropic');
    void refreshAuthMethod('anthropic');
    void refreshProfiles('anthropic');
  }, [refreshAuthMethod, refreshProfiles, refreshProviderStatus]);

  const handleOpenAIOAuthLogin = useCallback(async () => {
    try {
      await startOAuthFlow('openai', 'browser');
    } catch (err) {
      toast.error('Failed to start OpenAI login', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [startOAuthFlow]);

  const handleDisconnect = useCallback(async (provider: AiProviderId) => {
    try {
      const authType = authMethodInfo[provider]?.authType;
      if (authType === 'o-auth' || authType === 'claude-o-auth') {
        await disconnectOAuth(provider);
      } else if (authType === 'api-key' || allProviderStatus[provider]?.has_credentials) {
        await clearCredentials(provider);
      }
      await refreshProviderStatus(provider);
      await refreshAuthMethod(provider);
      await refreshProfiles(provider);
    } catch (err) {
      toast.error(`Failed to disconnect ${PROVIDER_META[provider].label}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [
    allProviderStatus,
    authMethodInfo,
    clearCredentials,
    disconnectOAuth,
    refreshAuthMethod,
    refreshProfiles,
    refreshProviderStatus,
  ]);

  const handleSelectModel = useCallback(async (model: ModelInfo) => {
    const provider = model.provider as AiProviderId;
    try {
      if (activeProvider !== provider) {
        await setActiveProvider(provider);
      }
      setSelectedModel(model.id);
    } catch (err) {
      toast.error(`Failed to switch to ${model.display_name}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [activeProvider, setActiveProvider, setSelectedModel]);

  const handleCheckModel = useCallback(async (model: ModelInfo) => {
    setChecks((prev) => ({
      ...prev,
      [model.id]: { checking: true, result: null },
    }));

    try {
      const result = await verifyProviderModel(model.provider, model.id);
      setChecks((prev) => ({
        ...prev,
        [model.id]: { checking: false, result },
      }));
    } catch (err) {
      setChecks((prev) => ({
        ...prev,
        [model.id]: {
          checking: false,
          result: {
            provider: model.provider as ProviderType,
            model: model.id,
            ok: false,
            authenticated: false,
            credentialSource: null,
            status: 'error',
            message: 'Diagnostic failed',
            latencyMs: null,
            error: err instanceof Error ? err.message : String(err),
          },
        },
      }));
    }
  }, []);

  if (!isInitialized && isLoading) {
    return (
      <div className="py-4">
        <ListSkeleton rows={5} />
      </div>
    );
  }

  const modelMax = activeModel?.max_output_tokens ?? 32_768;
  const clampedMaxTokens = Math.min(maxTokens, modelMax);
  const hiddenModelCount = Math.max(filteredModels.length - visibleModels.length, 0);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        <div className="rounded-[10px] border border-border/60 bg-card/70 px-3 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.05)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/15">
                <Zap className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">Model providers</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {activeModel ? `${activeModel.display_name} active` : 'No active model selected'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" size="sm">
                {connectedCount}/{PROVIDER_IDS.length} connected
              </Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    variant="outline"
                    size="md"
                    label="Refresh providers"
                    onClick={() => void handleRefreshProviders()}
                  >
                    <RefreshCw />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent side="top">Refresh providers</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className="rounded-[10px] border border-border/60 bg-background/45 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex flex-col gap-2 border-b border-border/55 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Models</h3>
                <p className="text-[11px] text-muted-foreground">{filteredModels.length} available across providers</p>
              </div>
              {activeModel ? (
                <Badge variant="outline" size="sm" className="max-w-[220px] truncate">
                  {activeModel.display_name}
                </Badge>
              ) : null}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="provider-model-search"
                size="sm"
                value={modelSearch}
                onChange={(event) => setModelSearch(event.target.value)}
                placeholder="Search models"
                className="pl-8"
              />
            </div>
          </div>

          <div className="divide-y divide-border/50">
            {visibleModels.length > 0 ? (
              visibleModels.map((model) => (
                <ModelRow
                  key={`${model.provider}:${model.id}`}
                  model={model}
                  selected={selectedModel === model.id}
                  check={checks[model.id]}
                  disabled={isLoading}
                  onSelect={(nextModel) => void handleSelectModel(nextModel)}
                  onCheck={(nextModel) => void handleCheckModel(nextModel)}
                />
              ))
            ) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No models match the search.</div>
            )}
          </div>

          {hiddenModelCount > 0 || showAllModels ? (
            <div className="border-t border-border/55 px-3 py-2">
              <Button
                variant="link"
                size="sm"
                onClick={() => setShowAllModels((value) => !value)}
                className="px-0"
              >
                {showAllModels ? 'View fewer models' : `View all models (${hiddenModelCount} more)`}
              </Button>
            </div>
          ) : null}
        </div>

        <SectionDisclosure
          title="API Keys"
          icon={<KeyRound className="size-4" />}
          summary={`${connectedCount}/${PROVIDER_IDS.length} providers connected`}
          open={apiKeysOpen}
          onOpenChange={setApiKeysOpen}
        >
          {visibleProviders.map((provider) => (
            <CredentialRow
              key={provider}
              provider={provider}
              authInfo={authMethodInfo[provider]}
              hasCredentials={allProviderStatus[provider]?.has_credentials ?? false}
              profiles={providerProfiles[provider] ?? []}
              apiKeyInput={apiKeyInputs[provider]}
              isSaving={savingProvider === provider}
              isOAuthPending={
                provider === 'anthropic'
                  ? isAnthropicOAuthPending
                  : provider === 'openai'
                    ? isOpenAIOAuthPending
                    : false
              }
              onApiKeyChange={(value) => handleApiKeyChange(provider, value)}
              onApiKeySave={() => void handleApiKeySubmit(provider)}
              onOAuthLogin={
                provider === 'anthropic'
                  ? () => setIsClaudeLoginOpen(true)
                  : provider === 'openai'
                    ? handleOpenAIOAuthLogin
                    : undefined
              }
              onDisconnect={() => void handleDisconnect(provider)}
              onSetActiveProfile={async (name) => {
                await setActiveProfileAction(provider, name);
              }}
              onRemoveProfile={async (name) => {
                await removeProfileAction(provider, name);
              }}
              onAddAnotherAccount={
                provider === 'anthropic'
                  ? () => {
                      setIsClaudeLoginOpen(true);
                      return Promise.resolve();
                    }
                  : provider === 'openai'
                    ? handleOpenAIOAuthLogin
                    : undefined
              }
            />
          ))}
        </SectionDisclosure>

        <SectionDisclosure
          title="Agent Behavior"
          icon={<Settings2 className="size-4" />}
          summary={`${streaming ? 'Streaming' : 'Buffered'} / ${toolPermissionPolicy}`}
          open={behaviorOpen}
          onOpenChange={setBehaviorOpen}
        >
          <div className="divide-y divide-border/50">
            <CompactSettingRow
              label="Max Output Tokens"
              description={`1024-${modelMax.toLocaleString()}${activeModel ? ` for ${activeModel.display_name}` : ''}`}
            >
              <NumberInput
                value={clampedMaxTokens}
                min={1024}
                max={modelMax}
                step={256}
                onChange={setMaxTokens}
              />
            </CompactSettingRow>
            <CompactSettingRow label="Stream Responses">
              <Switch checked={streaming} onCheckedChange={setStreaming} />
            </CompactSettingRow>
            <CompactSettingRow label="Tool Permissions">
              <SelectDropdown
                value={toolPermissionPolicy}
                options={[
                  { label: 'Ask for all tools', value: 'ask-all' },
                  { label: 'Smart', value: 'smart' },
                  { label: 'Auto-approve all', value: 'approve-all' },
                ]}
                onChange={setToolPermissionPolicy}
                className="h-7 min-w-[190px] rounded-md bg-input text-[12px]"
              />
            </CompactSettingRow>
            {toolPermissionPolicy !== 'approve-all' ? (
              <CompactSettingRow label="Auto-approve Tools">
                <Switch checked={autoApproveTools} onCheckedChange={setAutoApproveTools} />
              </CompactSettingRow>
            ) : null}
          </div>
        </SectionDisclosure>

        <SectionDisclosure
          title="Worktree Setup"
          icon={<Network className="size-4" />}
          summary={setupCommandsText.trim() ? `${setupCommandsText.split('\n').filter(Boolean).length} commands` : 'No commands'}
          open={setupOpen}
          onOpenChange={setSetupOpen}
        >
          <div className="space-y-2">
            <textarea
              value={setupCommandsText}
              onChange={(event) => setSetupCommandsText(event.target.value)}
              disabled={isLoadingSetup}
              placeholder={'bun install\nbun run build'}
              className="h-24 w-full resize-y rounded-md bg-input px-3 py-2 font-mono text-xs text-foreground ring-1 ring-black/5 transition-[box-shadow,outline-color] placeholder:text-muted-foreground/45 focus:outline-2 focus:-outline-offset-1 focus:outline-ring/60 disabled:cursor-not-allowed disabled:opacity-50 dark:ring-white/5"
            />
            <Button
              variant="primary"
              size="md"
              loading={isSavingSetup}
              onClick={handleSaveSetupCommands}
            >
              Save
            </Button>
          </div>
        </SectionDisclosure>

        <SectionDisclosure
          title="Advanced"
          icon={<ShieldCheck className="size-4" />}
          summary={customApiUrl.trim() ? 'Custom API URL set' : 'Default API URLs'}
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <CompactSettingRow label="Custom API URL" description="Leave empty for provider defaults.">
            <Input
              name="custom-api-url"
              size="md"
              value={customApiUrl}
              onChange={(event) => setCustomApiUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              className="font-mono"
            />
          </CompactSettingRow>
        </SectionDisclosure>

        <ClaudeLoginModal
          isOpen={isClaudeLoginOpen}
          onClose={() => setIsClaudeLoginOpen(false)}
          onSuccess={handleClaudeLoginSuccess}
        />
      </div>
    </TooltipProvider>
  );
}
