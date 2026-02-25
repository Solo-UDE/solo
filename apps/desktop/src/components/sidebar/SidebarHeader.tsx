/**
 * SidebarHeader - Shows the active repo identity (colored icon + name),
 * current branch badge, and worktree switcher dropdown.
 */

import { useState, useMemo, type FC } from 'react';
import { GitBranch, CaretDown, TreeStructure } from '@phosphor-icons/react';
import { useActiveRepo } from '@/stores/repoStore';
import { useGitStore } from '@/stores/gitStore';
import { useActiveWorktree } from '@/stores/worktreeStore';
import { getRepoIcon, getRepoColorVar } from '@/lib/repoIdentity';
import { WorktreeSwitcher } from './WorktreeSwitcher';
import { cn } from '@/lib/utils';

export const SidebarHeader: FC = () => {
  const activeRepo = useActiveRepo();
  const currentBranch = useGitStore((s) => s.currentBranch);
  const repoStatus = useGitStore((s) => s.repoStatus);
  const activeWorktree = useActiveWorktree();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const isGitRepo = repoStatus?.is_repo ?? false;
  const branchName = currentBranch || activeRepo?.currentBranch || '';

  const Icon = useMemo(
    () => (activeRepo ? getRepoIcon(activeRepo.icon) : null),
    [activeRepo],
  );

  if (!activeRepo) return null;

  return (
    <div className="relative flex items-center gap-2 h-9 px-2.5 shrink-0 border-b border-border/10">
      {/* Repo icon (colored) */}
      {Icon && (
        <Icon
          className="w-4 h-4 shrink-0"
          weight="fill"
          style={{ color: getRepoColorVar(activeRepo.color) }}
        />
      )}

      {/* Repo name */}
      <span className="text-xs font-semibold truncate">
        {activeRepo.name}
      </span>

      {/* Branch badge (clickable for worktree switcher) */}
      {isGitRepo && branchName && (
        <button
          onClick={() => setSwitcherOpen((v) => !v)}
          className={cn(
            'flex items-center gap-1 h-5 px-1.5 rounded-md',
            'text-[10px] text-muted-foreground bg-muted/30',
            'hover:bg-muted/60 hover:text-foreground',
            'active:scale-[0.97] transition-all duration-150',
            'ml-auto shrink-0 max-w-[100px]',
          )}
        >
          <GitBranch className="w-3 h-3 shrink-0 text-primary/70" weight="bold" />
          <span className="truncate">{branchName}</span>
          {activeWorktree && (
            <TreeStructure className="w-2.5 h-2.5 text-primary/50 shrink-0" weight="bold" />
          )}
          <CaretDown className="w-2.5 h-2.5 text-muted-foreground/50 shrink-0" weight="bold" />
        </button>
      )}

      {/* Worktree switcher dropdown */}
      {switcherOpen && <WorktreeSwitcher onClose={() => setSwitcherOpen(false)} />}
    </div>
  );
};
