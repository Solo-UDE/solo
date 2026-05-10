/**
 * TabBar - Container for tabs in a tile
 * Renders fixed-width tabs grouped by repo, with extra tabs in an overflow menu.
 * Tabs without a repo association are rendered ungrouped at the end.
 */

import { useCallback, useMemo, useRef, useState, useEffect, type MouseEvent } from 'react';
import { useDrop } from 'react-dnd';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Cross2Icon } from '@radix-ui/react-icons';
import { Brush, ChevronDown, FileText, MessageCircle, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VirtualList } from '@/components/ui/virtual-list';
import { Tab } from './Tab';
import { TabGroupComponent } from './TabGroup';
import { computeTabGroups, usePanelTabsStore, type PanelTabsState } from '@/stores/panelTabsStore';
import type { PanelInstance, TileId, PanelInstanceId, TabDragItem } from '@/lib/panels/types';
import { DragItemTypes } from '@/lib/panels/types';
import { useGhostTabCount } from '@/hooks/useGhostTabs';
import { BUILTIN_PANEL_TYPES, TAB_BAR } from '@/lib/panels/constants';
import { getTabTypeVisuals } from '@/lib/panels/tabTypeVisuals';

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
  const [containerWidth, setContainerWidth] = useState(0);
  const [overflowOpen, setOverflowOpen] = useState(false);
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
  const renderUngrouped = grouped.length === 0 && ungrouped.length === 0 ? tabs : ungrouped;

  const handleToggleCollapse = useCallback((repoPath: string) => {
    setCollapsedGroups((prev) => {
      if (prev.has(repoPath)) {
        // Clicking a collapsed group: expand it, collapse all others
        const allRepoPaths = grouped.map((g) => g.repoPath);
        const next = new Set<string>(allRepoPaths);
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

  // Track available width so tabs stay targetable and extras move to the menu.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const updateWidth = () => setContainerWidth(container.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
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

  const visibleTabIds = useMemo(() => {
    if (tabs.length === 0) return new Set<PanelInstanceId>();
    if (containerWidth <= 0) return new Set(tabs.map((tab) => tab.id));

    const groupHeaderBudget = grouped.length * TAB_BAR.groupLabelWidth;
    const separatorBudget = grouped.length > 0 && renderUngrouped.length > 0 ? 12 : 0;
    const usableWidth = Math.max(TAB_BAR.fixedTabWidth, containerWidth - groupHeaderBudget - separatorBudget);
    const visibleSlots = Math.max(1, Math.floor(usableWidth / TAB_BAR.fixedTabWidth));

    if (tabs.length <= visibleSlots) {
      return new Set(tabs.map((tab) => tab.id));
    }

    const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
    const selected = new Set<PanelInstanceId>();
    for (const tab of tabs) {
      if (tab.isPinned) selected.add(tab.id);
    }
    const active = tabs[activeIndex];
    if (active) selected.add(active.id);

    const addIfRoom = (tab: PanelInstance | undefined) => {
      if (!tab || selected.has(tab.id) || selected.size >= visibleSlots) return;
      selected.add(tab.id);
    };

    for (let offset = 1; selected.size < visibleSlots && offset < tabs.length; offset += 1) {
      addIfRoom(tabs[activeIndex + offset]);
      addIfRoom(tabs[activeIndex - offset]);
    }

    for (const tab of tabs) {
      addIfRoom(tab);
    }

    return selected;
  }, [activeTabId, containerWidth, grouped.length, renderUngrouped.length, tabs]);

  const overflowTabs = useMemo(
    () => tabs.filter((tab) => !visibleTabIds.has(tab.id)),
    [tabs, visibleTabIds],
  );
  const hasGroups = grouped.length > 0;
  const hasVisibleGroupedTabs = grouped.some((group) => group.tabs.some((tab) => visibleTabIds.has(tab.id)));
  const visibleUngrouped = renderUngrouped.filter((tab) => visibleTabIds.has(tab.id));

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      ref={dropRef}
      className={cn(
        'relative z-30 flex h-11 shrink-0 overflow-visible bg-background/20 backdrop-blur-md border-b border-white/[0.04]',
        'px-2 pt-1 pb-1.5 transition-colors duration-150',
        isOver && 'bg-primary/10'
      )}
    >
      {/* Fixed-width tabs. Overflowed tabs live in the menu at the end. */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-w-0 flex items-center gap-0.5 overflow-hidden"
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
              visibleTabIds={visibleTabIds}
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
          {hasGroups && hasVisibleGroupedTabs && visibleUngrouped.length > 0 && (
            <div className="w-px h-4 mx-1 bg-border/30 rounded-full shrink-0" />
          )}

          {/* Ungrouped tabs (no repo association) */}
          <AnimatePresence initial={false}>
            {visibleUngrouped.map((tab) => {
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

      {overflowTabs.length > 0 && (
        <TabOverflowMenu
          tabs={overflowTabs}
          activeTabId={activeTabId}
          open={overflowOpen}
          onOpenChange={setOverflowOpen}
          onTabActivate={(tabId) => {
            onTabActivate(tabId);
            setOverflowOpen(false);
          }}
          onTabClose={onTabClose}
          onTabContextMenu={onTabContextMenu}
        />
      )}

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

    </div>
  );
}

interface TabOverflowMenuProps {
  tabs: PanelInstance[];
  activeTabId: PanelInstanceId | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTabActivate: (instanceId: PanelInstanceId) => void;
  onTabClose: (instanceId: PanelInstanceId) => void;
  onTabContextMenu: (e: MouseEvent, instanceId: PanelInstanceId) => void;
}

function TabOverflowMenu({
  tabs,
  activeTabId,
  open,
  onOpenChange,
  onTabActivate,
  onTabClose,
  onTabContextMenu,
}: TabOverflowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onOpenChange, open]);

  return (
    <div ref={menuRef} className="relative ml-1 shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          'flex h-full min-w-10 items-center justify-center gap-1 rounded-[8px] border border-border/50 px-2',
          'bg-background/60 text-muted-foreground transition-[background-color,color,transform] duration-150',
          'hover:bg-muted/70 hover:text-foreground active:scale-[0.96]',
          open && 'bg-muted text-foreground',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${tabs.length} more tab${tabs.length === 1 ? '' : 's'}`}
        title={`${tabs.length} more tab${tabs.length === 1 ? '' : 's'}`}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        <span className="text-[11px] font-medium tabular-nums">{tabs.length}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform duration-150', open && 'rotate-180')} aria-hidden="true" />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'absolute right-0 top-full z-50 mt-1 w-[320px] overflow-hidden rounded-[12px]',
              'border border-border/65 bg-popover/96 p-1.5 text-popover-foreground shadow-[0_18px_42px_-24px_rgba(0,0,0,0.7)] backdrop-blur-md',
            )}
            role="menu"
            aria-label="Overflow tabs"
          >
            <VirtualList
              items={tabs}
              estimateSize={() => 44}
              overscan={8}
              className="max-h-[360px] pr-0.5"
              itemClassName="pb-1"
              getItemKey={(tab) => tab.id}
              testId="tab-overflow-menu"
              renderItem={(tab) => (
                <OverflowTabItem
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onActivate={() => onTabActivate(tab.id)}
                  onClose={() => onTabClose(tab.id)}
                  onContextMenu={(event) => onTabContextMenu(event, tab.id)}
                />
              )}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function OverflowTabItem({
  tab,
  isActive,
  onActivate,
  onClose,
  onContextMenu,
}: {
  tab: PanelInstance;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onContextMenu: (event: MouseEvent) => void;
}) {
  const visuals = getTabTypeVisuals(tab, false);
  const isAgent = tab.panelType === BUILTIN_PANEL_TYPES.AGENT;
  const dataPath =
    typeof tab.data.filePath === 'string'
      ? tab.data.filePath
      : typeof tab.data.path === 'string'
        ? tab.data.path
        : null;

  const handleClose = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      onContextMenu={onContextMenu}
      className={cn(
        'group flex min-h-10 w-full items-center gap-1 rounded-[8px]',
        'transition-[background-color,color] duration-150',
        isActive
          ? 'bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:bg-muted/65 hover:text-foreground',
      )}
      role="none"
    >
      <button
        type="button"
        onClick={onActivate}
        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 text-left active:scale-[0.99]"
        role="menuitem"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-muted/60 text-muted-foreground">
          {visuals.languageDot ? (
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: visuals.languageDot }} />
          ) : isAgent ? (
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[13px] font-medium leading-5', visuals.titleClass)}>
            {tab.title}
          </span>
          {dataPath ? (
            <span className="block truncate text-[11px] leading-4 text-muted-foreground/70">
              {dataPath}
            </span>
          ) : null}
        </span>
        {tab.isDirty ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" title="Unsaved changes" />
        ) : null}
      </button>
      <button
        type="button"
        className={cn(
          'mr-1 shrink-0 rounded-[6px] p-1 text-muted-foreground opacity-0 transition-[background-color,color,opacity,transform] duration-150',
          'hover:bg-muted hover:text-foreground active:scale-[0.96] group-hover:opacity-100 group-focus-visible:opacity-100',
          tab.isDirty && 'opacity-100',
        )}
        onClick={handleClose}
        role="button"
        aria-label={`Close ${tab.title}`}
        title={`Close ${tab.title}`}
      >
        <Cross2Icon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
