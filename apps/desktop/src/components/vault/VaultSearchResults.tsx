/**
 * VaultSearchResults — renders chunks returned by vault_search.
 *
 * V1 uses FTS5 (lexical). Each result shows the entry title, the matching
 * chunk snippet, and the score.
 */

import type { FC } from 'react';
import { useVaultStore } from '@/stores/vaultStore';

export const VaultSearchResults: FC = () => {
  const searchResults = useVaultStore((s) => s.searchResults);
  const searchQuery = useVaultStore((s) => s.searchQuery);

  if (searchResults.length === 0) {
    return (
      <div className="px-1 py-6 text-[11px] text-muted-foreground/70 text-center">
        No matches for &ldquo;{searchQuery}&rdquo;.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-[10px] font-medium text-muted-foreground/70">
        {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}
      </div>
      {searchResults.map((r) => (
        <div
          key={r.chunk.id}
          className="flex flex-col gap-1 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors duration-150"
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium truncate">{r.entry.title}</span>
            <span className="ml-auto text-[9px] text-muted-foreground/60">
              {Math.round(r.score * 100)}%
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground/80 leading-snug line-clamp-3">
            {r.chunk.content}
          </p>
        </div>
      ))}
    </div>
  );
};
