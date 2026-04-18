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
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search marketplace..."
          className="flex-1 rounded-[10px] border border-border/60 bg-card/60 px-3 py-1.5 text-xs outline-none transition-colors focus:border-border"
        />
        <button
          type="button"
          onClick={() => void refreshRegistry(true)}
          className="rounded-[10px] border border-border/60 bg-card/40 px-2 py-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh registry"
        >
          ↻
        </button>
      </div>

      {loading && !registry && (
        <p className="px-1 text-xs text-muted-foreground">Loading marketplace…</p>
      )}

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-400">
          {error}
        </p>
      )}

      {registry && entries.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {query ? 'No matches.' : 'Registry is empty.'}
        </p>
      )}

      <ul className="flex-1 space-y-1 overflow-y-auto">
        {entries.map((entry) => {
          const isInstalled = installedIds.has(entry.id);
          return (
            <li
              key={entry.id}
              className="rounded-[10px] border border-border/60 bg-card/40 px-2.5 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{entry.name}</span>
                  <span className="ml-1.5 text-[10px] text-muted-foreground/70">
                    v{entry.version} · {entry.author}
                  </span>
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
                  className="rounded-md border border-border/60 bg-card px-2 py-0.5 text-[10px] text-foreground transition-colors hover:bg-card/80 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isInstalled ? 'Installed' : installing === entry.id ? '…' : 'Install'}
                </button>
              </div>
              {entry.description && (
                <p className="mt-1 line-clamp-2 text-muted-foreground">{entry.description}</p>
              )}
              {entry.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {entry.tags.slice(0, 5).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border/50 px-1.5 py-px text-[9px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
