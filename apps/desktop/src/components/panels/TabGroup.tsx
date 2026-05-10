/**
 * TabGroup - Repo group pill with worktree switcher dropdown.
 * Shows a colored pill: [Icon] RepoName / branchName [caret]
 * Click pill body to collapse/expand. Click caret to switch worktrees.
 * Renders flat tabs for the selected worktree (no sub-groups).
 */

import { useCallback, useMemo, useState, useRef, useEffect, type FC, type MouseEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDownIcon, CheckIcon } from '@radix-ui/react-icons';
import { GitBranch } from 'lucide-react';
import { getRepoIcon, getRepoColorVar, getRepoColorMutedVar } from '@/lib/repoIdentity';
import { useRepoStore } from '@/stores/repoStore';
import type { TabGroup as TabGroupType } from '@/stores/panelTabsStore';
import { Tab } from './Tab';
import { cn } from '@/lib/utils';
import type { PanelInstance, TileId, PanelInstanceId } from '@/lib/panels/types';

interface TabGroupProps {
  group: TabGroupType;
  tileId: TileId;
  allTabs: PanelInstance[];
  activeTabId: PanelInstanceId | null;
  visibleTabIds?: Set<PanelInstanceId>;
  selectedWorktreeId: string | null;
  onToggleCollapse: (repoPath: string) => void;
  onSelectWorktree: (repoPath: string, worktreeId: string | null) => void;
  onTabActivate: (instanceId: PanelInstanceId) => void;
  onTabClose: (instanceId: PanelInstanceId) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  onTabContextMenu: (e: MouseEvent, instanceId: PanelInstanceId) => void;
  onMoveToTile: (instanceId: PanelInstanceId, fromTileId: TileId, toTileId: TileId) => void;
}

export const TabGroupComponent: FC<TabGroupProps> = ({
  group,
  tileId,
  allTabs,
  activeTabId,
  visibleTabIds,
  selectedWorktreeId,
  onToggleCollapse,
  onSelectWorktree,
  onTabActivate,
  onTabClose,
  onTabReorder,
  onTabContextMenu,
  onMoveToTile,
}) => {
  const repo = useRepoStore((s) => s.repos.get(group.repoPath));
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filter tabs by selected worktree
  const visibleTabs = useMemo(() => {
    const worktreeTabs = selectedWorktreeId === null && group.worktreeIds.size <= 1
      ? group.tabs
      : group.tabs.filter(
      (tab) => (tab.worktreeId ?? null) === selectedWorktreeId,
    );
    return visibleTabIds ? worktreeTabs.filter((tab) => visibleTabIds.has(tab.id)) : worktreeTabs;
  }, [group.tabs, selectedWorktreeId, group.worktreeIds.size, visibleTabIds]);

  const hasVisibleTabs = visibleTabs.length > 0;

  const handleToggle = useCallback(() => {
    onToggleCollapse(group.repoPath);
  }, [onToggleCollapse, group.repoPath]);

  const handleDropdownClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    setDropdownOpen((prev) => !prev);
  }, []);

  const handleSelectWorktree = useCallback(
    (worktreeId: string | null) => {
      onSelectWorktree(group.repoPath, worktreeId);
      setDropdownOpen(false);
    },
    [onSelectWorktree, group.repoPath],
  );

  // Close dropdown on click-outside
  useEffect(() => {
    if (!dropdownOpen) return;

    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  if (!repo) return null;

  const Icon = getRepoIcon(repo.icon);
  const colorVar = getRepoColorVar(repo.color);
  const mutedVar = getRepoColorMutedVar(repo.color);

  // Resolve branch name for the selected worktree
  const selectedBranchName = useMemo(() => {
    if (selectedWorktreeId === null) {
      return repo.currentBranch || 'main';
    }
    const wt = repo.worktrees.find((w) => w.id === selectedWorktreeId);
    return wt?.branch ?? wt?.id ?? 'branch';
  }, [selectedWorktreeId, repo.worktrees, repo.currentBranch]);

  const hasMultipleWorktrees = group.worktreeIds.size > 1;

  if (!hasVisibleTabs && !group.collapsed) return null;

  return (
    <div className="flex items-center gap-0.5 shrink-0" ref={dropdownRef}>
      {/* Group label pill */}
      <button
        onClick={handleToggle}
        className={cn(
          'flex items-center gap-1 h-[32px] px-2 rounded-md',
          'text-[12px] font-medium select-none',
          'hover:brightness-110 active:scale-[0.97]',
          'transition-all duration-150',
        )}
        style={{
          backgroundColor: mutedVar,
          color: colorVar,
        }}
        title={
          group.collapsed
            ? `Expand ${repo.name} (${visibleTabs.length} tabs)`
            : `Collapse ${repo.name}`
        }
      >
        <Icon className="w-3 h-3" />
        <span className="truncate max-w-[80px]">{repo.name}</span>
        <span className="text-[10px] opacity-60">/</span>
        <span className="truncate max-w-[60px] text-[10px] opacity-70">
          {selectedBranchName}
        </span>
        {group.collapsed && (
          <span className="text-[10px] opacity-70">{visibleTabs.length}</span>
        )}
        {hasMultipleWorktrees ? (
          <div
            role="button"
            tabIndex={-1}
            onClick={handleDropdownClick}
            className="flex items-center justify-center ml-0.5 -mr-0.5 rounded hover:bg-white/10 p-0.5"
          >
            <motion.div
              animate={{ rotate: dropdownOpen ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              <ChevronDownIcon className="w-2.5 h-2.5 opacity-60" />
            </motion.div>
          </div>
        ) : (
          <motion.div
            animate={{ rotate: group.collapsed ? -90 : 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            <ChevronDownIcon className="w-2.5 h-2.5 opacity-60" />
          </motion.div>
        )}
      </button>

      {/* Worktree dropdown */}
      <AnimatePresence>
        {dropdownOpen && hasMultipleWorktrees && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={cn(
              'absolute top-full left-0 z-50 mt-1',
              'min-w-[180px] max-w-[260px] py-1',
              'bg-popover/95 backdrop-blur-xl border border-border/40',
              'rounded-lg shadow-lg',
            )}
          >
            {repo.worktrees.map((wt) => {
              const wtId = wt.is_main ? null : wt.id;
              const isSelected = selectedWorktreeId === wtId;
              return (
                <button
                  key={wt.id}
                  onClick={() => handleSelectWorktree(wtId)}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 text-left',
                    'text-sm hover:bg-foreground/[0.06] transition-colors duration-100',
                    isSelected
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <GitBranch className="w-3.5 h-3.5 shrink-0" size={14} />
                  <span className="truncate">
                    {wt.is_main ? 'main' : (wt.branch ?? wt.id)}
                  </span>
                  {isSelected && (
                    <CheckIcon className="w-3.5 h-3.5 ml-auto shrink-0 opacity-70" />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs (hidden when collapsed) */}
      <AnimatePresence initial={false}>
        {!group.collapsed && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="flex items-center gap-0.5 overflow-hidden"
          >
            {visibleTabs.map((tab) => {
              const tabIndex = allTabs.findIndex((t) => t.id === tab.id);
              return (
                <Tab
                  key={tab.id}
                  instance={tab}
                  isActive={tab.id === activeTabId}
                  tileId={tileId}
                  index={tabIndex >= 0 ? tabIndex : 0}
                  tabs={allTabs}
                  repoColor={repo.color}
                  onActivate={() => onTabActivate(tab.id)}
                  onClose={() => onTabClose(tab.id)}
                  onReorder={onTabReorder}
                  onMoveToTile={onMoveToTile}
                  onContextMenu={onTabContextMenu}
                />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
