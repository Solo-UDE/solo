/**
 * MarketplaceTab — browse, preview, and install skills from skills.sh.
 */

import type { FC } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, RefreshCcw, Search } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMarketplaceStore } from '@/stores/marketplaceStore';
import { useSkillStore } from '@/stores/skillStore';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import * as marketplaceApi from '@/lib/tauri/marketplace';
import type { RegistryEntry, SkillDetail } from '@/lib/tauri/marketplace';
import { cn } from '@/lib/utils';
import { VirtualList, VirtualTextLines } from '@/components/ui/virtual-list';

const formatInstalls = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
};

const entryKey = (entry: RegistryEntry) => entry.id || `${entry.source}/${entry.skill_id}`;

const installNames = (entry: RegistryEntry) =>
  [entry.id, entry.skill_id, entry.name].filter(Boolean).map((value) => value.toLowerCase());

export const MarketplaceTab: FC = () => {
  const registry = useMarketplaceStore((s) => s.registry);
  const loading = useMarketplaceStore((s) => s.loading);
  const loadingMore = useMarketplaceStore((s) => s.loadingMore);
  const hasMore = useMarketplaceStore((s) => s.hasMore);
  const error = useMarketplaceStore((s) => s.error);
  const refreshRegistry = useMarketplaceStore((s) => s.refreshRegistry);
  const loadMore = useMarketplaceStore((s) => s.loadMore);
  const install = useMarketplaceStore((s) => s.install);
  const installed = useSkillStore((s) => s.available);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const rootPath = useFileExplorerStore((s) => s.rootPath);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<RegistryEntry | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<RegistryEntry[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!registry && !loading) {
      void refreshRegistry();
    }
  }, [registry, loading, refreshRegistry]);

  const installedIds = useMemo(() => {
    const set = new Set<string>();
    for (const skill of installed) {
      set.add(skill.name.toLowerCase());
    }
    return set;
  }, [installed]);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void marketplaceApi
        .searchMarketplace(trimmedQuery, Array.from(installedIds))
        .then((results) => {
          if (!cancelled) {
            setSearchResults(results.map((result) => result.entry));
          }
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [installedIds, trimmedQuery]);

  const entries = trimmedQuery.length >= 2 ? searchResults : registry?.skills ?? [];

  useEffect(() => {
    if (entries.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !entries.some((entry) => entryKey(entry) === entryKey(selected))) {
      setSelected(entries[0] ?? null);
    }
  }, [entries, selected]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailError(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    void marketplaceApi
      .fetchSkillDetail(selected)
      .then((nextDetail) => {
        if (!cancelled) setDetail(nextDetail);
      })
      .catch((err: unknown) => {
        if (!cancelled) setDetailError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 92,
    overscan: 12,
  });

  useEffect(() => {
    if (trimmedQuery.length >= 2 || !hasMore || loadingMore) return;
    const last = virtualizer.getVirtualItems().at(-1);
    if (last && last.index >= entries.length - 30) {
      void loadMore();
    }
  }, [entries.length, hasMore, loadMore, loadingMore, trimmedQuery.length, virtualizer]);

  const installEntry = async (entry: RegistryEntry) => {
    setInstalling(entryKey(entry));
    try {
      await install(entry);
      if (rootPath) await loadSkills(rootPath);
    } finally {
      setInstalling(null);
    }
  };

  const isInstalled = (entry: RegistryEntry) =>
    installNames(entry).some((name) => installedIds.has(name));

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(340px,0.9fr)_minmax(420px,1.1fr)]">
      <section className="flex min-h-0 flex-col border-b border-border/50 lg:border-b-0 lg:border-r">
        <div className="shrink-0 space-y-3 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/65"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search skills.sh"
                className="h-10 w-full rounded-[10px] border border-border/60 bg-background/55 pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none transition-[border-color,box-shadow,background-color] duration-150 focus:border-border focus:bg-background/70 focus:ring-1 focus:ring-ring/30"
              />
            </div>
            <button
              type="button"
              onClick={() => void refreshRegistry(true)}
              className="grid size-10 place-items-center rounded-[10px] border border-border/60 bg-background/55 text-muted-foreground transition-[background-color,border-color,color,transform] duration-150 hover:bg-background/70 hover:text-foreground active:scale-[0.96]"
              title="Refresh skills.sh"
              aria-label="Refresh skills.sh"
            >
              <RefreshCcw aria-hidden="true" className="size-4" />
            </button>
          </div>
          <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
            <span>
              {trimmedQuery.length >= 2
                ? searching
                  ? 'Searching skills.sh'
                  : `${entries.length} search results`
                : `${registry?.skills.length ?? 0} loaded${hasMore ? '' : ' · all loaded'}`}
            </span>
            {loadingMore && <span>Loading more</span>}
          </div>
        </div>

        {error && (
          <p className="mx-4 mb-3 rounded-[8px] border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] leading-5 text-red-400 text-pretty">
            {error}
          </p>
        )}

        {loading && !registry ? (
          <p className="px-5 text-[13px] text-muted-foreground">Loading skills.sh…</p>
        ) : entries.length === 0 ? (
          <p className="px-5 text-[13px] text-muted-foreground">
            {trimmedQuery.length >= 2 ? 'No matches.' : 'No skills found.'}
          </p>
        ) : (
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
            data-virtualized-list="marketplace-results"
            data-total-items={entries.length}
            data-rendered-items={virtualizer.getVirtualItems().length}
          >
            <div
              className="relative w-full"
              style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const entry = entries[item.index];
                if (!entry) return null;
                const active = selected ? entryKey(selected) === entryKey(entry) : false;
                const installedEntry = isInstalled(entry);
                const installingEntry = installing === entryKey(entry);
                return (
                  <div
                    key={entryKey(entry)}
                    data-virtual-row
                    data-index={item.index}
                    className="absolute left-0 top-0 w-full px-2 py-1"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <div
                      className={cn(
                        'group flex min-h-[84px] w-full items-start gap-3 rounded-[10px] border px-3 py-2.5 transition-[background-color,border-color,box-shadow] duration-150',
                        active
                          ? 'border-border/80 bg-card shadow-[0_10px_24px_-22px_rgba(0,0,0,0.45)]'
                          : 'border-transparent bg-transparent hover:border-border/50 hover:bg-background/45',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelected(entry)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-[13px] font-medium text-foreground">
                            {entry.name}
                          </p>
                          {entry.is_official && (
                            <span className="shrink-0 rounded-[6px] border border-emerald-500/25 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500">
                              Official
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
                          {entry.source}
                        </p>
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="tabular-nums">{formatInstalls(entry.installs)} installs</span>
                          {entry.is_duplicate && <span>Duplicate</span>}
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={installedEntry || installingEntry}
                        className={cn(
                          'mt-0.5 inline-flex min-h-10 shrink-0 items-center rounded-[9px] border px-2.5 text-[11px] font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.96]',
                          installedEntry
                            ? 'border-border/50 text-muted-foreground'
                            : 'border-border/60 text-foreground group-hover:bg-background disabled:cursor-not-allowed disabled:opacity-50',
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!installedEntry && !installingEntry) void installEntry(entry);
                        }}
                      >
                        {installedEntry ? 'Installed' : installingEntry ? 'Installing' : 'Install'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <SkillPreview
        detail={detail}
        entry={selected}
        error={detailError}
        installed={selected ? isInstalled(selected) : false}
        installing={selected ? installing === entryKey(selected) : false}
        loading={detailLoading}
        onInstall={() => {
          if (selected) void installEntry(selected);
        }}
      />
    </div>
  );
};

interface SkillPreviewProps {
  detail: SkillDetail | null;
  entry: RegistryEntry | null;
  error: string | null;
  installed: boolean;
  installing: boolean;
  loading: boolean;
  onInstall: () => void;
}

const SkillPreview: FC<SkillPreviewProps> = ({
  detail,
  entry,
  error,
  installed,
  installing,
  loading,
  onInstall,
}) => {
  if (!entry) {
    return (
      <aside className="hidden min-h-0 flex-col lg:flex">
        <div className="p-5 text-[13px] text-muted-foreground">Select a skill to preview.</div>
      </aside>
    );
  }

  const primaryFile =
    detail?.files.find((file) => file.path === 'AGENTS.md') ??
    detail?.files.find((file) => file.path === 'SKILL.md') ??
    detail?.files[0] ??
    null;

  return (
    <aside className="flex min-h-0 flex-col bg-background/35">
      <div className="shrink-0 border-b border-border/50 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold text-foreground">{entry.name}</h3>
              {entry.is_official && (
                <span className="shrink-0 rounded-[6px] border border-emerald-500/25 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500">
                  Official
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-[12px] text-muted-foreground">{entry.source}</p>
          </div>
          <button
            type="button"
            disabled={installed || installing || (detail ? !detail.installable : false)}
            onClick={onInstall}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-border/60 bg-background/60 px-3 text-[12px] font-medium text-foreground transition-[background-color,border-color,color,transform] duration-150 hover:bg-background active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            <Download aria-hidden="true" className="size-3.5" />
            {installed ? 'Installed' : installing ? 'Installing' : 'Install'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-[9px] border border-border/55 bg-background/45 px-2 py-1.5">
            <p className="text-muted-foreground">Installs</p>
            <p className="mt-0.5 font-medium tabular-nums text-foreground">{formatInstalls(entry.installs)}</p>
          </div>
          <div className="rounded-[9px] border border-border/55 bg-background/45 px-2 py-1.5">
            <p className="text-muted-foreground">Files</p>
            <p className="mt-0.5 font-medium tabular-nums text-foreground">{detail?.files.length ?? '…'}</p>
          </div>
          <div className="rounded-[9px] border border-border/55 bg-background/45 px-2 py-1.5">
            <p className="text-muted-foreground">Source</p>
            <p className="mt-0.5 truncate font-medium text-foreground">{entry.source_type || 'github'}</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {loading && <p className="text-[13px] text-muted-foreground">Loading preview…</p>}

        {error && (
          <p className="rounded-[8px] border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] leading-5 text-red-400 text-pretty">
            {error}
          </p>
        )}

        {detail && (
          <div className="space-y-5">
            {detail.description && (
              <section>
                <h4 className="text-[11px] font-semibold uppercase text-muted-foreground">
                  What it does
                </h4>
                <p className="mt-2 text-[13px] leading-5 text-foreground/90 text-pretty">
                  {detail.description}
                </p>
              </section>
            )}

            <section>
              <h4 className="text-[11px] font-semibold uppercase text-muted-foreground">
                Contains
              </h4>
              {detail.files.length > 0 ? (
                <VirtualList
                  items={detail.files}
                  estimateSize={() => 34}
                  overscan={8}
                  measureElement={false}
                  role="list"
                  className="mt-2 max-h-44 rounded-[10px] border border-border/55 bg-background/35"
                  itemClassName="border-b border-border/45 last:border-b-0"
                  getItemKey={(file) => file.path}
                  testId="marketplace-detail-files"
                  renderItem={(file) => (
                    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]" role="listitem">
                      <span className="min-w-0 truncate text-foreground">{file.path}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {file.bytes.toLocaleString()} B
                      </span>
                    </div>
                  )}
                />
              ) : (
                <p className="mt-2 text-[12px] leading-5 text-muted-foreground text-pretty">
                  File preview is not available for this source yet.
                </p>
              )}
            </section>

            {primaryFile && (
              <section>
                <h4 className="text-[11px] font-semibold uppercase text-muted-foreground">
                  {primaryFile.path}
                </h4>
                <VirtualTextLines
                  lines={primaryFile.contents.split('\n')}
                  estimateSize={() => 20}
                  overscan={18}
                  className="mt-2 max-h-[440px] rounded-[10px] border border-border/55 bg-background/45 p-3 font-mono text-[11px]"
                  lineClassName="whitespace-pre leading-5 text-muted-foreground"
                  testId="marketplace-primary-file"
                />
              </section>
            )}

            <section className="space-y-2">
              <a
                href={detail.web_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
                Open on skills.sh
              </a>
              <code className="block rounded-[10px] border border-border/55 bg-background/45 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                {detail.install_command}
              </code>
              {!detail.installable && (
                <p className="text-[12px] leading-5 text-muted-foreground text-pretty">
                  {detail.install_note}
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </aside>
  );
};
