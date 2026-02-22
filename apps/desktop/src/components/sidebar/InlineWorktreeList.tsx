/**
 * InlineWorktreeList - Compact worktree list rendered inside the expanded RepoCard.
 * Shows main workspace, linked worktrees with hover actions, and a "New Worktree" button.
 */

import { useCallback, useState, type FC } from 'react';
import {
  GitBranch,
  TreeStructure,
  Lock,
  LockOpen,
  CircleDashed,
  Robot,
  GitDiff,
  Trash,
  Plus,
} from '@phosphor-icons/react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { CreateWorktreePopover } from './CreateWorktreePopover';
import type { RepoEntry } from '@/stores/repoStore';
import { useRepoStore } from '@/stores/repoStore';
import { useWorktreeStore } from '@/stores/worktreeStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { WorktreeInfo } from '@/bindings';

interface InlineWorktreeListProps {
  repo: RepoEntry;
}

export const InlineWorktreeList: FC<InlineWorktreeListProps> = ({ repo }) => {
  const selectWorktree = useRepoStore((s) => s.selectWorktree);
  const activeWorktreeId = useRepoStore((s) => s.activeWorktreeId);
  const lockWorktree = useWorktreeStore((s) => s.lock);
  const unlockWorktree = useWorktreeStore((s) => s.unlock);
  const removeWorktree = useWorktreeStore((s) => s.removeWorktree);

  const [createOpen, setCreateOpen] = useState(false);

  const mainWorktree = repo.worktrees.find((wt) => wt.is_main);
  const linkedWorktrees = repo.worktrees.filter((wt) => !wt.is_main);

  const handleSelectMain = useCallback(() => {
    selectWorktree(repo.path, null);
  }, [selectWorktree, repo.path]);

  const handleSelectWorktree = useCallback((worktreeId: string) => {
    selectWorktree(repo.path, worktreeId);
  }, [selectWorktree, repo.path]);

  const handleViewDiff = useCallback((wt: WorktreeInfo) => {
    usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.WORKTREE_DIFF, {
      worktreeId: wt.id,
      branch: wt.branch ?? wt.id,
    });
  }, []);

  const handleToggleLock = useCallback(async (wt: WorktreeInfo) => {
    try {
      if (wt.is_locked) {
        await unlockWorktree(wt.id);
      } else {
        await lockWorktree(wt.id, 'Locked from sidebar');
      }
    } catch (err) {
      toast.error('Lock toggle failed', { description: String(err) });
    }
  }, [lockWorktree, unlockWorktree]);

  const handleRemove = useCallback(async (wt: WorktreeInfo) => {
    try {
      await removeWorktree(wt.id, wt.is_locked);
    } catch (err) {
      toast.error('Remove failed', { description: String(err) });
    }
  }, [removeWorktree]);

  return (
    <div className="py-0.5 border-b border-border/10">
      {/* Main workspace row */}
      {mainWorktree && (
        <WorktreeRow
          label={repo.currentBranch || 'main'}
          icon="branch"
          isActive={activeWorktreeId === null}
          worktree={mainWorktree}
          onClick={handleSelectMain}
        />
      )}

      {/* Linked worktrees */}
      {linkedWorktrees.map((wt) => (
        <WorktreeRow
          key={wt.id}
          label={wt.branch ?? wt.id}
          icon="worktree"
          isActive={activeWorktreeId === wt.id}
          worktree={wt}
          onClick={() => handleSelectWorktree(wt.id)}
          onViewDiff={() => handleViewDiff(wt)}
          onToggleLock={() => handleToggleLock(wt)}
          onRemove={() => handleRemove(wt)}
        />
      ))}

      {/* New Worktree button */}
      <Popover open={createOpen} onOpenChange={setCreateOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'w-full flex items-center gap-1.5 h-7 px-3 rounded-lg',
              'text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/30',
              'transition-colors duration-150',
            )}
          >
            <Plus className="w-3 h-3" weight="bold" />
            <span>New Worktree</span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="p-3">
          <CreateWorktreePopover onClose={() => setCreateOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
};

// Individual worktree row
interface WorktreeRowProps {
  label: string;
  icon: 'branch' | 'worktree';
  isActive: boolean;
  worktree: WorktreeInfo;
  onClick: () => void;
  onViewDiff?: () => void;
  onToggleLock?: () => void;
  onRemove?: () => void;
}

const WorktreeRow: FC<WorktreeRowProps> = ({
  label,
  icon,
  isActive,
  worktree,
  onClick,
  onViewDiff,
  onToggleLock,
  onRemove,
}) => {
  const Icon = icon === 'branch' ? GitBranch : TreeStructure;
  const showActions = !worktree.is_main;

  return (
    <button
      onClick={onClick}
      className={cn(
        'group w-full flex items-center gap-1.5 h-7 px-3 rounded-lg',
        'text-xs transition-[background-color,color] duration-150',
        isActive
          ? 'bg-primary/10 text-foreground font-medium'
          : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
      )}
    >
      <Icon
        className={cn('w-3 h-3 shrink-0', isActive && 'text-primary')}
        weight={isActive ? 'fill' : 'regular'}
      />
      <span className="truncate flex-1 text-left">{label}</span>

      {/* Status indicators */}
      {worktree.is_locked && !showActions && (
        <Lock className="w-3 h-3 text-muted-foreground/40 shrink-0" />
      )}
      {worktree.is_dirty && (
        <CircleDashed className="w-3 h-3 text-warning-foreground/60 shrink-0" />
      )}
      {worktree.agent_session_id && (
        <Robot className="w-3 h-3 text-primary/60 shrink-0" />
      )}

      {/* Hover actions for linked worktrees */}
      {showActions && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {onViewDiff && (
            <span
              onClick={(e) => { e.stopPropagation(); onViewDiff(); }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-muted/60"
              title="View diff"
            >
              <GitDiff className="w-3 h-3" />
            </span>
          )}
          {onToggleLock && (
            <span
              onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-muted/60"
              title={worktree.is_locked ? 'Unlock' : 'Lock'}
            >
              {worktree.is_locked
                ? <LockOpen className="w-3 h-3" />
                : <Lock className="w-3 h-3" />
              }
            </span>
          )}
          {onRemove && (
            <span
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-destructive/20"
              title="Remove worktree"
            >
              <Trash className="w-3 h-3 text-destructive/60" />
            </span>
          )}
        </div>
      )}
    </button>
  );
};
