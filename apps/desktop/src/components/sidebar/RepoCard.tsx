/**
 * RepoCard - Rich two-row repo card for the unified accordion sidebar.
 * Collapsed: shows repo name, branch badge, worktree count, and status row.
 * Expanded (active): renders worktree list + horizontal tab bar + panel reel inline.
 */

import { useCallback, type FC, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CaretRight,
  Folder,
  X,
  ArrowUp,
  CircleDashed,
  CircleNotch,
} from '@phosphor-icons/react';
import type { RepoEntry } from '@/stores/repoStore';
import { useRepoStore } from '@/stores/repoStore';
import { cn } from '@/lib/utils';

interface RepoCardProps {
  repo: RepoEntry;
  isActive: boolean;
  /** Rendered inside the expanded card (worktree list + tab bar + panel reel) */
  children?: ReactNode;
}

export const RepoCard: FC<RepoCardProps> = ({ repo, isActive, children }) => {
  const toggleExpanded = useRepoStore((s) => s.toggleExpanded);
  const removeRepo = useRepoStore((s) => s.removeRepo);
  const selectWorktree = useRepoStore((s) => s.selectWorktree);

  const worktreeCount = repo.worktrees.filter((wt) => !wt.is_main).length;
  const hasStatus = repo.cachedCommitsAhead > 0 || repo.dirtyWorktreeCount > 0;

  const handleClick = useCallback(() => {
    if (!isActive) {
      // Clicking an inactive repo: activate it (which auto-expands)
      selectWorktree(repo.path, null);
    } else {
      // Clicking the active repo: toggle expand/collapse
      toggleExpanded(repo.path);
    }
  }, [isActive, selectWorktree, toggleExpanded, repo.path]);

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    removeRepo(repo.path);
  }, [removeRepo, repo.path]);

  return (
    <div
      className={cn(
        'relative mx-1 rounded-lg transition-colors duration-150',
        isActive && repo.isExpanded && 'flex flex-col flex-1 min-h-0',
      )}
    >
      {/* Active accent bar */}
      {isActive && (
        <motion.div
          layoutId="repo-accent"
          className="absolute left-0 top-2 w-[2px] h-5 rounded-r-full bg-primary"
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      )}

      {/* Header (always visible) */}
      <div
        className={cn(
          'group cursor-pointer select-none',
          isActive
            ? 'bg-primary/5'
            : 'hover:bg-muted/40',
        )}
        onClick={handleClick}
      >
        {/* Row 1: Chevron, icon, name, branch badge, worktree count, remove */}
        <div className="flex items-center gap-1.5 h-8 px-2">
          <motion.div
            animate={{ rotate: repo.isExpanded ? 90 : 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="shrink-0"
          >
            <CaretRight className="w-3 h-3" weight="bold" />
          </motion.div>

          <Folder
            className="w-3.5 h-3.5 shrink-0"
            weight={isActive ? 'fill' : 'regular'}
          />

          <span className="text-xs font-medium truncate flex-1">
            {repo.name}
          </span>

          {/* Branch badge pill */}
          {repo.currentBranch && (
            <span className="text-[10px] text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded-full truncate max-w-[80px]">
              {repo.currentBranch}
            </span>
          )}

          {/* Worktree count badge */}
          {worktreeCount > 0 && (
            <span className="text-[10px] text-muted-foreground/50 tabular-nums">
              {worktreeCount}
            </span>
          )}

          {/* Remove button (on hover) */}
          <button
            onClick={handleRemove}
            className={cn(
              'w-5 h-5 flex items-center justify-center rounded shrink-0',
              'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
              'text-muted-foreground/50 hover:text-foreground hover:bg-muted/60',
            )}
            title="Remove repository"
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        {/* Row 2: Status indicators (commits ahead, dirty worktrees) */}
        {hasStatus && (
          <div className="flex items-center gap-1 h-4 pl-[30px] pr-2 pb-1 text-[10px] text-muted-foreground/60">
            {repo.cachedCommitsAhead > 0 && (
              <span className="flex items-center gap-0.5 text-emerald-400/80">
                <ArrowUp className="w-2.5 h-2.5" />
                {repo.cachedCommitsAhead} ahead
              </span>
            )}
            {repo.cachedCommitsAhead > 0 && repo.dirtyWorktreeCount > 0 && (
              <span className="text-muted-foreground/30">·</span>
            )}
            {repo.dirtyWorktreeCount > 0 && (
              <span className="flex items-center gap-0.5 text-yellow-400/80">
                <CircleDashed className="w-2.5 h-2.5" />
                {repo.dirtyWorktreeCount} dirty
              </span>
            )}
          </div>
        )}

        {/* Loading indicator */}
        {repo.isExpanded && !repo._worktreesLoaded && (
          <div className="flex items-center gap-2 h-6 pl-[30px] pr-2 text-muted-foreground/50">
            <CircleNotch className="w-3 h-3 animate-spin" />
            <span className="text-[11px]">Loading...</span>
          </div>
        )}
      </div>

      {/* Expanded content (worktree list + tabs + panels) */}
      <AnimatePresence initial={false}>
        {repo.isExpanded && children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={cn(
              'overflow-hidden',
              isActive && 'flex-1 min-h-0 flex flex-col',
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
