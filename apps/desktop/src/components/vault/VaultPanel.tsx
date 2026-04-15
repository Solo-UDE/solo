/**
 * VaultPanel — Studio-sidebar surface for the agent memory vault.
 *
 * V0: shell only. Renders the scope toggle, the drop-zone placeholder, a
 * lightweight search box, and an empty-state explaining the vault's purpose.
 * Wires to `vaultStore` so V1 plug-in is a one-line swap.
 */

import { useEffect, type FC } from 'react';
import { Vault as VaultIcon, Pushpin, MagnifyingGlass } from '@phosphor-icons/react';
import { useVaultStore } from '@/stores/vaultStore';
import { VaultScopeToggle } from './VaultScopeToggle';
import { VaultDropZone } from './VaultDropZone';
import { VaultEntryList } from './VaultEntryList';
import { VaultEmptyState } from './VaultEmptyState';

export const VaultPanel: FC = () => {
  const entries = useVaultStore((s) => s.entries);
  const unsortedCount = useVaultStore((s) => s.unsortedCount);
  const searchQuery = useVaultStore((s) => s.searchQuery);
  const setSearchQuery = useVaultStore((s) => s.setSearchQuery);
  const fetchEntries = useVaultStore((s) => s.fetchEntries);
  const fetchUnsortedCount = useVaultStore((s) => s.fetchUnsortedCount);
  const runSearch = useVaultStore((s) => s.runSearch);
  const activeScope = useVaultStore((s) => s.activeScope);

  useEffect(() => {
    void fetchEntries();
    void fetchUnsortedCount();
  }, [activeScope, fetchEntries, fetchUnsortedCount]);

  const hasEntries = entries.size > 0;

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center gap-2 shrink-0">
        <VaultIcon className="w-4 h-4 text-muted-foreground" weight="fill" />
        <span className="text-xs font-medium">Vault</span>
        {unsortedCount > 0 && (
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            {unsortedCount} unsorted
          </span>
        )}
      </div>

      {/* Scope toggle */}
      <div className="px-3 pb-2 shrink-0">
        <VaultScopeToggle />
      </div>

      {/* Search */}
      <div className="px-3 pb-2 shrink-0">
        <div className="relative">
          <MagnifyingGlass
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
            }}
            placeholder="Search vault memory…"
            className="w-full h-8 pl-7 pr-2 rounded-lg bg-muted/40 border-none text-xs focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 focus:outline-none transition-colors duration-150 placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
        {hasEntries ? (
          <VaultEntryList />
        ) : (
          <>
            <VaultDropZone />
            <VaultEmptyState />
          </>
        )}
      </div>

      {/* Pinned indicator footer (placeholder) */}
      <div className="px-3 py-2 border-t border-border/30 shrink-0 flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
        <Pushpin className="w-3 h-3" />
        <span>Pin sources of truth to force-inject them into the agent.</span>
      </div>
    </div>
  );
};
