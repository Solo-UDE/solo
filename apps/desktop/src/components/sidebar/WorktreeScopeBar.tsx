/**
 * WorktreeScopeBar — Root-level worktree selector shown when count > 1.
 * Compact h-8 bar with worktree dropdown and create button.
 */

import { useCallback } from 'react';
import type { FC } from 'react';
import { Lock, CaretDown, Plus, Broom } from '@phosphor-icons/react';
import {
  useWorktreeStore,
  useWorktreeList,
  useActiveWorktree,
  useWorktreeCount,
} from '@/stores/worktreeStore';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { CreateWorktreePopover } from './CreateWorktreePopover';
import { cn } from '@/lib/utils';

export const WorktreeScopeBar: FC = () => {
  const count = useWorktreeCount();
  const worktrees = useWorktreeList();
  const activeWorktree = useActiveWorktree();
  const activeWorktreeId = useWorktreeStore((s) => s.activeWorktreeId);
  const setActive = useWorktreeStore((s) => s.setActive);
  const pruneWorktrees = useWorktreeStore((s) => s.pruneWorktrees);

  const handleSelect = useCallback(async (id: string, isMain: boolean) => {
    const newId = isMain ? null : id;
    await setActive(newId);
  }, [setActive]);

  // Non-main, non-locked worktrees that can be pruned
  const staleCount = worktrees.filter((wt) => !wt.is_main && !wt.is_locked).length;

  // Only visible when multiple worktrees exist
  if (count <= 1) return null;

  const displayName = activeWorktree ? (activeWorktree.branch ?? activeWorktree.id) : 'main workspace';

  return (
    <div className="flex items-center justify-between h-8 px-2 shrink-0 border-b border-border/20 animate-in fade-in slide-in-from-top-1 duration-200">
      {/* Left: Worktree selector dropdown */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-1.5 h-6 px-2 rounded-lg min-w-0 max-w-[calc(100%-36px)]',
              'text-xs text-foreground',
              'hover:bg-muted/60',
              'active:scale-[0.97] transition-[transform,background-color] duration-150',
            )}
          >
            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
            <span className="truncate font-medium">{displayName}</span>
            <CaretDown className="w-3 h-3 text-muted-foreground/60 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-[260px] p-1.5">
          {/* Worktree list */}
          <div className="space-y-0.5">
            {worktrees.map((wt) => {
              const isActive = wt.is_main
                ? activeWorktreeId === null
                : activeWorktreeId === wt.id;

              return (
                <button
                  key={wt.id}
                  onClick={() => handleSelect(wt.id, wt.is_main)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left',
                    'transition-colors duration-150',
                    isActive
                      ? 'bg-primary/10'
                      : 'hover:bg-muted/40',
                  )}
                >
                  {/* Radio dot */}
                  <span className={cn(
                    'w-2.5 h-2.5 rounded-full border-2 shrink-0',
                    isActive
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/40',
                  )} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      'text-xs truncate',
                      wt.is_main ? 'font-medium' : '',
                      isActive ? 'text-foreground' : 'text-muted-foreground',
                    )}>
                      {wt.is_main ? 'main workspace' : (wt.branch ?? wt.id)}
                    </div>
                    <div className="text-[10px] text-muted-foreground/50 truncate">
                      {wt.branch ?? 'main'}
                      {wt.is_dirty ? ' \u00b7 dirty' : ' \u00b7 clean'}
                    </div>
                  </div>

                  {/* Status icons */}
                  <div className="flex items-center gap-1 shrink-0">
                    {wt.is_locked && (
                      <Lock className="w-3 h-3 text-warning" />
                    )}
                    {wt.is_dirty && (
                      <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Prune button */}
          {staleCount > 0 && (
            <>
              <div className="mx-1.5 my-1.5 h-px bg-border/30" />
              <button
                onClick={() => pruneWorktrees()}
                className={cn(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs',
                  'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                  'transition-colors duration-150',
                )}
              >
                <Broom className="w-3.5 h-3.5" />
                Prune stale worktrees
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>

      {/* Right: Create button */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'w-6 h-6 flex items-center justify-center rounded-lg shrink-0',
              'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              'active:scale-[0.9] transition-[transform,background-color,color] duration-150',
            )}
            title="Create worktree"
          >
            <Plus className="w-3.5 h-3.5" weight="bold" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-auto p-3">
          <CreateWorktreePopover onClose={() => {
            // Radix Popover closes via its own state; this is a no-op
            // but CreateWorktreePopover expects it for consistency
          }} />
        </PopoverContent>
      </Popover>
    </div>
  );
};
