/**
 * BranchPicker — in-worktree branch switcher.
 *
 * Replaces the top-level WorktreeSwitcher. Lives inside WorktreeDetailView's
 * back-header. Scoped to the active worktree: lists branches from gitStore
 * (populated against the currently-active repo path) and calls checkoutBranch
 * on selection.
 *
 * Dirty-aware: if the worktree has uncommitted changes, checkout is gated and
 * `onDirtySwitch` is invoked instead of `checkoutBranch`. That callback is
 * wired to the Git Agent harness by the parent so the user gets a
 * conversational path through the mess rather than a bare git error.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FC, RefObject } from 'react';
import { PlusIcon } from '@radix-ui/react-icons';
import { ArrowDown, ArrowUp, GitBranch, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useGitStore } from '@/stores/gitStore';
import { cn } from '@/lib/utils';

export interface BranchPickerProps {
  readonly onClose: () => void;
  readonly triggerRef?: RefObject<HTMLButtonElement | null>;
  /**
   * True when the active worktree has uncommitted changes. When a branch is
   * picked and this is `true`, the component defers to `onDirtySwitch`
   * instead of calling `checkoutBranch` directly.
   */
  readonly isDirty: boolean;
  /**
   * Called when the user picks a branch while the worktree is dirty. The
   * parent routes this to the Git Agent harness (phase 3E). Receives the
   * branch name the user was attempting to switch to.
   */
  readonly onDirtySwitch: (targetBranch: string) => void;
}

export const BranchPicker: FC<BranchPickerProps> = ({
  onClose,
  triggerRef,
  isDirty,
  onDirtySwitch,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  const branches = useGitStore((s) => s.branches);
  const isCreatingBranch = useGitStore((s) => s.isCreatingBranch);
  const isCheckingOut = useGitStore((s) => s.isCheckingOut);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const createBranch = useGitStore((s) => s.createBranch);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [createError, setCreateError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (triggerRef?.current?.contains(e.target as Node)) return;
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onClose, triggerRef]);

  useEffect(() => {
    if (showCreateForm) {
      inputRef.current?.focus();
    }
  }, [showCreateForm]);

  const handlePick = useCallback(
    async (name: string) => {
      if (isDirty) {
        onDirtySwitch(name);
        onClose();
        return;
      }
      try {
        await checkoutBranch(name);
        onClose();
      } catch (err) {
        toast.error('Checkout failed', { description: String(err) });
      }
    },
    [isDirty, onDirtySwitch, checkoutBranch, onClose],
  );

  const handleCreate = useCallback(async () => {
    const name = newBranchName.trim();
    if (!name) return;
    setCreateError('');
    try {
      await createBranch(name);
      setShowCreateForm(false);
      setNewBranchName('');
      onClose();
    } catch (err) {
      setCreateError(String(err));
    }
  }, [newBranchName, createBranch, onClose]);

  return (
    <div
      ref={popoverRef}
      className={cn(
        'absolute left-0 right-0 top-full z-50 mt-1',
        'rounded-[12px] border border-border/70 bg-card/95 backdrop-blur-md p-1.5',
        'shadow-[0_12px_32px_-8px_rgba(0,0,0,0.35)]',
        'animate-in fade-in slide-in-from-top-1 duration-120',
      )}
    >
      <div className="flex items-center justify-between px-2.5 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/65">
          Branches
        </span>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-[6px]',
            'text-muted-foreground hover:bg-background/65 hover:text-foreground',
            'active:scale-[0.92] transition-[transform,background-color,color] duration-150',
          )}
          title="Create branch"
        >
          <PlusIcon className="h-3 w-3" />
        </button>
      </div>

      {showCreateForm && (
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreate();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowCreateForm(false);
                  setNewBranchName('');
                  setCreateError('');
                }
              }}
              placeholder="Branch name"
              disabled={isCreatingBranch}
              className={cn(
                'h-7 flex-1 rounded-[8px] border border-border/60 bg-background/65 px-2 text-xs',
                'text-foreground placeholder:text-muted-foreground/50',
                'focus:border-border focus:outline-none focus:ring-1 focus:ring-ring/30',
                'transition-[border-color,background-color] duration-150',
              )}
            />
            {isCreatingBranch && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
          </div>
          {createError && (
            <p className="mt-1 px-1 text-[10px] leading-tight text-destructive">
              {createError}
            </p>
          )}
        </div>
      )}

      {isDirty && (
        <div className="mx-1 mb-1 rounded-[8px] border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
          This worktree has uncommitted changes. Solo will open a Git Agent
          session to help resolve before switching.
        </div>
      )}

      <div className="max-h-[240px] overflow-y-auto px-0.5">
        {branches.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-muted-foreground/60">
            No branches loaded.
          </div>
        ) : (
          branches.map((branch) => {
            const isCurrent = branch.is_head;
            return (
              <button
                key={branch.name}
                type="button"
                onClick={() => {
                  if (isCurrent || isCheckingOut) return;
                  void handlePick(branch.name);
                }}
                disabled={isCheckingOut}
                className={cn(
                  'group w-full flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-xs',
                  isCurrent
                    ? 'bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:bg-background/65 hover:text-foreground',
                  isCheckingOut && 'disabled:opacity-50 disabled:pointer-events-none',
                  'transition-colors duration-150',
                )}
              >
                <GitBranch
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    isCurrent ? 'text-primary' : '',
                  )}
                />
                <span className="flex-1 truncate text-left">{branch.name}</span>

                {(branch.ahead > 0 || branch.behind > 0) && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/60">
                    {branch.ahead > 0 && (
                      <span className="flex items-center gap-0.5">
                        <ArrowUp className="h-2.5 w-2.5" />
                        {branch.ahead}
                      </span>
                    )}
                    {branch.behind > 0 && (
                      <span className="flex items-center gap-0.5">
                        <ArrowDown className="h-2.5 w-2.5" />
                        {branch.behind}
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
