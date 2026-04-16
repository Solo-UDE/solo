/**
 * CreateWorktreePopover — Form for creating a new worktree with branch picker
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { FC } from 'react';
import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { Loader2, GitBranch } from 'lucide-react';
import { useWorktreeStore } from '@/stores/worktreeStore';
import { useGitStore } from '@/stores/gitStore';
import { cn } from '@/lib/utils';

interface CreateWorktreePopoverProps {
  onClose: () => void;
}

export const CreateWorktreePopover: FC<CreateWorktreePopoverProps> = ({ onClose }) => {
  const [branchName, setBranchName] = useState('');
  const [createNewBranch, setCreateNewBranch] = useState(true);
  const [baseBranch, setBaseBranch] = useState('HEAD');
  const [branchFilter, setBranchFilter] = useState('');
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const branchInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const createWorktree = useWorktreeStore((s) => s.createWorktree);
  const branches = useGitStore((s) => s.branches);
  const listBranches = useGitStore((s) => s.listBranches);

  // Refresh branches on mount
  useEffect(() => {
    listBranches();
  }, [listBranches]);

  // Autofocus branch name input
  useEffect(() => {
    branchInputRef.current?.focus();
  }, []);

  const filteredBranches = useMemo(() => {
    if (!branchFilter.trim()) return branches;
    const q = branchFilter.toLowerCase();
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, branchFilter]);

  const handleSubmit = useCallback(async () => {
    const name = branchName.trim();
    if (!name) return;
    setIsCreating(true);
    try {
      const base = createNewBranch && baseBranch !== 'HEAD' ? baseBranch : undefined;
      await createWorktree(name, createNewBranch, base);
      onClose();
    } catch {
      // Error is set in the store
    } finally {
      setIsCreating(false);
    }
  }, [branchName, createNewBranch, baseBranch, createWorktree, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !showBranchPicker) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (showBranchPicker) {
        setShowBranchPicker(false);
      } else {
        onClose();
      }
    }
  }, [handleSubmit, showBranchPicker, onClose]);

  const selectBaseBranch = useCallback((name: string) => {
    setBaseBranch(name);
    setBranchFilter('');
    setShowBranchPicker(false);
  }, []);

  return (
    <div className="space-y-3 w-[260px]" onKeyDown={handleKeyDown}>
      <div className="text-sm font-medium text-foreground">New Worktree</div>

      {/* Branch name input */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Branch name</label>
        <input
          ref={branchInputRef}
          type="text"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          placeholder="feature/my-feature"
          disabled={isCreating}
          className={cn(
            'w-full h-8 px-2.5 rounded-lg text-xs',
            'bg-muted/40 border border-border/50 text-foreground placeholder:text-muted-foreground/50',
            'focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 focus:outline-none',
            'disabled:opacity-50',
            'transition-colors duration-150',
          )}
        />
      </div>

      {/* Checkout from (only when creating new branch) */}
      {createNewBranch && (
        <div className="space-y-1.5 relative">
          <label className="text-xs text-muted-foreground">Checkout from</label>
          <button
            type="button"
            onClick={() => setShowBranchPicker((v) => !v)}
            disabled={isCreating}
            className={cn(
              'w-full h-8 px-2.5 rounded-lg text-xs text-left',
              'bg-muted/40 border border-border/50 text-foreground',
              'hover:bg-muted/60 disabled:opacity-50',
              'flex items-center gap-2',
              'transition-colors duration-150',
            )}
          >
            <GitBranch className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="truncate flex-1">{baseBranch}</span>
          </button>

          {/* Branch picker dropdown */}
          {showBranchPicker && (
            <div
              ref={pickerRef}
              className={cn(
                'absolute left-0 right-0 top-full mt-1 z-50',
                'bg-card/95 backdrop-blur-md rounded-lg',
                'shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)]',
                'border border-border/30',
                'animate-in fade-in slide-in-from-top-1 duration-100',
              )}
            >
              {/* Search */}
              <div className="p-1.5 border-b border-border/20">
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <input
                    type="text"
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    placeholder="Filter branches..."
                    autoFocus
                    className={cn(
                      'w-full h-7 pl-7 pr-2 rounded-md text-xs',
                      'bg-muted/40 border-none text-foreground placeholder:text-muted-foreground/50',
                      'focus:outline-none',
                    )}
                  />
                </div>
              </div>

              {/* HEAD option */}
              <div className="max-h-[180px] overflow-y-auto p-1">
                <button
                  type="button"
                  onClick={() => selectBaseBranch('HEAD')}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs',
                    baseBranch === 'HEAD'
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                    'transition-colors duration-100',
                  )}
                >
                  <span className="font-medium">HEAD</span>
                  <span className="text-muted-foreground/50 text-[10px] ml-auto">current</span>
                </button>

                {filteredBranches.map((branch) => (
                  <button
                    key={branch.name}
                    type="button"
                    onClick={() => selectBaseBranch(branch.name)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs',
                      baseBranch === branch.name
                        ? 'bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                      'transition-colors duration-100',
                    )}
                  >
                    <GitBranch className="w-3 h-3 shrink-0" />
                    <span className="truncate">{branch.name}</span>
                    {branch.is_head && (
                      <span className="text-[10px] text-primary ml-auto shrink-0">HEAD</span>
                    )}
                  </button>
                ))}

                {filteredBranches.length === 0 && branchFilter && (
                  <div className="px-2.5 py-3 text-xs text-muted-foreground/50 text-center">
                    No branches match
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create new branch checkbox */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={createNewBranch}
          onChange={(e) => setCreateNewBranch(e.target.checked)}
          disabled={isCreating}
          className="rounded"
        />
        <span className="text-xs text-muted-foreground">Create new branch</span>
      </label>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={isCreating}
          className={cn(
            'h-7 px-3 rounded-lg text-xs',
            'text-muted-foreground hover:text-foreground hover:bg-muted/40',
            'active:scale-[0.97] transition-[transform,background-color,color] duration-150',
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!branchName.trim() || isCreating}
          className={cn(
            'h-7 px-3 rounded-lg text-xs font-medium',
            'bg-primary text-primary-foreground',
            'hover:brightness-110 active:scale-[0.97]',
            'disabled:opacity-40 disabled:pointer-events-none',
            'transition-[transform,background-color] duration-150',
            'flex items-center gap-1.5',
          )}
        >
          {isCreating && <Loader2 className="w-3 h-3 animate-spin" />}
          {isCreating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  );
};
