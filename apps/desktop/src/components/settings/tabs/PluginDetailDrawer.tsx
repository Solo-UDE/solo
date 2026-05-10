/**
 * PluginDetailDrawer — slide-in panel showing full PluginDetail.
 *
 * Opened by clicking a plugin tile. Uses the same detail projection as
 * `plugins_get_detail` — long description, capabilities, default prompts,
 * screenshots, links, and an uninstall action for Solo-native plugins.
 */

import type { FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ExternalLink, Puzzle, Trash2, X } from 'lucide-react';

import { ToggleSwitch } from '../controls';
import { usePluginsStore } from '../../../stores/pluginsStore';
import { cn } from '../../../lib/utils';

import type { PluginSource } from '../../../bindings/PluginSource';

const SOURCE_DESCRIPTION: Record<PluginSource, string> = {
  local: 'Installed from a local directory in ~/.solo/plugins/cache/local/.',
  marketplace:
    'Installed from a Solo marketplace (marketplace support lands in a later release).',
  claude_adapter:
    "Discovered read-only via Claude Code's installed plugins. Solo cannot modify this plugin.",
  codex_adapter:
    'Discovered read-only via codex. Solo cannot modify this plugin.',
};

export const PluginDetailDrawer: FC<{ rootPath: string }> = ({ rootPath }) => {
  const detail = usePluginsStore((s) => s.detail);
  const detailOpen = usePluginsStore((s) => s.detailOpen);
  const mutating = usePluginsStore((s) => s.mutating);
  const closeDetail = usePluginsStore((s) => s.closeDetail);
  const setEnabled = usePluginsStore((s) => s.setEnabled);
  const uninstall = usePluginsStore((s) => s.uninstall);

  const canUninstall =
    !!detail && (detail.source === 'local' || detail.source === 'marketplace');

  return (
    <AnimatePresence>
      {detailOpen && detail && (
        <>
          <motion.button
            type="button"
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeDetail}
            aria-label="Close plugin details"
          />
          <motion.aside
            className="fixed right-0 top-0 h-full w-full max-w-[480px] z-50 bg-card border-l border-border/70 shadow-2xl overflow-y-auto"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
          >
            <div className="px-6 py-5">
              {/* Header */}
              <div className="flex items-start gap-4">
                <div
                  className="shrink-0 w-14 h-14 rounded-[12px] flex items-center justify-center overflow-hidden bg-muted/40"
                  style={
                    detail.interface?.brand_color
                      ? { backgroundColor: `${detail.interface.brand_color}20` }
                      : undefined
                  }
                >
                  {detail.interface?.logo ? (
                    <img
                      src={`asset://localhost/${encodeURIComponent(detail.interface.logo)}`}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <Puzzle
                      className="w-7 h-7"
                      style={
                        detail.interface?.brand_color
                          ? { color: detail.interface.brand_color }
                          : undefined
                      }
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-foreground truncate">
                    {detail.interface?.display_name ?? detail.id.name}
                  </h2>
                  {detail.interface?.developer_name && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      by {detail.interface.developer_name}
                    </p>
                  )}
                  <p className="text-[11px] font-mono text-muted-foreground/60 mt-1 truncate">
                    {detail.id.marketplace}/{detail.id.name} · v{detail.version}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDetail}
                  className="shrink-0 p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Enabled toggle */}
              <div className="mt-5 flex items-center gap-3 rounded-[10px] border border-border/60 bg-background/55 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {detail.enabled ? 'Enabled' : 'Disabled'}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {SOURCE_DESCRIPTION[detail.source]}
                  </p>
                </div>
                <ToggleSwitch
                  checked={detail.enabled}
                  onChange={(v) => setEnabled(rootPath, detail.id, v)}
                  disabled={mutating !== null}
                />
              </div>

              {/* Short description / description */}
              {(detail.interface?.short_description || detail.description) && (
                <p className="mt-5 text-sm leading-relaxed text-foreground/90">
                  {detail.interface?.short_description ?? detail.description}
                </p>
              )}

              <div className="mt-5 grid grid-cols-3 gap-2">
                <CapabilityMetric label="Skills" value={detail.skill_count} />
                <CapabilityMetric label="MCP" value={detail.mcp_servers.length} />
                <CapabilityMetric label="Apps" value={detail.apps.length} />
              </div>

              {detail.compatibility_warnings.length > 0 && (
                <div className="mt-4 rounded-[8px] border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-500">
                    <AlertTriangle className="size-3.5" />
                    Compatibility
                  </div>
                  <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                    {detail.compatibility_warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Long description */}
              {detail.interface?.long_description && (
                <div className="mt-5">
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">
                    About
                  </h3>
                  <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
                    {detail.interface.long_description}
                  </p>
                </div>
              )}

              {/* Capabilities */}
              {detail.interface && detail.interface.capabilities.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">
                    Capabilities
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.interface.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail.mcp_servers.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">
                    MCP servers
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.mcp_servers.map((server) => (
                      <span
                        key={server}
                        className="rounded-full bg-muted/50 px-2 py-0.5 text-[11px] text-foreground/80"
                      >
                        {server}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail.apps.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">
                    App connectors
                  </h3>
                  <div className="space-y-2">
                    {detail.apps.map((app) => (
                      <div
                        key={app.app_id}
                        className="rounded-[8px] border border-border/60 bg-background/55 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {app.app_id}
                          </span>
                          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                            {app.supported ? 'Supported' : 'Needs Solo connector runtime'}
                          </span>
                        </div>
                        {(app.connector_id || app.provider) && (
                          <p className="mt-1 text-[11px] font-mono text-muted-foreground break-all">
                            {app.connector_id ?? app.provider}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Default prompts */}
              {detail.interface && detail.interface.default_prompts.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">
                    Try
                  </h3>
                  <ul className="space-y-1.5">
                    {detail.interface.default_prompts.map((prompt, i) => (
                      <li
                        key={i}
                        className="rounded-[8px] border border-border/60 bg-background/55 px-3 py-2 text-sm text-foreground/90"
                      >
                        {prompt}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Screenshots */}
              {detail.interface && detail.interface.screenshots.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">
                    Screenshots
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {detail.interface.screenshots.map((src, i) => (
                      <img
                        key={i}
                        src={`asset://localhost/${encodeURIComponent(src)}`}
                        alt={`Screenshot ${i + 1}`}
                        className="w-full rounded-[8px] border border-border/40 object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Links */}
              {detail.interface && (detail.interface.website_url || detail.interface.privacy_policy_url || detail.interface.terms_of_service_url) && (
                <div className="mt-5 flex flex-wrap gap-3">
                  {detail.interface.website_url && (
                    <LinkOut href={detail.interface.website_url} label="Website" />
                  )}
                  {detail.interface.privacy_policy_url && (
                    <LinkOut href={detail.interface.privacy_policy_url} label="Privacy" />
                  )}
                  {detail.interface.terms_of_service_url && (
                    <LinkOut href={detail.interface.terms_of_service_url} label="Terms" />
                  )}
                </div>
              )}

              {/* Plugin root */}
              <div className="mt-5 rounded-[8px] bg-muted/20 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  On disk
                </div>
                <div className="text-[11px] font-mono text-muted-foreground mt-1 break-all">
                  {detail.root_path}
                </div>
              </div>

              {/* Uninstall */}
              {canUninstall && (
                <div className="mt-6 pt-5 border-t border-border/60">
                  <button
                    type="button"
                    onClick={() => uninstall(rootPath, detail.id)}
                    disabled={mutating !== null}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-xs',
                      'text-destructive bg-destructive/5 border border-destructive/30',
                      'hover:bg-destructive/10 transition-colors disabled:opacity-50',
                    )}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Uninstall plugin
                  </button>
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};

const LinkOut: FC<{ href: string; label: string }> = ({ href, label }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer noopener"
    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
  >
    {label}
    <ExternalLink className="w-3 h-3" />
  </a>
);

const CapabilityMetric: FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-[8px] border border-border/60 bg-background/55 px-3 py-2">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
      {label}
    </div>
    <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
  </div>
);
