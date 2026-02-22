/**
 * WorktreeSwitcher - Popover for branch switching
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { FC } from 'react';
import {
  Plus,
  CircleNotch,
  GitBranch,
  Trash,
  ArrowUp,
  ArrowDown,
} from '@phosphor-icons/react';
import { useGitStore } from '@/stores/gitStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface WorktreeSwitcherProps {
  onClose: () => void;
}

export const WorktreeSwitcher: FC<WorktreeSwitcherProps> = ({ onClose }) => {
  const popoverRef = useRef<HTMLDivElement>(null);

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

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Focus input when form opens
  useEffect(() => {
    if (showBranchForm && branchInputRef.current) {
      branchInputRef.current.focus();
    }
  }, [showBranchForm]);

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
    <div
      ref={popoverRef}
      className={cn(
        'absolute top-full left-0 mt-1 w-[260px] z-50',
        'bg-card/95 backdrop-blur-md rounded-[14px] p-1.5',
        'shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)]',
        'animate-in fade-in slide-in-from-top-2 duration-150',
      )}
    >
      {/* Branches section */}
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span className="text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider">
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
                'bg-muted/40 border-none text-foreground placeholder:text-muted-foreground/60',
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
            <p className="mt-1 px-1 text-2xs text-destructive leading-tight">
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
                <span className="flex items-center gap-1 text-2xs text-muted-foreground/60 shrink-0">
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

    </div>
  );
};
