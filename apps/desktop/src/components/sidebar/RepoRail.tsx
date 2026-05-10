/**
 * RepoRail - Slim repository switcher inspired by Codex/Orbit.
 * Keeps navigation visually quiet and pushes detail into the main sidebar.
 */

import { useCallback, useEffect, useRef, type FC } from 'react';
import { motion } from 'motion/react';
import { GitBranch } from 'lucide-react';
import { PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { useRepoStore, useRepoList } from '@/stores/repoStore';
import type { RepoEntry } from '@/stores/repoStore';
import { getRepoIcon, getRepoColorVar } from '@/lib/repoIdentity';
import { openFolderDialog } from '@/lib/tauri/fs';
import { cn } from '@/lib/utils';
import { HEIGHTS, SIDEBAR } from '@/lib/constants';
import { useUIStore, useIsLeftSidebarCollapsed } from '@/stores/uiStore';
import { toast } from 'sonner';
import { VirtualList } from '@/components/ui/virtual-list';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu';

const RAIL_SPRING = { type: 'spring' as const, stiffness: 560, damping: 38 };
const HOVER_OPEN_DELAY_MS = 180;

export const RepoRail: FC = () => {
  const repos = useRepoList();
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);
  const selectWorktree = useRepoStore((s) => s.selectWorktree);
  const addRepo = useRepoStore((s) => s.addRepo);
  const removeRepo = useRepoStore((s) => s.removeRepo);
  const railExpanded = useUIStore((s) => s.railExpanded);
  const setRailExpanded = useUIStore((s) => s.setRailExpanded);
  const isSidebarCollapsed = useIsLeftSidebarCollapsed();
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAddRepo = useCallback(async () => {
    try {
      const path = await openFolderDialog();
      if (path) {
        await addRepo(path);
      }
    } catch (err) {
      toast.error('Failed to add repository', { description: String(err) });
    }
  }, [addRepo]);

  const canHoverExpand = isSidebarCollapsed;
  const isExpanded = canHoverExpand && railExpanded;

  useEffect(() => {
    if (!canHoverExpand && railExpanded) {
      setRailExpanded(false);
    }
  }, [canHoverExpand, railExpanded, setRailExpanded]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (!canHoverExpand) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setRailExpanded(true);
    }, HOVER_OPEN_DELAY_MS);
  }, [canHoverExpand, setRailExpanded]);

  const handleMouseLeave = useCallback(() => {
    if (!canHoverExpand) return;
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setRailExpanded(false);
  }, [canHoverExpand, setRailExpanded]);

  return (
    <motion.aside
      className="liquid-sidebar flex h-full shrink-0 flex-col overflow-hidden border-r border-border/80 bg-sidebar"
      animate={{ width: isExpanded ? SIDEBAR.railExpandedWidth : 58 }}
      transition={RAIL_SPRING}
      style={{
        width: isExpanded ? SIDEBAR.railExpandedWidth : 58,
        paddingTop: HEIGHTS.titlebar + 12,
        paddingBottom: 12,
      }}
      role="navigation"
      aria-label="Repositories"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className={cn(
          'flex flex-col gap-3 px-2',
          isExpanded ? 'items-stretch' : 'items-center',
        )}
      >
        <button
          onClick={handleAddRepo}
          className={cn(
            'inline-flex items-center rounded-[10px] border border-border/70 bg-background/70 text-muted-foreground',
            'hover:border-border hover:bg-card hover:text-foreground',
            'transition-[background-color,border-color,color,transform] duration-150 active:scale-95',
            isExpanded ? 'h-9 w-full justify-start gap-2.5 px-3' : 'mx-auto h-9 w-9 justify-center',
          )}
          title="Add repository"
          aria-label="Add repository"
        >
          <PlusIcon className="h-4 w-4 shrink-0" />
          {isExpanded ? <span className="truncate text-xs font-medium">Add repository</span> : null}
        </button>
      </div>

      <VirtualList
        items={repos}
        estimateSize={() => (isExpanded ? 52 : 48)}
        overscan={8}
        className={cn(
          'mt-3 min-h-0 flex-1 px-2 pb-1',
          isExpanded ? '' : 'mx-auto w-full',
        )}
        itemClassName="pb-2"
        getItemKey={(repo) => repo.path}
        testId="repo-rail"
        renderItem={(repo) => (
          <RailIcon
            repo={repo}
            isActive={repo.path === activeRepoPath}
            expanded={isExpanded}
            onClick={() => selectWorktree(repo.path, null)}
            onRemove={() => removeRepo(repo.path)}
          />
        )}
      />
    </motion.aside>
  );
};

interface RailIconProps {
  repo: RepoEntry;
  isActive: boolean;
  expanded: boolean;
  onClick: () => void;
  onRemove: () => void;
}

const RailIcon: FC<RailIconProps> = ({ repo, isActive, expanded, onClick, onRemove }) => {
  const Icon = getRepoIcon(repo.icon);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn('relative flex w-full', expanded ? 'justify-stretch' : 'justify-center')}>
          {isActive ? (
            <motion.span
              layoutId="repo-rail-active"
              className={cn(
                'absolute top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-r-full',
                expanded ? 'left-0' : '-left-2',
              )}
              style={{ backgroundColor: getRepoColorVar(repo.color) }}
            />
          ) : null}

          <button
            onClick={onClick}
            className={cn(
              'group relative inline-flex transition-[color,transform,filter] duration-150 active:scale-95',
              expanded
                ? 'h-11 w-full items-center gap-2.5 rounded-full px-3 text-left'
                : 'h-10 w-10 items-center justify-center rounded-full',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            style={{ '--repo-color': getRepoColorVar(repo.color) } as React.CSSProperties}
            title={repo.currentBranch ? `${repo.name} · ${repo.currentBranch}` : repo.name}
            aria-label={repo.name}
          >
            <Icon
              className={cn(
                'h-[18px] w-[18px] shrink-0 transition-[color,filter] duration-150',
                'group-hover:[color:var(--repo-color)]',
                'group-hover:[filter:drop-shadow(0_0_6px_var(--repo-color))]',
                isActive && '[color:var(--repo-color)] [filter:drop-shadow(0_0_6px_var(--repo-color))]',
              )}
            />
            {expanded ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold leading-tight text-foreground">
                  {repo.name}
                </span>
                {repo.currentBranch ? (
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] leading-tight text-muted-foreground/70">
                    <GitBranch className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{repo.currentBranch}</span>
                  </span>
                ) : null}
              </span>
            ) : null}
            {repo.worktrees.length > 1 ? (
              expanded ? (
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary/85">
                  {repo.worktrees.length} wt
                </span>
              ) : (
                <span className="absolute bottom-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary/80" />
              )
            ) : null}
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem
          onClick={onRemove}
          className="text-destructive focus:text-destructive"
        >
          <TrashIcon className="h-3.5 w-3.5" /> Remove repository
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
