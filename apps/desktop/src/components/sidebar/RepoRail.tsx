/**
 * RepoRail - Vertical icon rail showing one icon per repository.
 * Always visible. Supports two modes:
 *   - Collapsed (48px): icon-only buttons with tooltips on hover
 *   - Expanded (200px): full rows showing icon, repo name, and branch
 * Toggle between modes via the button at the bottom of the rail.
 */

import { useCallback, useRef, useState, type FC } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, GitBranch, X, Trash } from '@phosphor-icons/react';
import { useRepoStore, useRepoList } from '@/stores/repoStore';
import type { RepoEntry } from '@/stores/repoStore';
import { getRepoIcon, getRepoColorVar, getRepoColorMutedVar } from '@/lib/repoIdentity';
import { openFolderDialog } from '@/lib/tauri/fs';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SIDEBAR } from '@/lib/constants';
import { useUIStore } from '@/stores/uiStore';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu';

const RAIL_SPRING = { type: 'spring' as const, stiffness: 600, damping: 35 };

export const RepoRail: FC = () => {
  const repos = useRepoList();
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);
  const selectWorktree = useRepoStore((s) => s.selectWorktree);
  const addRepo = useRepoStore((s) => s.addRepo);
  const removeRepo = useRepoStore((s) => s.removeRepo);

  const railExpanded = useUIStore((s) => s.railExpanded);
  const setRailExpanded = useUIStore((s) => s.setRailExpanded);

  const handleAddRepo = useCallback(async () => {
    try {
      const path = await openFolderDialog();
      if (path) {
        await addRepo(path);
      }
    } catch (err) {
      toast.error('Failed to add repository', { description: String(err) });
    }
  }, [addRepo]);

  // Auto-expand on hover, collapse on leave
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setRailExpanded(true);
    }, 250);
  }, [setRailExpanded]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setRailExpanded(false);
  }, [setRailExpanded]);

  const railWidth = railExpanded ? SIDEBAR.railExpandedWidth : SIDEBAR.railWidth;

  return (
    <motion.aside
      className="h-full flex flex-col py-2 gap-1 bg-sidebar border-r border-border/20 pt-[38px] shrink-0 overflow-hidden"
      animate={{ width: railWidth }}
      transition={RAIL_SPRING}
      style={{ width: railWidth }}
      role="navigation"
      aria-label="Repository rail"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Add repo button */}
      <div
        className={cn(
          'flex flex-col gap-1',
          railExpanded ? 'items-stretch px-1.5' : 'items-center',
        )}
      >
        <button
          onClick={handleAddRepo}
          className={cn(
            'flex items-center justify-center rounded-lg',
            'text-muted-foreground/50 hover:text-muted-foreground',
            'hover:bg-muted/40 active:scale-95',
            'transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1',
            railExpanded ? 'h-8 w-full gap-2 px-2' : 'w-9 h-9',
          )}
          title="Add Repository"
          aria-label="Add Repository"
        >
          <Plus className="w-4 h-4 shrink-0" weight="bold" />
          {railExpanded && <span className="text-xs truncate">Add Repository</span>}
        </button>
      </div>

      <div className="h-px mx-2 bg-border/10 my-1" />

      {/* Repo list */}
      <div
        className={cn(
          'flex flex-col gap-1 flex-1 overflow-y-auto overflow-x-hidden scrollbar-none py-1',
          !railExpanded && 'items-center',
        )}
      >
        <AnimatePresence initial={false}>
          {repos.map((repo) => (
            <motion.div
              key={repo.path}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              <RailIcon
                repo={repo}
                isActive={repo.path === activeRepoPath}
                expanded={railExpanded}
                onClick={() => selectWorktree(repo.path, null)}
                onRemove={() => removeRepo(repo.path)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.aside>
  );
};

// ---------------------------------------------------------------------------
// RailIcon - Individual repo icon button in the rail
// ---------------------------------------------------------------------------

interface RailIconProps {
  repo: RepoEntry;
  isActive: boolean;
  expanded: boolean;
  onClick: () => void;
  onRemove: () => void;
}

const RailIcon: FC<RailIconProps> = ({ repo, isActive, expanded, onClick, onRemove }) => {
  const [isHovered, setIsHovered] = useState(false);
  const Icon = getRepoIcon(repo.icon);

  if (expanded) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative group px-1">
            {/* Active accent bar */}
            {isActive && (
              <motion.div
                layoutId="rail-accent"
                className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full z-10"
                style={{ backgroundColor: getRepoColorVar(repo.color) }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}

            <button
              onClick={onClick}
              className={cn(
                'relative w-full flex items-center gap-2.5 px-3 py-2 rounded-lg',
                'transition-colors duration-150 text-left',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1',
                isActive ? 'shadow-sm' : 'hover:bg-muted/40',
              )}
              style={isActive ? { backgroundColor: getRepoColorMutedVar(repo.color) } : undefined}
              aria-label={`${repo.name}${repo.currentBranch ? ` (${repo.currentBranch})` : ''}`}
            >
              <Icon
                className="w-[18px] h-[18px] shrink-0"
                weight={isActive ? 'fill' : 'regular'}
                style={{ color: isActive ? getRepoColorVar(repo.color) : undefined }}
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span
                  className={cn(
                    'text-xs font-medium truncate leading-tight',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )}
                  title={repo.name}
                >
                  {repo.name}
                </span>
                {repo.currentBranch && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 leading-tight mt-0.5">
                    <GitBranch className="w-2.5 h-2.5 shrink-0" weight="bold" />
                    <span className="truncate" title={repo.currentBranch}>{repo.currentBranch}</span>
                  </span>
                )}
              </div>
              {repo.worktrees.length > 1 && (
                <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">
                  {repo.worktrees.length}wt
                </span>
              )}
            </button>

            {/* Hover close button */}
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className={cn(
                'absolute right-2 top-1/2 -translate-y-1/2',
                'w-5 h-5 flex items-center justify-center rounded shrink-0',
                'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
                'text-muted-foreground/50 hover:text-foreground hover:bg-muted/60',
              )}
              title="Remove repository"
              aria-label={`Remove ${repo.name}`}
            >
              <X className="w-3 h-3" weight="bold" />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem
            onClick={onRemove}
            className="text-destructive focus:text-destructive"
          >
            <Trash className="h-3.5 w-3.5" /> Remove
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // Collapsed mode - icon only with tooltip and right-click context menu
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative flex items-center justify-center">
          {/* Active accent bar */}
          {isActive && (
            <motion.div
              layoutId="rail-accent"
              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
              style={{ backgroundColor: getRepoColorVar(repo.color) }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}

          <motion.button
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onFocus={() => setIsHovered(true)}
            onBlur={() => setIsHovered(false)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className={cn(
              'relative w-9 h-9 flex items-center justify-center rounded-lg',
              'transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1',
              isActive
                ? 'shadow-sm'
                : 'hover:bg-muted/40',
            )}
            style={isActive ? {
              backgroundColor: getRepoColorMutedVar(repo.color),
            } : undefined}
            title={`${repo.name}${repo.currentBranch ? ` (${repo.currentBranch})` : ''}`}
            aria-label={`${repo.name}${repo.currentBranch ? ` (${repo.currentBranch})` : ''}`}
          >
            <Icon
              className="w-[18px] h-[18px]"
              weight={isActive ? 'fill' : 'regular'}
              style={{ color: isActive ? getRepoColorVar(repo.color) : undefined }}
            />
          </motion.button>

          {/* Tooltip on hover */}
          <AnimatePresence>
            {isHovered && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className={cn(
                  'absolute left-full ml-2 z-50 pointer-events-none',
                  'px-2.5 py-1.5 rounded-lg',
                  'bg-popover border border-border/30 shadow-glass',
                  'text-xs text-foreground whitespace-nowrap',
                )}
              >
                <div className="font-medium">{repo.name}</div>
                {repo.currentBranch && (
                  <div className="text-muted-foreground/70 text-[10px] mt-0.5">
                    {repo.currentBranch}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem
          onClick={onRemove}
          className="text-destructive focus:text-destructive"
        >
          <Trash className="h-3.5 w-3.5" /> Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
