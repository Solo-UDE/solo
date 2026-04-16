/**
 * TabSwitcher - Command palette for quick tab switching (Cmd+Shift+T)
 * Fuzzy-searches all open tabs across all tiles, sorted by recency.
 * Grouped by repo with colored headers reusing the repo identity system.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { cn } from '@/lib/utils';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { useRepoStore } from '@/stores/repoStore';
import { getRepoColorVar, getRepoIcon } from '@/lib/repoIdentity';
import { getTabTypeVisuals } from '@/lib/panels/tabTypeVisuals';
import type { PanelInstance, TileId } from '@/lib/panels/types';

interface TabSwitcherProps {
  open: boolean;
  onClose: () => void;
}

interface TabSearchResult {
  instance: PanelInstance;
  tileId: TileId;
}

/** Simple fuzzy match - checks if all query chars appear in order in the target. */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Score a fuzzy match - lower is better. Prefers prefix matches and shorter targets. */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let score = 0;

  // Prefix bonus
  if (t.startsWith(q)) return -1000 + t.length;

  // Consecutive match bonus
  let qi = 0;
  let consecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive++;
      score -= consecutive * 2;
    } else {
      consecutive = 0;
      score += 1;
    }
  }

  return score + t.length;
}

export function TabSwitcher({ open, onClose }: TabSwitcherProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const setActiveTab = usePanelTabsStore((s) => s.setActiveTab);

  // Select raw Maps (stable references via Immer - only change on actual mutation)
  const tileTabs = usePanelTabsStore((s) => s.tileTabs);
  const instances = usePanelTabsStore((s) => s.instances);

  // Derive tab list in a useMemo so we don't create a new array inside the selector
  // (returning a new array from a Zustand selector triggers infinite re-renders)
  const allTabResults = useMemo((): TabSearchResult[] => {
    const results: TabSearchResult[] = [];
    for (const [tileId, tileState] of tileTabs.entries()) {
      for (const tabId of tileState.tabs) {
        const instance = instances.get(tabId);
        if (instance) {
          results.push({ instance, tileId });
        }
      }
    }
    results.sort((a, b) => (b.instance.lastAccessed ?? 0) - (a.instance.lastAccessed ?? 0));
    return results;
  }, [tileTabs, instances]);

  // Filter by fuzzy query
  const filteredResults = useMemo(() => {
    if (!query.trim()) return allTabResults;
    return allTabResults
      .filter((r) => fuzzyMatch(query, r.instance.title))
      .sort((a, b) => fuzzyScore(query, a.instance.title) - fuzzyScore(query, b.instance.title));
  }, [allTabResults, query]);

  // Group results by repoPath for display
  const groupedResults = useMemo(() => {
    const groups: { repoPath: string | null; tabs: TabSearchResult[] }[] = [];
    const groupMap = new Map<string | null, TabSearchResult[]>();

    for (const result of filteredResults) {
      const key = result.instance.repoPath ?? null;
      const existing = groupMap.get(key);
      if (existing) {
        existing.push(result);
      } else {
        const arr = [result];
        groupMap.set(key, arr);
        groups.push({ repoPath: key, tabs: arr });
      }
    }
    return groups;
  }, [filteredResults]);

  // Flatten for keyboard navigation
  const flatResults = useMemo(() => filteredResults, [filteredResults]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Focus input after animation
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp selected index when results change
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, flatResults.length - 1)));
  }, [flatResults.length]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (result: TabSearchResult) => {
      setActiveTab(result.tileId, result.instance.id);
      onClose();
    },
    [setActiveTab, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, flatResults.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatResults[selectedIndex]) {
            handleSelect(flatResults[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatResults, selectedIndex, handleSelect, onClose],
  );

  // Build a flat index counter for rendering grouped results
  let flatIndex = 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className={cn(
              'fixed top-[15%] left-1/2 -translate-x-1/2 z-[101]',
              'w-[480px] max-h-[60vh] flex flex-col',
              'bg-popover/95 backdrop-blur-xl border border-border/40',
              'rounded-xl shadow-2xl overflow-hidden',
            )}
            onKeyDown={handleKeyDown}
          >
            {/* Search input */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
              <MagnifyingGlassIcon className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search open tabs..."
                className={cn(
                  'flex-1 bg-transparent text-sm text-foreground',
                  'placeholder:text-muted-foreground/50',
                  'outline-none',
                )}
              />
              <kbd className="text-[10px] text-muted-foreground/50 font-mono px-1.5 py-0.5 rounded border border-border/30">
                esc
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="overflow-y-auto py-1">
              {flatResults.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {query ? 'No matching tabs' : 'No open tabs'}
                </div>
              ) : (
                groupedResults.map((group) => (
                  <div key={group.repoPath ?? 'ungrouped'}>
                    <RepoGroupHeader repoPath={group.repoPath} />
                    {group.tabs.map((result) => {
                      const currentFlatIndex = flatIndex++;
                      const isSelected = currentFlatIndex === selectedIndex;
                      return (
                        <TabResultItem
                          key={result.instance.id}
                          result={result}
                          isSelected={isSelected}
                          onClick={() => handleSelect(result)}
                          onMouseEnter={() => setSelectedIndex(currentFlatIndex)}
                        />
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center gap-3 px-4 py-2 border-t border-border/30 text-[10px] text-muted-foreground/50">
              <span>
                <kbd className="font-mono px-1 py-0.5 rounded border border-border/30 mr-0.5">
                  ↑↓
                </kbd>{' '}
                navigate
              </span>
              <span>
                <kbd className="font-mono px-1 py-0.5 rounded border border-border/30 mr-0.5">
                  ↵
                </kbd>{' '}
                open
              </span>
              <span>
                <kbd className="font-mono px-1 py-0.5 rounded border border-border/30 mr-0.5">
                  esc
                </kbd>{' '}
                close
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Sub-components

function RepoGroupHeader({ repoPath }: { repoPath: string | null }) {
  const repo = useRepoStore((s) => (repoPath ? s.repos.get(repoPath) : undefined));

  if (!repoPath || !repo) {
    return (
      <div className="px-4 py-1 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
        Other
      </div>
    );
  }

  const Icon = getRepoIcon(repo.icon);
  const colorVar = getRepoColorVar(repo.color);

  return (
    <div className="flex items-center gap-1.5 px-4 py-1">
      <Icon className="w-3 h-3" style={{ color: colorVar }} />
      <span
        className="text-[10px] font-medium uppercase tracking-wider"
        style={{ color: colorVar }}
      >
        {repo.name}
      </span>
    </div>
  );
}

function TabResultItem({
  result,
  isSelected,
  onClick,
  onMouseEnter,
}: {
  result: TabSearchResult;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  const visuals = getTabTypeVisuals(result.instance, false);

  return (
    <button
      data-selected={isSelected}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'flex items-center gap-2 w-full px-4 py-1.5 text-left',
        'text-sm transition-colors duration-75',
        isSelected
          ? 'bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:bg-foreground/[0.04]',
      )}
    >
      {/* Language dot or type indicator */}
      {visuals.languageDot ? (
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: visuals.languageDot }}
        />
      ) : visuals.borderStyle === 'idle-agent' || visuals.borderStyle === 'streaming' ? (
        <span className="w-2 h-2 rounded-full bg-emerald-400/50 shrink-0" />
      ) : visuals.borderStyle === 'diff' ? (
        <span className="w-2 h-2 rounded-full shrink-0 overflow-hidden flex">
          <span className="w-1 h-2 bg-red-400/70" />
          <span className="w-1 h-2 bg-emerald-400/70" />
        </span>
      ) : (
        <span className="w-2 shrink-0" />
      )}

      {/* Dirty indicator */}
      {result.instance.isDirty && (
        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
      )}

      <span className={cn('truncate flex-1', visuals.titleClass)}>
        {result.instance.title}
      </span>

      {result.instance.isPinned && (
        <span className="text-[10px] text-muted-foreground/40">pinned</span>
      )}
    </button>
  );
}
