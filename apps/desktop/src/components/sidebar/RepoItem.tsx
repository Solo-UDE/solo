/**
 * RepoItem — Single repo row with expand/collapse and worktree sub-items
 */

import { useCallback, type FC } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CaretRight,
  GitBranch,
  Folder,
  X,
  TreeStructure,
  CircleNotch,
  Lock,
  CircleDashed,
} from '@phosphor-icons/react';
import type { RepoEntry } from '@/stores/repoStore';
import { useRepoStore } from '@/stores/repoStore';
import { cn } from '@/lib/utils';

interface RepoItemProps {
  repo: RepoEntry;
}

export const RepoItem: FC<RepoItemProps> = ({ repo }) => {
  const toggleExpanded = useRepoStore((s) => s.toggleExpanded);
  const removeRepo = useRepoStore((s) => s.removeRepo);
  const selectWorktree = useRepoStore((s) => s.selectWorktree);
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);
  const activeWorktreeId = useRepoStore((s) => s.activeWorktreeId);

  const isActive = activeRepoPath === repo.path;
  const worktreeCount = repo.worktrees.filter((wt) => !wt.is_main).length;

  const handleToggle = useCallback(() => {
    toggleExpanded(repo.path);
  }, [toggleExpanded, repo.path]);

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    removeRepo(repo.path);
  }, [removeRepo, repo.path]);

  const handleSelectMain = useCallback(() => {
    selectWorktree(repo.path, null);
  }, [selectWorktree, repo.path]);

  const handleSelectWorktree = useCallback((worktreeId: string) => {
    selectWorktree(repo.path, worktreeId);
  }, [selectWorktree, repo.path]);

  return (
    <div>
      {/* Repo header row */}
      <div
        className={cn(
          'group flex items-center gap-1.5 h-8 px-2 mx-1 rounded-lg cursor-pointer select-none',
          'transition-[background-color,color] duration-150',
          isActive && !activeWorktreeId
            ? 'bg-primary/10 text-foreground'
            : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
        )}
        onClick={handleToggle}
      >
        {/* Expand chevron */}
        <motion.div
          animate={{ rotate: repo.isExpanded ? 90 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="shrink-0"
        >
          <CaretRight className="w-3 h-3" weight="bold" />
        </motion.div>

        {/* Repo icon */}
        <Folder className="w-3.5 h-3.5 shrink-0" weight={isActive ? 'fill' : 'regular'} />

        {/* Repo name */}
        <span className="text-xs font-medium truncate flex-1">{repo.name}</span>

        {/* Branch badge */}
        {repo.currentBranch && (
          <span className="text-[10px] text-muted-foreground/60 truncate max-w-[80px]">
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

      {/* Expanded: worktree sub-items */}
      <AnimatePresence initial={false}>
        {repo.isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="pl-4 py-0.5">
              {/* Main workspace entry */}
              <WorktreeRow
                label={repo.currentBranch || 'main'}
                icon="branch"
                isMain
                isActive={isActive && activeWorktreeId === null}
                onClick={handleSelectMain}
              />

              {/* Linked worktrees */}
              {repo.worktrees
                .filter((wt) => !wt.is_main)
                .map((wt) => (
                  <WorktreeRow
                    key={wt.id}
                    label={wt.branch ?? wt.id}
                    icon="worktree"
                    isActive={isActive && activeWorktreeId === wt.id}
                    isLocked={wt.is_locked}
                    isDirty={wt.is_dirty}
                    onClick={() => handleSelectWorktree(wt.id)}
                  />
                ))}

              {/* Loading state */}
              {!repo._worktreesLoaded && (
                <div className="flex items-center gap-2 h-7 px-2 text-muted-foreground/50">
                  <CircleNotch className="w-3 h-3 animate-spin" />
                  <span className="text-[11px]">Loading...</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Worktree sub-row
interface WorktreeRowProps {
  label: string;
  icon: 'branch' | 'worktree';
  isMain?: boolean;
  isActive: boolean;
  isLocked?: boolean;
  isDirty?: boolean;
  onClick: () => void;
}

const WorktreeRow: FC<WorktreeRowProps> = ({
  label,
  icon,
  isActive,
  isLocked,
  isDirty,
  onClick,
}) => {
  const Icon = icon === 'branch' ? GitBranch : TreeStructure;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-1.5 h-7 px-2 rounded-lg',
        'text-xs transition-[background-color,color] duration-150',
        isActive
          ? 'bg-primary/10 text-foreground font-medium'
          : 'text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground',
      )}
    >
      <Icon
        className={cn('w-3 h-3 shrink-0', isActive && 'text-primary')}
        weight={isActive ? 'fill' : 'regular'}
      />
      <span className="truncate flex-1 text-left">{label}</span>
      {isLocked && <Lock className="w-3 h-3 text-muted-foreground/40 shrink-0" />}
      {isDirty && <CircleDashed className="w-3 h-3 text-yellow-500/60 shrink-0" />}
    </button>
  );
};
