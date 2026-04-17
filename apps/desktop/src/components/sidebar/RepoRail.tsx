/**
 * RepoRail - Slim repository switcher inspired by Codex/Orbit.
 * Keeps navigation visually quiet and pushes detail into the main sidebar.
 */

import { useCallback, type FC } from 'react';
import { motion } from 'motion/react';
import { PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { useRepoStore, useRepoList } from '@/stores/repoStore';
import type { RepoEntry } from '@/stores/repoStore';
import { getRepoIcon, getRepoColorVar } from '@/lib/repoIdentity';
import { openFolderDialog } from '@/lib/tauri/fs';
import { cn } from '@/lib/utils';
import { HEIGHTS } from '@/lib/constants';
import { toast } from 'sonner';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu';

export const RepoRail: FC = () => {
  const repos = useRepoList();
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);
  const selectWorktree = useRepoStore((s) => s.selectWorktree);
  const addRepo = useRepoStore((s) => s.addRepo);
  const removeRepo = useRepoStore((s) => s.removeRepo);

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

  return (
    <aside
      className="flex h-full w-[58px] shrink-0 flex-col border-r border-border/80 bg-sidebar px-2"
      style={{ paddingTop: HEIGHTS.titlebar + 12, paddingBottom: 12 }}
      role="navigation"
      aria-label="Repositories"
    >
      <button
        onClick={handleAddRepo}
        className={cn(
          'mx-auto inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-border/70',
          'bg-background/70 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground',
          'transition-[background-color,border-color,color,transform] duration-150 active:scale-95',
        )}
        title="Add repository"
        aria-label="Add repository"
      >
        <PlusIcon className="h-4 w-4" />
      </button>

      <div className="mt-3 flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto pb-1">
        {repos.map((repo) => (
          <RailIcon
            key={repo.path}
            repo={repo}
            isActive={repo.path === activeRepoPath}
            onClick={() => selectWorktree(repo.path, null)}
            onRemove={() => removeRepo(repo.path)}
          />
        ))}
      </div>
    </aside>
  );
};

interface RailIconProps {
  repo: RepoEntry;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
}

const RailIcon: FC<RailIconProps> = ({ repo, isActive, onClick, onRemove }) => {
  const Icon = getRepoIcon(repo.icon);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative flex w-full justify-center">
          {isActive ? (
            <motion.span
              layoutId="repo-rail-active"
              className="absolute -left-2 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-r-full"
              style={{ backgroundColor: getRepoColorVar(repo.color) }}
            />
          ) : null}

          <button
            onClick={onClick}
            className={cn(
              'group relative inline-flex h-10 w-10 items-center justify-center rounded-[10px] border',
              'transition-[background-color,border-color,color,transform,box-shadow] duration-150 active:scale-95',
              isActive
                ? 'border-border/70 bg-card text-foreground shadow-[0_14px_28px_-18px_rgba(0,0,0,0.35)]'
                : 'border-transparent bg-transparent text-muted-foreground hover:border-border/60 hover:bg-card/80 hover:text-foreground',
            )}
            title={repo.currentBranch ? `${repo.name} · ${repo.currentBranch}` : repo.name}
            aria-label={repo.name}
          >
            <Icon
              className="h-[18px] w-[18px] shrink-0"
              style={{ color: isActive ? getRepoColorVar(repo.color) : undefined }}
            />
            {repo.worktrees.length > 1 ? (
              <span className="absolute bottom-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary/80" />
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
