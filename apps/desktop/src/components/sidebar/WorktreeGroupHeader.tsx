/**
 * WorktreeGroupHeader — collapsible row that groups sessions by worktree.
 *
 * Two hit targets sit side-by-side:
 *   - Left chevron+label: toggles the group's expanded state.
 *   - Right branch badge: drills into the worktree's file-explorer detail
 *     view. Clicking the badge never toggles collapse (stopPropagation).
 *
 * A small dot turns green when the worktree is currently active; the branch
 * label shows the raw git branch ("main", "solo/thames"). If the branch has
 * uncommitted changes, we render a warning dot.
 */

import type { FC } from 'react';
import { ChevronRight, GitBranch, Lock } from 'lucide-react';
import type { WorktreeInfo } from '@/bindings';
import { cn } from '@/lib/utils';

export interface WorktreeGroupHeaderProps {
  readonly worktree: WorktreeInfo;
  readonly sessionCount: number;
  readonly expanded: boolean;
  readonly isActive: boolean;
  readonly onToggle: () => void;
  readonly onDrillIn: () => void;
}

function displayName(worktree: WorktreeInfo): string {
  if (worktree.is_main) return 'main';
  // Derive a friendly label from the branch's last segment.
  const branch = worktree.branch ?? worktree.id;
  const last = branch.includes('/') ? branch.slice(branch.lastIndexOf('/') + 1) : branch;
  return capitalize(last);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const WorktreeGroupHeader: FC<WorktreeGroupHeaderProps> = ({
  worktree,
  sessionCount,
  expanded,
  isActive,
  onToggle,
  onDrillIn,
}) => {
  const branchLabel = worktree.branch ?? (worktree.is_main ? 'main' : worktree.id);

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-[8px] px-2 py-1.5',
        isActive ? 'bg-background/80' : 'hover:bg-background/55',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-150',
            expanded ? 'rotate-90' : 'rotate-0',
          )}
        />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              isActive ? 'bg-primary' : 'bg-muted-foreground/35',
            )}
            aria-hidden="true"
          />
          <span
            className={cn(
              'truncate text-[12px] font-medium',
              isActive ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {displayName(worktree)}
          </span>
          {sessionCount > 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground/60">
              {sessionCount}
            </span>
          )}
        </span>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDrillIn();
        }}
        title={`Open ${branchLabel}`}
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px]',
          'text-muted-foreground transition-[color,background-color,border-color] duration-150',
          'hover:border-border hover:bg-card hover:text-foreground',
        )}
      >
        {worktree.is_locked ? (
          <Lock className="h-2.5 w-2.5" />
        ) : (
          <GitBranch className="h-2.5 w-2.5" />
        )}
        <span className="max-w-[10rem] truncate">{branchLabel}</span>
      </button>
    </div>
  );
};
