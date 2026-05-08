/**
 * TabBar - Container for tabs in a tile
 * Renders tabs grouped by repo (Chrome-style tab groups) with overflow scrolling.
 * Tabs without a repo association are rendered ungrouped at the end.
 */

import { useCallback, useMemo, useRef, useState, useEffect, type MouseEvent } from 'react';
import { useDrop } from 'react-dnd';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { Brush } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tab } from './Tab';
import { TabGroupComponent } from './TabGroup';
import { computeTabGroups, usePanelTabsStore, type PanelTabsState } from '@/stores/panelTabsStore';
import type { PanelInstance, TileId, PanelInstanceId, TabDragItem } from '@/lib/panels/types';
import { DragItemTypes } from '@/lib/panels/types';
import { useGhostTabCount } from '@/hooks/useGhostTabs';

interface TabBarProps {
  tileId: TileId;
  tabs: PanelInstance[];
  activeTabId: PanelInstanceId | null;
  onTabActivate: (instanceId: PanelInstanceId) => void;
  onTabClose: (instanceId: PanelInstanceId) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  onTabDrop: (instanceId: PanelInstanceId, fromTileId: TileId) => void;
  onTabContextMenu: (e: MouseEvent, instanceId: PanelInstanceId) => void;
}

export function TabBar({
  tileId,
  tabs,
  activeTabId,
  onTabActivate,
  onTabClose,
  onTabReorder,
  onTabDrop,
  onTabContextMenu,
}: TabBarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedWorktrees, setSelectedWorktrees] = useState<Map<string, string | null>>(new Map());

  // Ghost tab sweep
  const ghostCount = useGhostTabCount(tileId);
  const closeGhostTabs = usePanelTabsStore((s) => s.closeGhostTabs);

  const handleSweepGhosts = useCallback(() => {
    closeGhostTabs(tileId);
  }, [closeGhostTabs, tileId]);

  // Pull raw tile state with stable selectors, then memoize the grouping computation
  const tileTabState = usePanelTabsStore(
    (state) => state.tileTabs.get(tileId) ?? null,
  );

  // Only extract instances relevant to this tile's tabs to avoid re-renders
  // when unrelated panel instances change (e.g. dirty state in another tile)
  const tileInstancesRef = useRef<Map<string, PanelInstance>>(new Map());
  const tileInstances = usePanelTabsStore((state) => {
    const tabIds = state.tileTabs.get(tileId)?.tabs;
    if (!tabIds || tabIds.length === 0) {
      if (tileInstancesRef.current.size === 0) return tileInstancesRef.current;
      tileInstancesRef.current = new Map();
      return tileInstancesRef.current;
    }
    // Check if any relevant instance has changed
    let changed = tabIds.length !== tileInstancesRef.current.size;
    if (!changed) {
      for (const id of tabIds) {
        if (state.instances.get(id) !== tileInstancesRef.current.get(id)) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return tileInstancesRef.current;
    const next = new Map<string, PanelInstance>();
    for (const id of tabIds) {
      const inst = state.instances.get(id);
      if (inst) next.set(id, inst);
    }
    tileInstancesRef.current = next;
    return next;
  });

  const { grouped, ungrouped } = useMemo(() => {
    if (!tileTabState) return { grouped: [], ungrouped: [] };
    return computeTabGroups(
      tileId,
      { instances: tileInstances, tileTabs: new Map([[tileId, tileTabState]]) } as PanelTabsState,
      collapsedGroups,
    );
  }, [tileId, tileTabState, tileInstances, collapsedGroups]);

  const handleToggleCollapse = useCallback((repoPath: string) => {
    setCollapsedGroups((prev) => {
      if (prev.has(repoPath)) {
        // Clicking a collapsed group: expand it, collapse all others
        const allRepoPaths = grouped.map((g) => g.repoPath);
        const next = new Set(allRepoPaths);
        next.delete(repoPath);
        return next;
      } else {
        // Clicking an expanded group: just collapse it
        const next = new Set(prev);
        next.add(repoPath);
        return next;
      }
    });
  }, [grouped]);

  const handleSelectWorktree = useCallback((repoPath: string, worktreeId: string | null) => {
    setSelectedWorktrees((prev) => {
      const next = new Map(prev);
      next.set(repoPath, worktreeId);
      return next;
    });
  }, []);

  // Check scroll state
  const updateScrollState = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    setCanScrollLeft(container.scrollLeft > 0);
    setCanScrollRight(
      container.scrollLeft < container.scrollWidth - container.clientWidth - 1
    );
  }, []);

  // Track previous tab count to detect new tabs being added
  const prevTabCountRef = useRef(tabs.length);

  // Update scroll state on resize and tab changes
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // If a new tab was added, scroll it into view
    if (tabs.length > prevTabCountRef.current) {
      requestAnimationFrame(() => {
        container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
      });
    }
    prevTabCountRef.current = tabs.length;

    updateScrollState();
    container.addEventListener('scroll', updateScrollState);
    window.addEventListener('resize', updateScrollState);
    return () => {
      container.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState, tabs.length]);

  // Scroll handlers
  const scrollLeft = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollBy({ left: -150, behavior: 'smooth' });
    }
  }, []);

  const scrollRight = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollBy({ left: 150, behavior: 'smooth' });
    }
  }, []);

  // Handle tab move from another tile
  const handleMoveToTile = useCallback(
    (instanceId: PanelInstanceId, fromTileId: TileId, toTileId: TileId) => {
      if (fromTileId !== toTileId) {
        onTabDrop(instanceId, fromTileId);
      }
    },
    [onTabDrop]
  );

  // Drop target for the tab bar (for dropping tabs from other tiles)
  const [{ isOver }, drop] = useDrop<TabDragItem, unknown, { isOver: boolean }>(
    () => ({
      accept: DragItemTypes.TAB,
      drop: (item) => {
        if (item.sourceTileId !== tileId) {
          onTabDrop(item.instanceId, item.sourceTileId);
        }
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }) && monitor.canDrop(),
      }),
    }),
    [tileId, onTabDrop]
  );

  // Combine drop ref with our container
  const dropRef = useCallback(
    (node: HTMLDivElement | null) => {
      drop(node);
    },
    [drop]
  );

  if (tabs.length === 0) {
    return null;
  }

  const hasGroups = grouped.length > 0;

  return (
    <div
      ref={dropRef}
      className={cn(
        'flex h-11 shrink-0 bg-background/20 backdrop-blur-md border-b border-white/[0.04]',
        'px-2 pt-1 pb-1.5 transition-colors duration-150',
        isOver && 'bg-primary/10'
      )}
    >
      {/* Scroll left button */}
      {canScrollLeft && (
        <button
          className={cn(
            'flex items-center justify-center w-6 h-full',
            'bg-muted/50 hover:bg-muted border-r border-border/30',
            'transition-colors duration-100'
          )}
          onClick={scrollLeft}
          aria-label="Scroll tabs left"
        >
          <ChevronLeftIcon className="w-4 h-4 text-muted-foreground" />
        </button>
      )}

      {/* Tabs container with horizontal scroll */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto overflow-y-hidden tab-scrollbar-none"
        role="tablist"
      >
        <LayoutGroup>
          {/* Grouped tabs (by repo) */}
          {grouped.map((group) => (
            <TabGroupComponent
              key={group.repoPath}
              group={group}
              tileId={tileId}
              allTabs={tabs}
              activeTabId={activeTabId}
              selectedWorktreeId={selectedWorktrees.get(group.repoPath) ?? null}
              onToggleCollapse={handleToggleCollapse}
              onSelectWorktree={handleSelectWorktree}
              onTabActivate={onTabActivate}
              onTabClose={onTabClose}
              onTabReorder={onTabReorder}
              onTabContextMenu={onTabContextMenu}
              onMoveToTile={handleMoveToTile}
            />
          ))}

          {/* Separator between grouped and ungrouped if both exist */}
          {hasGroups && ungrouped.length > 0 && (
            <div className="w-px h-4 mx-1 bg-border/30 rounded-full shrink-0" />
          )}

          {/* Ungrouped tabs (no repo association) */}
          <AnimatePresence initial={false}>
            {ungrouped.map((tab) => {
              const tabIndex = tabs.findIndex((t) => t.id === tab.id);
              return (
                <motion.div
                  key={tab.id}
                  layout
                  initial={{ opacity: 0, scaleX: 0.7, scaleY: 0.85 }}
                  animate={{ opacity: 1, scaleX: 1, scaleY: 1 }}
                  exit={{ opacity: 0, scaleX: 0.85, scaleY: 0.9, transition: { duration: 0.12 } }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  style={{ transformOrigin: 'left center' }}
                >
                  <Tab
                    instance={tab}
                    isActive={tab.id === activeTabId}
                    tileId={tileId}
                    index={tabIndex >= 0 ? tabIndex : 0}
                    tabs={tabs}
                    onActivate={() => onTabActivate(tab.id)}
                    onClose={() => onTabClose(tab.id)}
                    onReorder={onTabReorder}
                    onMoveToTile={handleMoveToTile}
                    onContextMenu={onTabContextMenu}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </LayoutGroup>
      </div>

      {/* Ghost sweep button - close all tabs inactive for 30+ min */}
      {ghostCount > 0 && (
        <button
          className={cn(
            'relative flex items-center justify-center w-7 h-full',
            'bg-muted/30 hover:bg-muted/60 border-l border-border/30',
            'transition-colors duration-100',
          )}
          onClick={handleSweepGhosts}
          title={`Close ${ghostCount} inactive tab${ghostCount > 1 ? 's' : ''}`}
          aria-label={`Close ${ghostCount} ghost tabs`}
        >
          <Brush className="w-4 h-4 text-muted-foreground" size={16} />
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground leading-none px-0.5">
            {ghostCount}
          </span>
        </button>
      )}

      {/* Scroll right button */}
      {canScrollRight && (
        <button
          className={cn(
            'flex items-center justify-center w-6 h-full',
            'bg-muted/50 hover:bg-muted border-l border-border/30',
            'transition-colors duration-100'
          )}
          onClick={scrollRight}
          aria-label="Scroll tabs right"
        >
          <ChevronRightIcon className="w-4 h-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
