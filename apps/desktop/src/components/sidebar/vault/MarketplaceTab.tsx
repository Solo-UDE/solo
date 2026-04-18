/**
 * MarketplaceTab — browse and install skills from `solo/skills-registry`.
 *
 * Fetches `registry.json` on mount (cached 24h). Search filters by name,
 * description, and tags. Install kicks off a tarball download + sha256
 * verify + extract on the Rust side (Phase 3). Until Phase 3 ships the
 * backend commands, install attempts surface as store errors the user
 * sees inline.
 */

import type { FC } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useMarketplaceStore } from '@/stores/marketplaceStore';
import { useSkillStore } from '@/stores/skillStore';

export const MarketplaceTab: FC = () => {
  const registry = useMarketplaceStore((s) => s.registry);
  const loading = useMarketplaceStore((s) => s.loading);
  const error = useMarketplaceStore((s) => s.error);
  const refreshRegistry = useMarketplaceStore((s) => s.refreshRegistry);
  const install = useMarketplaceStore((s) => s.install);
  const installed = useSkillStore((s) => s.available);

  const [query, setQuery] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    if (!registry && !loading) {
      void refreshRegistry();
    }
  }, [registry, loading, refreshRegistry]);

  const installedIds = useMemo(() => new Set(installed.map((s) => s.name)), [installed]);

  const entries = useMemo(() => {
    const all = registry?.skills ?? [];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((e) => {
      const haystack = `${e.name} ${e.description} ${e.tags.join(' ')} ${e.categories.join(' ')}`;
      return haystack.toLowerCase().includes(q);
    });
  }, [registry, query]);

  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search marketplace…"
          className="flex-1 rounded-[10px] border border-border/60 bg-background/55 px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-border focus:ring-1 focus:ring-ring/30"
        />
        <button
          type="button"
          onClick={() => void refreshRegistry(true)}
          className="rounded-[10px] border border-border/60 bg-background/55 px-2.5 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          title="Refresh registry"
          aria-label="Refresh registry"
        >
          ↻
        </button>
      </div>

      {loading && !registry && (
        <p className="px-1 text-[13px] text-muted-foreground">Loading marketplace…</p>
      )}

      {error && (
        <p className="rounded-[10px] border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] leading-5 text-red-400 text-pretty">
          {error}
        </p>
      )}

      {registry && entries.length === 0 && (
        <p className="px-1 text-[13px] text-muted-foreground">
          {query ? 'No matches.' : 'Registry is empty.'}
        </p>
      )}

      <ul
        role="list"
        className="flex-1 divide-y divide-border/50 overflow-y-auto rounded-[12px] border border-border/60 bg-background/35"
      >
        {entries.map((entry) => {
          const isInstalled = installedIds.has(entry.id);
          return (
            <li key={entry.id} className="px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {entry.name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground/75 tabular-nums">
                      v{entry.version} · {entry.author}
                    </p>
                  </div>
                  {entry.description && (
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground text-pretty">
                      {entry.description}
                    </p>
                  )}
                  {entry.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {entry.tags.slice(0, 5).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-border/50 bg-background/40 px-1.5 py-0.5 text-[10px] text-muted-foreground/80"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={isInstalled || installing === entry.id}
                  onClick={async () => {
                    setInstalling(entry.id);
                    try {
                      await install(entry);
                    } finally {
                      setInstalling(null);
                    }
                  }}
                  className="shrink-0 rounded-[8px] border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isInstalled ? 'Installed' : installing === entry.id ? '…' : 'Install'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
