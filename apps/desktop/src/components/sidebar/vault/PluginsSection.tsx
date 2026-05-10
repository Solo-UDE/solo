/**
 * PluginsSection — Vault surface for Solo plugins.
 *
 * Mirrors Codex's plugin directory layout while staying wired to Solo's
 * existing plugin loader: Solo-native installs, Codex cache adapters, and
 * Claude Code plugin adapters all flow through the same store.
 */

import type { FC } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  Cloud,
  FolderOpen,
  GitBranch,
  Globe,
  Grid3X3,
  Inbox,
  Mail,
  MessageCircle,
  MessageSquare,
  MonitorCog,
  MoreHorizontal,
  NotebookTabs,
  PanelTop,
  Plus,
  Presentation,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Table2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

import { PluginDetailDrawer } from '@/components/settings/tabs/PluginDetailDrawer';
import { VirtualList } from '@/components/ui/virtual-list';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { usePluginsStore } from '@/stores/pluginsStore';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

import type { PluginId } from '@/bindings/PluginId';
import type { PluginSource } from '@/bindings/PluginSource';
import type { PluginSummary } from '@/bindings/PluginSummary';

type StatusFilter = 'all' | 'enabled' | 'available';
type SourceFilter = 'all' | 'solo' | 'codex' | 'claude' | 'chatgpt';

interface CatalogPlugin {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly tone: string;
  readonly source: SourceFilter;
  readonly aliases: readonly string[];
}

interface DisplayPlugin extends CatalogPlugin {
  readonly plugin: PluginSummary | null;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly sourceLabel: string;
}

const chunkDisplayPlugins = (items: DisplayPlugin[]) => {
  const rows: DisplayPlugin[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2));
  }
  return rows;
};

const CATALOG: readonly CatalogPlugin[] = [
  {
    key: 'computer-use',
    name: 'Computer Use',
    description: 'Control Mac apps from Solo',
    icon: MonitorCog,
    tone: 'from-sky-400 to-rose-400',
    source: 'codex',
    aliases: ['computer-use', 'computer use', 'computer_use'],
  },
  {
    key: 'chrome',
    name: 'Chrome',
    description: 'Control Chrome with Solo',
    icon: Globe,
    tone: 'from-emerald-400 to-sky-400',
    source: 'codex',
    aliases: ['chrome', 'browser'],
  },
  {
    key: 'spreadsheets',
    name: 'Spreadsheets',
    description: 'Create and edit spreadsheet files',
    icon: Table2,
    tone: 'from-green-500 to-emerald-300',
    source: 'chatgpt',
    aliases: ['spreadsheets', 'spreadsheet', 'sheets'],
  },
  {
    key: 'presentations',
    name: 'Presentations',
    description: 'Create and edit presentations',
    icon: Presentation,
    tone: 'from-amber-500 to-orange-300',
    source: 'chatgpt',
    aliases: ['presentations', 'presentation', 'slides', 'pptx'],
  },
  {
    key: 'github',
    name: 'GitHub',
    description: 'Triage PRs, issues, CI, and publish flows',
    icon: GitBranch,
    tone: 'from-zinc-300 to-zinc-500',
    source: 'chatgpt',
    aliases: ['github', 'git-hub', 'gh'],
  },
  {
    key: 'slack',
    name: 'Slack',
    description: 'Read and manage Slack',
    icon: MessageSquare,
    tone: 'from-pink-400 to-cyan-400',
    source: 'chatgpt',
    aliases: ['slack'],
  },
  {
    key: 'notion',
    name: 'Notion',
    description: 'Notion workflows for specs and research',
    icon: NotebookTabs,
    tone: 'from-zinc-100 to-zinc-400',
    source: 'chatgpt',
    aliases: ['notion'],
  },
  {
    key: 'linear',
    name: 'Linear',
    description: 'Find and reference issues and projects',
    icon: PanelTop,
    tone: 'from-indigo-400 to-zinc-400',
    source: 'chatgpt',
    aliases: ['linear'],
  },
  {
    key: 'statsig',
    name: 'Statsig',
    description: 'Bring workspace experiments into context',
    icon: BarChart3,
    tone: 'from-slate-300 to-cyan-400',
    source: 'chatgpt',
    aliases: ['statsig'],
  },
  {
    key: 'gmail',
    name: 'Gmail',
    description: 'Read and manage Gmail',
    icon: Mail,
    tone: 'from-red-400 to-yellow-300',
    source: 'chatgpt',
    aliases: ['gmail', 'google-mail'],
  },
  {
    key: 'google-calendar',
    name: 'Google Calendar',
    description: 'Manage Google Calendar events',
    icon: CalendarDays,
    tone: 'from-blue-400 to-emerald-400',
    source: 'chatgpt',
    aliases: ['google-calendar', 'calendar'],
  },
  {
    key: 'google-drive',
    name: 'Google Drive',
    description: 'Work across Drive, Docs, Sheets, and Slides',
    icon: Cloud,
    tone: 'from-yellow-300 to-blue-400',
    source: 'chatgpt',
    aliases: ['google-drive', 'drive', 'docs'],
  },
  {
    key: 'teams',
    name: 'Teams',
    description: 'Summarize Teams and draft follow-ups',
    icon: Users,
    tone: 'from-violet-400 to-blue-400',
    source: 'chatgpt',
    aliases: ['teams', 'microsoft-teams'],
  },
  {
    key: 'sharepoint',
    name: 'SharePoint',
    description: 'Summarize SharePoint sites and files',
    icon: Share2,
    tone: 'from-teal-400 to-cyan-300',
    source: 'chatgpt',
    aliases: ['sharepoint', 'share-point'],
  },
  {
    key: 'outlook-email',
    name: 'Outlook Email',
    description: 'Triage Outlook inboxes and draft replies',
    icon: Inbox,
    tone: 'from-blue-500 to-cyan-300',
    source: 'chatgpt',
    aliases: ['outlook-email', 'outlook mail', 'outlook'],
  },
  {
    key: 'outlook-calendar',
    name: 'Outlook Calendar',
    description: 'Manage Outlook schedules and meetings',
    icon: CalendarDays,
    tone: 'from-blue-500 to-indigo-300',
    source: 'chatgpt',
    aliases: ['outlook-calendar', 'microsoft-calendar'],
  },
];

const SOURCE_META: Record<
  PluginSource,
  { readonly label: string; readonly source: SourceFilter; readonly tone: string }
> = {
  local: { label: 'Local', source: 'solo', tone: 'text-primary bg-primary/10' },
  marketplace: { label: 'Solo', source: 'solo', tone: 'text-primary bg-primary/10' },
  claude_adapter: { label: 'Claude', source: 'claude', tone: 'text-orange-500 bg-orange-500/10' },
  codex_adapter: { label: 'Codex', source: 'codex', tone: 'text-sky-500 bg-sky-500/10' },
};

const FILTER_LABELS: Record<SourceFilter, string> = {
  all: 'All sources',
  solo: 'Solo',
  codex: 'Codex',
  claude: 'Claude',
  chatgpt: 'ChatGPT apps',
};

function idKey(id: PluginId): string {
  return `${id.marketplace}/${id.name}`;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function matchesCatalog(plugin: PluginSummary, entry: CatalogPlugin): boolean {
  const haystack = [
    plugin.display_name,
    plugin.id.name,
    plugin.id.marketplace,
    `${plugin.id.marketplace}/${plugin.id.name}`,
  ].map(normalize);

  return entry.aliases.some((alias) => {
    const key = normalize(alias);
    return haystack.some((value) => value === key || value.includes(key));
  });
}

function pluginCatalogFallback(plugin: PluginSummary): CatalogPlugin {
  return {
    key: idKey(plugin.id),
    name: plugin.display_name,
    description: plugin.short_description ?? `${plugin.id.marketplace}/${plugin.id.name}`,
    icon: Puzzle,
    tone: 'from-muted-foreground to-foreground',
    source: SOURCE_META[plugin.source].source,
    aliases: [plugin.display_name, plugin.id.name],
  };
}

function buildDisplayItems(plugins: readonly PluginSummary[]): DisplayPlugin[] {
  const used = new Set<string>();
  const items: DisplayPlugin[] = CATALOG.map((entry) => {
    const plugin = plugins.find((candidate) => !used.has(idKey(candidate.id)) && matchesCatalog(candidate, entry));
    if (plugin) used.add(idKey(plugin.id));
    return {
      ...entry,
      plugin: plugin ?? null,
      enabled: plugin?.enabled ?? false,
      installed: !!plugin,
      sourceLabel: plugin ? SOURCE_META[plugin.source].label : FILTER_LABELS[entry.source],
    };
  });

  for (const plugin of plugins) {
    if (used.has(idKey(plugin.id))) continue;
    const fallback = pluginCatalogFallback(plugin);
    items.push({
      ...fallback,
      plugin,
      enabled: plugin.enabled,
      installed: true,
      sourceLabel: SOURCE_META[plugin.source].label,
    });
  }

  return items;
}

export const PluginsSection: FC = () => {
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const plugins = usePluginsStore((s) => s.plugins);
  const errors = usePluginsStore((s) => s.errors);
  const loaded = usePluginsStore((s) => s.loaded);
  const mutating = usePluginsStore((s) => s.mutating);
  const lastError = usePluginsStore((s) => s.lastError);
  const detailOpen = usePluginsStore((s) => s.detailOpen);
  const list = usePluginsStore((s) => s.list);
  const setEnabled = usePluginsStore((s) => s.setEnabled);
  const installLocal = usePluginsStore((s) => s.installLocal);
  const openDetail = usePluginsStore((s) => s.openDetail);
  const clearError = usePluginsStore((s) => s.clearError);
  const openPanel = usePanelTabsStore((s) => s.openPanel);
  const openSettings = useUIStore((s) => s.openSettings);
  const setVaultNav = useUIStore((s) => s.setVaultNav);

  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootPath) return;
    if (!loaded) void list(rootPath);
  }, [rootPath, loaded, list]);

  useEffect(() => {
    if (!createMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (createMenuRef.current?.contains(event.target as Node)) return;
      setCreateMenuOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [createMenuOpen]);

  const displayItems = useMemo(() => buildDisplayItems(plugins), [plugins]);
  const featured = useMemo(
    () => displayItems.find((item) => item.enabled) ?? displayItems.find((item) => item.key === 'github') ?? displayItems[0],
    [displayItems],
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return displayItems.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (statusFilter === 'enabled' && !item.enabled) return false;
      if (statusFilter === 'available' && item.enabled) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.sourceLabel.toLowerCase().includes(q) ||
        item.aliases.some((alias) => alias.toLowerCase().includes(q))
      );
    });
  }, [displayItems, query, sourceFilter, statusFilter]);
  const filteredRows = useMemo(() => chunkDisplayPlugins(filteredItems), [filteredItems]);

  const installedCount = plugins.length;
  const enabledCount = plugins.filter((plugin) => plugin.enabled).length;

  const handleRefresh = () => {
    if (rootPath) void list(rootPath);
  };

  const handleInstall = async () => {
    if (!rootPath) return;
    setCreateMenuOpen(false);
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: 'Select a plugin directory to install',
      });
      if (typeof picked === 'string') {
        await installLocal(rootPath, picked);
      }
    } catch (err) {
      console.warn('[PluginsSection] install picker failed:', err);
    }
  };

  const handleOpenSkills = () => {
    setVaultNav('skills');
    openPanel('vault-skills');
  };

  const handlePrimaryAction = (item: DisplayPlugin) => {
    if (!rootPath) return;
    if (item.plugin) {
      if (item.enabled) {
        void openDetail(rootPath, item.plugin.id);
      } else {
        void setEnabled(rootPath, item.plugin.id, true);
      }
      return;
    }
    void handleInstall();
  };

  return (
    <div className="min-h-full bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col px-5 pb-12 pt-3 lg:px-8">
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="Vault capabilities"
            className="flex min-h-10 items-center gap-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected="true"
              className="relative min-h-9 rounded-[10px] px-3 text-sm font-medium text-foreground"
            >
              <span className="absolute inset-0 rounded-[10px] border border-border/70 bg-card" />
              <span className="relative">Plugins</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected="false"
              onClick={handleOpenSkills}
              className="min-h-9 rounded-[10px] px-3 text-sm font-medium text-muted-foreground transition-[background-color,color] duration-150 hover:bg-card/70 hover:text-foreground"
            >
              Skills
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => openSettings('plugins')}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border border-border/70 bg-card px-3 text-sm font-medium text-foreground shadow-[0_8px_16px_-14px_rgba(0,0,0,0.45)] transition-[background-color,scale] duration-150 hover:bg-muted/50 active:scale-[0.96]"
            >
              <Settings className="size-4" />
              Manage
            </button>
            <div ref={createMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setCreateMenuOpen((value) => !value)}
                disabled={!rootPath || mutating !== null}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border border-border/70 bg-card px-3 text-sm font-medium text-foreground shadow-[0_8px_16px_-14px_rgba(0,0,0,0.45)] transition-[background-color,scale] duration-150 hover:bg-muted/50 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                aria-expanded={createMenuOpen}
                aria-haspopup="menu"
              >
                Create
                <ChevronDown className="size-4 text-muted-foreground" />
              </button>
              {createMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+6px)] z-30 w-[210px] overflow-hidden rounded-[10px] border border-border/70 bg-popover p-1 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.65)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleInstall}
                    className="flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted/60"
                  >
                    <FolderOpen className="size-4 text-muted-foreground" />
                    Install local plugin
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      openSettings('plugins');
                    }}
                    className="flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted/60"
                  >
                    <Settings className="size-4 text-muted-foreground" />
                    Manage adapters
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => openSettings('plugins')}
              disabled={!rootPath || mutating !== null}
              className="inline-flex size-9 items-center justify-center rounded-[10px] text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-card hover:text-foreground active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="More plugin actions"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </div>
        </div>

        <div className="pt-8 text-center">
          <h1 className="text-[30px] font-semibold tracking-tight text-foreground text-balance sm:text-[34px]">
            Make Solo work your way
          </h1>
        </div>

        <div className="mx-auto mt-8 flex w-full max-w-[860px] flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search plugins"
              className="h-10 w-full rounded-[10px] border border-border/70 bg-card pl-9 pr-3 text-sm text-foreground outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-muted-foreground/80 focus:border-primary/50 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
            />
          </label>

          <SelectControl
            label="Source"
            value={sourceFilter}
            onChange={(value) => setSourceFilter(value as SourceFilter)}
            options={[
              ['all', 'All sources'],
              ['codex', 'Codex'],
              ['chatgpt', 'ChatGPT apps'],
              ['claude', 'Claude'],
              ['solo', 'Solo'],
            ]}
          />

          <SelectControl
            label="Status"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            options={[
              ['all', 'All'],
              ['enabled', 'Enabled'],
              ['available', 'Available'],
            ]}
          />
        </div>

        {lastError && (
          <div className="mx-auto mt-5 flex w-full max-w-[860px] items-start gap-2 rounded-[10px] border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5" />
            <span className="flex-1">{lastError}</span>
            <button
              type="button"
              onClick={clearError}
              className="text-destructive/70 transition-colors hover:text-destructive"
              aria-label="Dismiss plugin error"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {featured && (
          <section className="mx-auto mt-9 w-full max-w-[860px]">
            <div className="relative min-h-[186px] overflow-hidden rounded-[18px] border border-border/70 bg-card shadow-[0_28px_70px_-55px_rgba(0,0,0,0.55)]">
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[linear-gradient(135deg,rgba(14,165,233,0.22),rgba(34,197,94,0.16)_48%,rgba(245,158,11,0.18))]"
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:28px_28px]"
              />
              <div className="relative flex min-h-[186px] flex-col items-center justify-center gap-8 px-6 py-8">
                <div className="inline-flex max-w-full items-center gap-2 rounded-[14px] border border-border/70 bg-background/78 px-4 py-3 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.65)] backdrop-blur-xl">
                  <PluginIcon item={featured} size="sm" />
                  <span className="max-w-[180px] truncate text-sm font-medium text-muted-foreground sm:max-w-none">
                    {featured.name}
                  </span>
                  <span className="hidden text-sm text-foreground sm:inline">
                    {featured.description}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handlePrimaryAction(featured)}
                  disabled={!rootPath || mutating !== null}
                  className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background shadow-[0_16px_36px_-24px_rgba(0,0,0,0.65)] transition-[opacity,scale] duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MessageCircle className="size-4" />
                  {featured.installed ? 'Open details' : 'Install local'}
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="mx-auto mt-9 w-full max-w-[860px]">
          <div className="flex items-end gap-3 border-b border-border/60 pb-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Featured</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">{enabledCount}</span> enabled
                <span className="px-1.5 text-muted-foreground/50">/</span>
                <span className="font-medium text-foreground tabular-nums">{installedCount}</span> installed
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={!rootPath || mutating !== null}
              className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-[9px] px-2.5 text-xs font-medium text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-card hover:text-foreground active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </button>
          </div>

          {!rootPath && (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
              <FolderOpen className="size-7 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">Open a project to manage plugins.</p>
            </div>
          )}

          {rootPath && loaded && filteredItems.length === 0 && (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
              <Grid3X3 className="size-7 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">No matching plugins.</p>
            </div>
          )}

          {rootPath && filteredItems.length > 0 && (
            <VirtualList
              items={filteredRows}
              estimateSize={() => 86}
              overscan={8}
              className="max-h-[560px] py-5"
              itemClassName="pb-2"
              getItemKey={(row) => row.map((item) => item.key).join('|')}
              testId="sidebar-plugins-list"
              renderItem={(row) => (
                <div className="grid grid-cols-1 gap-x-12 gap-y-2 md:grid-cols-2">
                  {row.map((item) => (
                    <PluginRow
                      key={item.key}
                      item={item}
                      mutating={!!item.plugin && mutating === idKey(item.plugin.id)}
                      onToggle={(enabled) => {
                        if (!rootPath || !item.plugin) return;
                        void setEnabled(rootPath, item.plugin.id, enabled);
                      }}
                      onOpen={() => {
                        if (!rootPath || !item.plugin) return;
                        void openDetail(rootPath, item.plugin.id);
                      }}
                      onInstall={handleInstall}
                    />
                  ))}
                </div>
              )}
            />
          )}

          {errors.length > 0 && (
            <div className="mt-4 border-t border-border/60 pt-4">
              <button
                type="button"
                onClick={() => setErrorsExpanded((value) => !value)}
                className="inline-flex items-center gap-2 text-xs text-amber-500 transition-colors hover:text-amber-400"
              >
                <AlertTriangle className="size-3.5" />
                {errors.length} manifest issue{errors.length === 1 ? '' : 's'}
              </button>
              {errorsExpanded && (
                <ul className="mt-2 space-y-1 text-xs">
                  {errors.map((err) => (
                    <li
                      key={`${err.path}:${err.message}`}
                      className="rounded-[8px] border border-amber-500/20 bg-amber-500/5 px-2 py-1.5"
                    >
                      <div className="truncate font-mono text-[11px] text-foreground/80">{err.path}</div>
                      <div className="mt-0.5 text-muted-foreground">{err.message}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      {detailOpen && rootPath && <PluginDetailDrawer rootPath={rootPath} />}
    </div>
  );
};

interface SelectControlProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly onChange: (value: string) => void;
}

const SelectControl: FC<SelectControlProps> = ({ label, value, options, onChange }) => (
  <label className="relative h-10 shrink-0">
    <span className="sr-only">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 min-w-[118px] appearance-none rounded-[10px] border border-border/70 bg-card py-0 pl-3 pr-8 text-sm font-medium text-foreground outline-none transition-[border-color,background-color,box-shadow] duration-150 focus:border-primary/50 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
    >
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </select>
    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
  </label>
);

interface PluginRowProps {
  readonly item: DisplayPlugin;
  readonly mutating: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onOpen: () => void;
  readonly onInstall: () => void;
}

const PluginRow: FC<PluginRowProps> = ({
  item,
  mutating,
  onToggle,
  onOpen,
  onInstall,
}) => {
  const metaTone = item.plugin ? SOURCE_META[item.plugin.source].tone : 'text-muted-foreground bg-muted/40';
  const hasRuntimeParts = item.plugin && (
    item.plugin.skill_count > 0 ||
    item.plugin.mcp_server_count > 0 ||
    item.plugin.app_count > 0 ||
    item.plugin.compatibility_warnings.length > 0
  );

  return (
    <div className="group flex min-h-[78px] items-center gap-3 rounded-[10px] px-2.5 py-2 transition-[background-color] duration-150 hover:bg-card/72">
      <button
        type="button"
        onClick={item.plugin ? onOpen : onInstall}
        className="shrink-0"
        aria-label={item.plugin ? `Open ${item.name} details` : `Install ${item.name}`}
      >
        <PluginIcon item={item} size="md" />
      </button>

      <button
        type="button"
        onClick={item.plugin ? onOpen : onInstall}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{item.name}</span>
          <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', metaTone)}>
            {item.sourceLabel}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground text-pretty">
          {item.description}
        </p>
        {hasRuntimeParts && item.plugin && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {item.plugin.skill_count > 0 && (
              <RuntimePill label={`${item.plugin.skill_count} skills`} />
            )}
            {item.plugin.mcp_server_count > 0 && (
              <RuntimePill label={`${item.plugin.mcp_server_count} MCP`} />
            )}
            {item.plugin.app_count > 0 && (
              <RuntimePill label={`${item.plugin.app_count} apps`} muted={item.plugin.unsupported_connector_count > 0} />
            )}
            {item.plugin.compatibility_warnings.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                <AlertTriangle className="size-3" />
                attention
              </span>
            )}
          </div>
        )}
      </button>

      <div className="flex size-10 shrink-0 items-center justify-center">
        {item.plugin ? (
          item.enabled ? (
            <button
              type="button"
              onClick={() => onToggle(false)}
              disabled={mutating}
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-muted/60 hover:text-foreground active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`Disable ${item.name}`}
            >
              <Check className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onToggle(true)}
              disabled={mutating}
              className="inline-flex size-8 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`Enable ${item.name}`}
            >
              <Plus className="size-4" />
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={onInstall}
            className="inline-flex size-8 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.96]"
            aria-label={`Install ${item.name}`}
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
};

const RuntimePill: FC<{ readonly label: string; readonly muted?: boolean }> = ({ label, muted }) => (
  <span
    className={cn(
      'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
      muted ? 'bg-muted/50 text-muted-foreground' : 'bg-primary/10 text-primary',
    )}
  >
    {label}
  </span>
);

const PluginIcon: FC<{ readonly item: DisplayPlugin; readonly size: 'sm' | 'md' }> = ({
  item,
  size,
}) => {
  const Icon = item.icon;
  const className = size === 'sm' ? 'size-5' : 'size-6';
  const boxClass = size === 'sm' ? 'size-7 rounded-[8px]' : 'size-11 rounded-[12px]';

  if (item.plugin?.logo) {
    return (
      <span
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden bg-muted/40 shadow-[0_12px_22px_-18px_rgba(0,0,0,0.6)] outline outline-1 outline-white/10',
          boxClass,
        )}
      >
        <img
          src={`asset://localhost/${encodeURIComponent(item.plugin.logo)}`}
          alt=""
          className="size-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center bg-gradient-to-br text-white shadow-[0_12px_22px_-18px_rgba(0,0,0,0.6)] outline outline-1 outline-white/10',
        item.tone,
        boxClass,
      )}
    >
      <Icon className={className} />
    </span>
  );
};
