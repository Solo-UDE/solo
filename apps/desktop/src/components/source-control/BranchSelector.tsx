/**
 * BranchSelector — popover to view and switch branches
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { FC } from 'react';
import { GitBranch, CaretDown, Plus, CircleNotch, Trash, ArrowUp, ArrowDown } from '@phosphor-icons/react';
import { useGitStore } from '@/stores/gitStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export const BranchSelector: FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [createError, setCreateError] = useState('');
  const currentBranch = useGitStore((s) => s.currentBranch);
  const repoStatus = useGitStore((s) => s.repoStatus);
  const branches = useGitStore((s) => s.branches);
  const isCreatingBranch = useGitStore((s) => s.isCreatingBranch);
  const isCheckingOut = useGitStore((s) => s.isCheckingOut);
  const createBranch = useGitStore((s) => s.createBranch);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const deleteBranch = useGitStore((s) => s.deleteBranch);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
        setNewBranchName('');
        setCreateError('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Focus input when creating
  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
    setIsCreating(false);
    setNewBranchName('');
    setCreateError('');
  }, []);

  const handleStartCreate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCreating(true);
    setCreateError('');
  }, []);

  const handleCreateBranch = useCallback(async () => {
    const name = newBranchName.trim();
    if (!name) return;

    setCreateError('');
    try {
      await createBranch(name);
      setIsCreating(false);
      setNewBranchName('');
      setIsOpen(false);
    } catch (err) {
      setCreateError(String(err));
    }
  }, [newBranchName, createBranch]);

  const handleCreateKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCreateBranch();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsCreating(false);
        setNewBranchName('');
        setCreateError('');
      }
    },
    [handleCreateBranch],
  );

  const handleCheckout = useCallback(
    async (name: string) => {
      try {
        await checkoutBranch(name);
        setIsOpen(false);
      } catch (err) {
        toast.error('Checkout failed', { description: String(err) });
      }
    },
    [checkoutBranch],
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent, name: string) => {
      e.stopPropagation();
      try {
        await deleteBranch(name);
        toast.success(`Deleted branch ${name}`);
      } catch (err) {
        toast.error('Delete failed', { description: String(err) });
      }
    },
    [deleteBranch],
  );

  if (!repoStatus) return null;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={handleToggle}
        className={cn(
          'flex items-center gap-1.5 h-7 px-2 rounded-lg',
          'text-xs text-muted-foreground',
          'hover:bg-muted/60 hover:text-foreground',
          'active:scale-[0.97] transition-[transform,background-color,color] duration-200',
        )}
        title="Branch"
      >
        <GitBranch className="w-3.5 h-3.5" weight="bold" />
        <span className="truncate max-w-[120px]">{currentBranch || 'main'}</span>
        <CaretDown className="w-3 h-3 opacity-50" />
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute top-full left-0 mt-1 w-[240px] z-50',
            'bg-card/95 backdrop-blur-md rounded-[12px] p-1.5',
            'shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)]',
            'animate-in fade-in slide-in-from-top-2 duration-150',
          )}
        >
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
              Local Branches
            </span>
            <button
              onClick={handleStartCreate}
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
          {isCreating && (
            <div className="px-1.5 pb-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={newBranchName}
                  onChange={(e) => {
                    setNewBranchName(e.target.value);
                    setCreateError('');
                  }}
                  onKeyDown={handleCreateKeyDown}
                  placeholder="Branch name..."
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
              {createError && (
                <p className="mt-1 px-1 text-[10px] text-destructive leading-tight">
                  {createError}
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
                      onClick={(e) => handleDelete(e, branch.name)}
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
              <button
                className={cn(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs',
                  'bg-primary/10 text-foreground',
                )}
              >
                <GitBranch className="w-3.5 h-3.5 text-primary" weight="bold" />
                {currentBranch || 'main'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
