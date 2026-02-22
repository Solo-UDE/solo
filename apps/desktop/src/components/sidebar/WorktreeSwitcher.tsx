/**
 * WorktreeSwitcher - Unified popover for branch switching and worktree management
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { FC } from 'react';
import {
  Lock,
  Plus,
  CircleNotch,
  TreeStructure,
  GitBranch,
  Trash,
  ArrowUp,
  ArrowDown,
} from '@phosphor-icons/react';
import { ListSkeleton } from '@/components/ui/skeletons';
import { useWorktreeStore, useWorktreeList } from '@/stores/worktreeStore';
import { useGitStore } from '@/stores/gitStore';
import { useUIStore } from '@/stores/uiStore';
import { AnimatedList } from '@/components/ui/animated-list';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface WorktreeSwitcherProps {
  onClose: () => void;
}

/**
 * WorktreeSwitcher — content-only panel for branch switching and worktree selection.
 * Rendered inside a Radix Popover by ContextHeader (portal handles positioning/z-index).
 */
export const WorktreeSwitcher: FC<WorktreeSwitcherProps> = ({ onClose }) => {

  // Worktree state
  const worktrees = useWorktreeList();
  const activeWorktreeId = useWorktreeStore((s) => s.activeWorktreeId);
  const isLoadingWorktrees = useWorktreeStore((s) => s.isLoading);
  const loadWorktrees = useWorktreeStore((s) => s.loadWorktrees);
  const setActive = useWorktreeStore((s) => s.setActive);

  // Branch state
  const branches = useGitStore((s) => s.branches);
  const isCreatingBranch = useGitStore((s) => s.isCreatingBranch);
  const isCheckingOut = useGitStore((s) => s.isCheckingOut);
  const createBranch = useGitStore((s) => s.createBranch);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const deleteBranch = useGitStore((s) => s.deleteBranch);

  // Branch create form
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchCreateError, setBranchCreateError] = useState('');
  const branchInputRef = useRef<HTMLInputElement>(null);

  const hasWorktrees = worktrees.length > 1;

  // Load worktrees on mount
  useEffect(() => {
    loadWorktrees();
  }, [loadWorktrees]);

  // Focus branch input when form opens
  useEffect(() => {
    if (showBranchForm && branchInputRef.current) {
      branchInputRef.current.focus();
    }
  }, [showBranchForm]);

  // Worktree handlers
  const handleSetActive = useCallback(async (id: string) => {
    const newId = id === 'main' ? null : id;
    await setActive(newId);
    onClose();
  }, [setActive, onClose]);

  // Branch handlers
  const handleCheckout = useCallback(async (name: string) => {
    try {
      await checkoutBranch(name);
      onClose();
    } catch (err) {
      toast.error('Checkout failed', { description: String(err) });
    }
  }, [checkoutBranch, onClose]);

  const handleCreateBranch = useCallback(async () => {
    const name = newBranchName.trim();
    if (!name) return;
    setBranchCreateError('');
    try {
      await createBranch(name);
      setShowBranchForm(false);
      setNewBranchName('');
      onClose();
    } catch (err) {
      setBranchCreateError(String(err));
    }
  }, [newBranchName, createBranch, onClose]);

  const handleBranchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreateBranch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowBranchForm(false);
      setNewBranchName('');
      setBranchCreateError('');
    }
  }, [handleCreateBranch]);

  const handleDeleteBranch = useCallback(async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    try {
      await deleteBranch(name);
      toast.success(`Deleted branch ${name}`);
    } catch (err) {
      toast.error('Delete failed', { description: String(err) });
    }
  }, [deleteBranch]);

  const handleStartCreateBranch = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowBranchForm(true);
    setBranchCreateError('');
  }, []);

  return (
    <>
      {/* Branches section */}
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
          Branches
        </span>
        <button
          onClick={handleStartCreateBranch}
          className={cn(
            'w-5 h-5 flex items-center justify-center rounded-md',
            'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            'active:scale-[0.9] transition-[transform,background-color] duration-150',
          )}
          title="Create branch"
        >
          <Plus className="w-3 h-3" weight="bold" />
        </button>
      </div>

      {/* Create branch input */}
      {showBranchForm && (
        <div className="px-1.5 pb-1.5">
          <div className="flex items-center gap-1.5">
            <input
              ref={branchInputRef}
              type="text"
              value={newBranchName}
              onChange={(e) => {
                setNewBranchName(e.target.value);
                setBranchCreateError('');
              }}
              onKeyDown={handleBranchKeyDown}
              placeholder="Branch name..."
              aria-label="New branch name"
              disabled={isCreatingBranch}
              className={cn(
                'flex-1 h-7 px-2 rounded-md text-xs',
                'bg-muted/40 border-none text-foreground placeholder:text-muted-foreground/50',
                'focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 focus:outline-none',
                'disabled:opacity-50',
                'transition-colors duration-150',
              )}
            />
            {isCreatingBranch && (
              <CircleNotch className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
            )}
          </div>
          {branchCreateError && (
            <p className="mt-1 px-1 text-[10px] text-destructive leading-tight">
              {branchCreateError}
            </p>
          )}
        </div>
      )}

      {/* Branch list */}
      <div className="max-h-[200px] overflow-y-auto">
        {branches.map((branch) => {
          const isCurrent = branch.is_head;
          return (
            <button
              key={branch.name}
              onClick={() => !isCurrent && !isCheckingOut && handleCheckout(branch.name)}
              disabled={isCheckingOut}
              className={cn(
                'group w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs',
                isCurrent
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                'disabled:opacity-50',
                'transition-colors duration-150',
              )}
            >
              <GitBranch
                className={cn('w-3.5 h-3.5 shrink-0', isCurrent ? 'text-primary' : '')}
                weight="bold"
              />
              <span className="truncate flex-1 text-left">{branch.name}</span>

              {/* Ahead/behind counts */}
              {(branch.ahead > 0 || branch.behind > 0) && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 shrink-0">
                  {branch.ahead > 0 && (
                    <span className="flex items-center gap-0.5">
                      <ArrowUp className="w-2.5 h-2.5" />
                      {branch.ahead}
                    </span>
                  )}
                  {branch.behind > 0 && (
                    <span className="flex items-center gap-0.5">
                      <ArrowDown className="w-2.5 h-2.5" />
                      {branch.behind}
                    </span>
                  )}
                </span>
              )}

              {/* Delete button (non-current branches only) */}
              {!isCurrent && (
                <span
                  onClick={(e) => handleDeleteBranch(e, branch.name)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <Trash
                    className="w-3 h-3 text-muted-foreground hover:text-destructive transition-colors"
                    weight="bold"
                  />
                </span>
              )}
            </button>
          );
        })}

        {/* Fallback when no branches loaded yet */}
        {branches.length === 0 && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs bg-primary/10 text-foreground">
            <GitBranch className="w-3.5 h-3.5 text-primary" weight="bold" />
            <span>{useGitStore.getState().currentBranch || 'main'}</span>
          </div>
        )}
      </div>

      {/* Worktrees section (only shown when multiple worktrees exist) */}
      {hasWorktrees && (
        <>
          {/* Divider */}
          <div className="mx-2 my-1.5 h-px bg-muted/40" />

          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
              Worktrees
            </span>
          </div>

          {/* Worktree list */}
          {isLoadingWorktrees && worktrees.length === 0 ? (
            <ListSkeleton rows={3} className="p-1" />
          ) : (
            <AnimatedList className="space-y-0.5" stagger={0.03} slideY={4}>
              {worktrees.map((wt) => {
                const isActive = wt.is_main ? activeWorktreeId === null : activeWorktreeId === wt.id;
                return (
                  <button
                    key={wt.id}
                    onClick={() => handleSetActive(wt.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs',
                      'transition-colors duration-150',
                      isActive
                        ? 'bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <TreeStructure
                      className={cn('w-3.5 h-3.5 shrink-0', isActive && 'text-primary')}
                      weight="bold"
                    />
                    <span className="truncate">
                      {wt.is_main ? 'main' : (wt.branch ?? wt.id)}
                    </span>
                    {wt.is_locked && (
                      <Lock className="w-3 h-3 text-warning shrink-0 ml-auto" />
                    )}
                    {wt.is_dirty && (
                      <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0 ml-auto" />
                    )}
                  </button>
                );
              })}
            </AnimatedList>
          )}

          {/* Navigate to source control for full management */}
          <button
            onClick={() => {
              useUIStore.getState().setActiveTab('source-control');
              onClose();
            }}
            className={cn(
              'w-full flex items-center gap-2 px-2.5 py-1.5 mt-0.5 rounded-lg text-xs',
              'text-muted-foreground/60 hover:bg-muted/40 hover:text-muted-foreground',
              'transition-colors duration-150',
            )}
          >
            <span className="text-[10px]">Manage worktrees...</span>
          </button>
        </>
      )}
    </>
  );
};
