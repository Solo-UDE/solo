/**
 * WorktreeCardLarge - Prominent worktree card for the Dev sidebar.
 * ~60-64px height with branch name, status indicators, and hover actions.
 */

import { useCallback } from 'react';
import type { FC } from 'react';
import { motion } from 'motion/react';
import { Lock, LockOpen, Trash, GitDiff, Robot, CircleNotch } from '@phosphor-icons/react';
import type { WorktreeInfo } from '../../bindings';
import { cn } from '@/lib/utils';

interface WorktreeCardLargeProps {
  readonly worktree: WorktreeInfo;
  readonly isActive: boolean;
  readonly setupLines?: string[];
  readonly onSelect: () => void;
  readonly onToggleLock: () => void;
  readonly onRemove: () => void;
  readonly onViewDiff: () => void;
}

export const WorktreeCardLarge: FC<WorktreeCardLargeProps> = ({
  worktree,
  isActive,
  setupLines,
  onSelect,
  onToggleLock,
  onRemove,
  onViewDiff,
}) => {
  const isSettingUp = setupLines && setupLines.length > 0 &&
    !setupLines[setupLines.length - 1]?.includes('Setup complete');

  const branchLabel = worktree.is_main ? 'main' : (worktree.branch ?? worktree.id);
  const shortSha = worktree.head_sha?.slice(0, 7);

  const handleAction = useCallback((e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      onClick={onSelect}
      className={cn(
        'group relative mx-2 my-1 px-3 py-2.5 rounded-xl cursor-pointer',
        'transition-all duration-150',
        isActive
          ? 'bg-muted/40 shadow-sm'
          : 'hover:bg-muted/30',
      )}
    >
      {/* Left accent bar */}
      {isActive && (
        <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-primary" />
      )}

      {/* Content — name takes full row width; hover action icons overlay the
          right edge so they don't reserve flex space when hidden. */}
      <div className="min-w-0">
        {/* Branch name */}
        <div className="flex items-center gap-1.5">
          {isSettingUp && (
            <CircleNotch className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
          )}
          <span className={cn(
            'text-[12px] font-semibold truncate',
            isActive ? 'text-foreground' : 'text-muted-foreground',
          )}>
            {branchLabel}
          </span>
        </div>

        {/* Status row */}
        <div className="flex items-center gap-2 mt-1">
          {worktree.is_dirty && (
            <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" title="Uncommitted changes" />
          )}
          {worktree.is_locked && (
            <span title="Locked"><Lock className="w-3 h-3 text-warning shrink-0" /></span>
          )}
          {worktree.agent_session_id && (
            <span title="Agent session active"><Robot className="w-3 h-3 text-primary/70 shrink-0" /></span>
          )}
          {shortSha && (
            <span className="text-[10px] text-muted-foreground/60 font-mono">
              {shortSha}
            </span>
          )}
        </div>
      </div>

      {/* Hover action icons — absolutely positioned so they overlay only on hover.
          No background pill: the icons sit transparently above the row, which
          already has its own hover bg for separation from the page. */}
      {!worktree.is_main && (
        <div className="absolute right-2 top-2.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <ActionButton onClick={(e) => handleAction(e, onViewDiff)} title="View diff" icon={GitDiff} />
          <ActionButton
            onClick={(e) => handleAction(e, onToggleLock)}
            title={worktree.is_locked ? 'Unlock' : 'Lock'}
            icon={worktree.is_locked ? LockOpen : Lock}
          />
          <ActionButton
            onClick={(e) => handleAction(e, onRemove)}
            title="Remove"
            icon={Trash}
            variant="destructive"
          />
        </div>
      )}
    </motion.div>
  );
};

const ActionButton: FC<{
  onClick: (e: React.MouseEvent) => void;
  title: string;
  icon: React.ComponentType<{ className?: string; weight?: 'bold' }>;
  variant?: 'default' | 'destructive';
}> = ({ onClick, title, icon: Icon, variant = 'default' }) => (
  <button
    onClick={onClick}
    className={cn(
      'w-5 h-5 flex items-center justify-center rounded',
      'active:scale-95 transition-all duration-150',
      variant === 'destructive'
        ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
    )}
    title={title}
  >
    <Icon className="w-3 h-3" weight="bold" />
  </button>
);
