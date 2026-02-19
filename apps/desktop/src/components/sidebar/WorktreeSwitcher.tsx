/**
 * WorktreeSwitcher - Floating popover for switching/creating worktrees
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { FC } from 'react';
import { Lock, Plus, CircleNotch, TreeStructure, GitBranch } from '@phosphor-icons/react';
import { useWorktreeStore, useWorktreeList } from '@/stores/worktreeStore';
import { cn } from '@/lib/utils';

interface WorktreeSwitcherProps {
  onClose: () => void;
}

export const WorktreeSwitcher: FC<WorktreeSwitcherProps> = ({ onClose }) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const worktrees = useWorktreeList();
  const activeWorktreeId = useWorktreeStore((s) => s.activeWorktreeId);
  const isLoading = useWorktreeStore((s) => s.isLoading);
  const loadWorktrees = useWorktreeStore((s) => s.loadWorktrees);
  const createWorktree = useWorktreeStore((s) => s.createWorktree);
  const setActive = useWorktreeStore((s) => s.setActive);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load worktrees on mount
  useEffect(() => {
    loadWorktrees();
  }, [loadWorktrees]);

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

  // Focus input when creating
  useEffect(() => {
    if (showCreateForm && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showCreateForm]);

  const handleSetActive = useCallback(async (id: string) => {
    const newId = id === 'main' ? null : id;
    await setActive(newId);
    onClose();
  }, [setActive, onClose]);

  const handleCreate = useCallback(async () => {
    if (!branchName.trim()) return;
    setIsCreating(true);
    try {
      await createWorktree(branchName.trim(), true);
      setBranchName('');
      setShowCreateForm(false);
    } catch {
      // Error handled in store
    } finally {
      setIsCreating(false);
    }
  }, [branchName, createWorktree]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (showCreateForm) {
        setShowCreateForm(false);
        setBranchName('');
      } else {
        onClose();
      }
    }
  }, [handleCreate, showCreateForm, onClose]);

  return (
    <div
      ref={popoverRef}
      className={cn(
        'absolute top-full left-0 mt-1 w-[240px] z-50',
        'bg-card/95 backdrop-blur-md rounded-[14px] p-1.5',
        'shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)]',
        'animate-in fade-in slide-in-from-top-2 duration-150',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
          Worktrees
        </span>
        <button
          onClick={() => setShowCreateForm(true)}
          className={cn(
            'w-5 h-5 flex items-center justify-center rounded-md',
            'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            'active:scale-[0.9] transition-[transform,background-color] duration-150',
          )}
          title="Create worktree"
        >
          <Plus className="w-3 h-3" weight="bold" />
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="px-1.5 pb-1.5">
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Branch name..."
              disabled={isCreating}
              className={cn(
                'flex-1 h-7 px-2 rounded-md text-xs',
                'bg-muted/40 border-none text-foreground placeholder:text-muted-foreground/50',
                'focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 focus:outline-none',
                'disabled:opacity-50',
                'transition-colors duration-150',
              )}
            />
            {isCreating && (
              <CircleNotch className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
            )}
          </div>
        </div>
      )}

      {/* Worktree list */}
      {isLoading && worktrees.length === 0 ? (
        <div className="flex items-center justify-center py-4">
          <CircleNotch className="w-4 h-4 text-muted-foreground animate-spin" />
        </div>
      ) : worktrees.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-4 text-center px-3">
          <TreeStructure className="w-6 h-6 text-muted-foreground/40 mb-1" />
          <p className="text-[11px] text-muted-foreground/60">No worktrees yet</p>
        </div>
      ) : (
        <div className="space-y-0.5">
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
                <GitBranch
                  className={cn('w-3.5 h-3.5 shrink-0', isActive && 'text-primary')}
                  weight="bold"
                />
                <span className="truncate">
                  {wt.is_main ? 'main' : (wt.branch ?? wt.id)}
                </span>
                {wt.is_locked && (
                  <Lock className="w-3 h-3 text-amber-500 shrink-0 ml-auto" />
                )}
                {wt.is_dirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 ml-auto" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
