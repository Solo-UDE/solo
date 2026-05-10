/**
 * PluginsTab — browse, install, enable, and remove plugins.
 *
 * A plugin is a directory containing `.solo-plugin/plugin.json` (or
 * `.codex-plugin/...` / `.claude-plugin/...` as compatibility fallbacks).
 * Plugins bundle skills, MCP servers, and app connectors. In this
 * foundation release, only the skills leg is wired through to the
 * running agent — MCP and connectors are parsed from manifests but
 * not yet executed.
 */

import { useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  AlertTriangle,
  Plus,
  Puzzle,
  RefreshCw,
  X,
} from 'lucide-react';

import { ToggleSwitch } from '../controls';
import { VirtualList } from '../../ui/virtual-list';
import { usePluginsStore } from '../../../stores/pluginsStore';
import { useFileExplorerStore } from '../../../stores/fileExplorerStore';
import { cn } from '../../../lib/utils';

import type { PluginId } from '../../../bindings/PluginId';
import type { PluginSource } from '../../../bindings/PluginSource';
import type { PluginSummary } from '../../../bindings/PluginSummary';

import { PluginDetailDrawer } from './PluginDetailDrawer';

const SOURCE_META: Record<
  PluginSource,
  { label: string; tone: 'native' | 'claude' | 'codex'; shortLabel: string }
> = {
  local: { label: 'Local', tone: 'native', shortLabel: 'Local' },
  marketplace: { label: 'Marketplace', tone: 'native', shortLabel: 'Marketplace' },
  claude_adapter: { label: 'From Claude Code', tone: 'claude', shortLabel: 'Claude' },
  codex_adapter: { label: 'From Codex', tone: 'codex', shortLabel: 'Codex' },
};

const TONE_CLASS: Record<'native' | 'claude' | 'codex', string> = {
  native: 'text-primary bg-primary/10',
  claude: 'text-orange-500 bg-orange-500/10',
  codex: 'text-sky-500 bg-sky-500/10',
};

function idKey(id: PluginId): string {
  return `${id.marketplace}/${id.name}`;
}

const chunkPlugins = (plugins: PluginSummary[]) => {
  const rows: PluginSummary[][] = [];
  for (let i = 0; i < plugins.length; i += 2) {
    rows.push(plugins.slice(i, i + 2));
  }
  return rows;
};

export const PluginsTab: FC = () => {
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

  const [errorsExpanded, setErrorsExpanded] = useState(false);

  useEffect(() => {
    if (!rootPath) return;
    if (!loaded) void list(rootPath);
  }, [rootPath, loaded, list]);

  const { installed, adapter } = useMemo(() => {
    const ins: PluginSummary[] = [];
    const adp: PluginSummary[] = [];
    for (const p of plugins) {
      if (p.source === 'local' || p.source === 'marketplace') ins.push(p);
      else adp.push(p);
    }
    return { installed: ins, adapter: adp };
  }, [plugins]);
  const installedRows = useMemo(() => chunkPlugins(installed), [installed]);
  const adapterRows = useMemo(() => chunkPlugins(adapter), [adapter]);

  const handleRefresh = () => {
    if (rootPath) void list(rootPath);
  };

  const handleInstall = async () => {
    if (!rootPath) return;
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
      console.warn('[PluginsTab] install picker failed:', err);
    }
  };

  if (!rootPath) {
    return (
      <div className="text-sm text-muted-foreground">
        Open a project to browse plugins.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto pr-4">
        {/* Header actions */}
        <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Puzzle className="w-3.5 h-3.5 text-primary" />
          <span>
            <strong className="text-foreground">{plugins.length}</strong> total
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span>
            <strong className="text-foreground">{installed.length}</strong> installed
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span>
            <strong className="text-foreground">{adapter.length}</strong> adapter-discovered
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={mutating !== null}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleInstall}
            disabled={mutating !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Plus className="w-3 h-3" />
            Install local…
          </button>
        </div>
      </div>

      {/* Inline errors banner */}
      {lastError && (
        <div className="flex items-start gap-2 rounded-[10px] border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />
          <span className="flex-1">{lastError}</span>
          <button
            type="button"
            onClick={clearError}
            className="text-destructive/70 hover:text-destructive"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Empty state */}
      {loaded && plugins.length === 0 && (
        <div className="rounded-[12px] border border-dashed border-border/60 px-6 py-10 text-center">
          <Puzzle className="w-6 h-6 text-muted-foreground/60 mx-auto mb-3" />
          <p className="text-sm text-foreground">No plugins yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Install a local plugin directory or enable Claude / Codex adapters in{' '}
            <em className="not-italic text-foreground">Skills → Sources</em>.
          </p>
          <button
            type="button"
            onClick={handleInstall}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Install a plugin from disk
          </button>
        </div>
      )}

      {/* Grid — installed plugins first, then adapter plugins */}
      {installed.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Installed ({installed.length})
          </h3>
          <VirtualList
            items={installedRows}
            estimateSize={() => 124}
            overscan={6}
            className="max-h-[520px]"
            itemClassName="pb-3"
            getItemKey={(row) => row.map((p) => idKey(p.id)).join('|')}
            testId="settings-installed-plugins"
            renderItem={(row) => (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {row.map((p) => (
                  <PluginTile
                    key={idKey(p.id)}
                    plugin={p}
                    rootPath={rootPath}
                    mutating={mutating === idKey(p.id)}
                    onToggle={(enabled) => setEnabled(rootPath, p.id, enabled)}
                    onOpen={() => openDetail(rootPath, p.id)}
                  />
                ))}
              </div>
            )}
          />
        </section>
      )}

      {adapter.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Discovered ({adapter.length})
          </h3>
          <p className="text-xs text-muted-foreground/80 -mt-2 mb-3">
            Plugins installed via Claude Code or Codex, read-only. Toggle to include their skills in this workspace.
          </p>
          <VirtualList
            items={adapterRows}
            estimateSize={() => 124}
            overscan={6}
            className="max-h-[520px]"
            itemClassName="pb-3"
            getItemKey={(row) => row.map((p) => idKey(p.id)).join('|')}
            testId="settings-adapter-plugins"
            renderItem={(row) => (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {row.map((p) => (
                  <PluginTile
                    key={idKey(p.id)}
                    plugin={p}
                    rootPath={rootPath}
                    mutating={mutating === idKey(p.id)}
                    onToggle={(enabled) => setEnabled(rootPath, p.id, enabled)}
                    onOpen={() => openDetail(rootPath, p.id)}
                  />
                ))}
              </div>
            )}
          />
        </section>
      )}

      {/* Manifest load errors — collapsible */}
      {errors.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setErrorsExpanded((v) => !v)}
            className="flex items-center gap-2 text-xs text-amber-500 hover:text-amber-400 transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              {errors.length} plugin{errors.length === 1 ? '' : 's'} had manifest issues (click to {errorsExpanded ? 'hide' : 'show'})
            </span>
          </button>
          {errorsExpanded && (
            <ul className="mt-2 space-y-1 text-xs">
              {errors.map((err, i) => (
                <li key={i} className="rounded bg-amber-500/5 border border-amber-500/20 px-2 py-1.5">
                  <div className="font-mono text-[11px] text-foreground/80 truncate">{err.path}</div>
                  <div className="text-muted-foreground mt-0.5">{err.message}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      </div>

      {detailOpen && <PluginDetailDrawer rootPath={rootPath} />}
    </div>
  );
};

interface PluginTileProps {
  plugin: PluginSummary;
  rootPath: string;
  mutating: boolean;
  onToggle: (enabled: boolean) => void;
  onOpen: () => void;
}

const PluginTile: FC<PluginTileProps> = ({ plugin, mutating, onToggle, onOpen }) => {
  const meta = SOURCE_META[plugin.source];
  const tintStyle = plugin.brand_color
    ? { backgroundColor: `${plugin.brand_color}10`, borderColor: `${plugin.brand_color}40` }
    : undefined;

  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 rounded-[12px] border border-border/60 bg-background/55 px-4 py-3 transition-[background-color,border-color] hover:bg-card hover:border-border',
        !plugin.enabled && 'opacity-70',
      )}
      style={tintStyle}
    >
      {/* Icon / logo */}
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 w-10 h-10 rounded-[10px] flex items-center justify-center overflow-hidden bg-muted/40"
        style={plugin.brand_color ? { backgroundColor: `${plugin.brand_color}20` } : undefined}
        aria-label={`Open details for ${plugin.display_name}`}
      >
        {plugin.logo ? (
          <img
            src={`asset://localhost/${encodeURIComponent(plugin.logo)}`}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <Puzzle
            className="w-5 h-5"
            style={plugin.brand_color ? { color: plugin.brand_color } : undefined}
          />
        )}
      </button>

      {/* Body */}
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {plugin.display_name}
          </span>
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
              TONE_CLASS[meta.tone],
            )}
          >
            {meta.shortLabel}
          </span>
        </div>
        {plugin.short_description ? (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {plugin.short_description}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/50 mt-0.5 italic">
            {plugin.id.marketplace}/{plugin.id.name}
          </p>
        )}
      </button>

      {/* Toggle */}
      <div className="shrink-0">
        <ToggleSwitch
          checked={plugin.enabled}
          onChange={onToggle}
          disabled={mutating}
        />
      </div>
    </div>
  );
};
