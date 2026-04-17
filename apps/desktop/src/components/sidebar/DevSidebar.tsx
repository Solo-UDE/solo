/**
 * DevSidebar - Developer mode sidebar with worktree-first navigation.
 * Switches between worktree list view and worktree detail (drill-in) view.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PlusIcon, ReloadIcon } from '@radix-ui/react-icons';
import { Brush, Network } from 'lucide-react';
import { WorktreeCardLarge } from './WorktreeCardLarge';
import { WorktreeDetailView } from './WorktreeDetailView';
import { useUIStore } from '@/stores/uiStore';
import { useWorktreeStore } from '@/stores/worktreeStore';
import { useRepoStore } from '@/stores/repoStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { wtLog, wtSnapshot } from '@/lib/worktreeLogger';
import type { WorktreeInfo } from '../../bindings';

const EMPTY_WORKTREES: WorktreeInfo[] = [];

interface DevSidebarProps {
  readonly onFileOpen: (path: string) => void;
}

export const DevSidebar: FC<DevSidebarProps> = ({ onFileOpen }) => {
  const devSidebarView = useUIStore((s) => s.devSidebarView);
  const drillIntoWorktree = useUIStore((s) => s.drillIntoWorktree);
  const drillOutOfWorktree = useUIStore((s) => s.drillOutOfWorktree);
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);
  const isSwitching = useRepoStore((s) => s.isSwitching);
  const refreshRepoWorktrees = useRepoStore((s) => s.refreshWorktrees);

  // Source the displayed list from repoStore — updates instantly when the user
  // switches projects, no extra IPC round-trip required.
  const worktrees = useRepoStore((s) =>
    s.activeRepoPath ? s.repos.get(s.activeRepoPath)?.worktrees ?? EMPTY_WORKTREES : EMPTY_WORKTREES,
  );

  const activeWorktreeId = useWorktreeStore((s) => s.activeWorktreeId);
  const setActive = useWorktreeStore((s) => s.setActive);
  const lock = useWorktreeStore((s) => s.lock);
  const unlock = useWorktreeStore((s) => s.unlock);
  const removeWorktree = useWorktreeStore((s) => s.removeWorktree);
  const pruneWorktrees = useWorktreeStore((s) => s.pruneWorktrees);
  const setupProgress = useWorktreeStore((s) => s.setupProgress);
  const createWorktree = useWorktreeStore((s) => s.createWorktree);
  const loadWorktrees = useWorktreeStore((s) => s.loadWorktrees);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Sync per-repo cache from disk whenever the active repo changes.
  // Also kick off the worktreeStore sync so action handlers have fresh state.
  useEffect(() => {
    if (!activeRepoPath) return;
    wtLog('info', 'active repo changed → refreshing worktree caches', {
      action: 'repoSwitch',
      activeRepoPath,
    });
    void refreshRepoWorktrees(activeRepoPath);
    void loadWorktrees();
  }, [activeRepoPath, refreshRepoWorktrees, loadWorktrees]);

  // Reset drill-in view when repo changes
  useEffect(() => {
    drillOutOfWorktree();
  }, [activeRepoPath, drillOutOfWorktree]);

  // Helper: after any mutation, update both stores so the UI stays consistent.
  const syncCachesAfterMutation = useCallback(async () => {
    if (!activeRepoPath) return;
    await Promise.all([refreshRepoWorktrees(activeRepoPath), loadWorktrees()]);
  }, [activeRepoPath, refreshRepoWorktrees, loadWorktrees]);

  const handleSelectWorktree = useCallback(async (wt: WorktreeInfo) => {
    wtLog('info', 'user clicked worktree', { action: 'ui:select', ...wtSnapshot(wt) });
    try {
      const id = wt.is_main ? null : wt.id;
      await setActive(id);
      drillIntoWorktree(wt.id);
    } catch (err) {
      const msg = String(err);
      wtLog('error', 'select failed', { action: 'ui:select', ...wtSnapshot(wt), error: msg });
      if (msg.includes('Worktree not found') || msg.includes('No such file or directory')) {
        toast.error('Worktree folder is missing', {
          description: 'Try the refresh or prune button to clean up stale entries.',
        });
        await syncCachesAfterMutation();
      } else {
        toast.error('Could not open worktree', { description: msg });
      }
    }
  }, [setActive, drillIntoWorktree, syncCachesAfterMutation]);

  const handleToggleLock = useCallback(async (wt: WorktreeInfo) => {
    wtLog('info', `user ${wt.is_locked ? 'unlocking' : 'locking'} worktree`, {
      action: 'ui:toggleLock',
      ...wtSnapshot(wt),
    });
    try {
      if (wt.is_locked) {
        await unlock(wt.id);
      } else {
        await lock(wt.id, 'Locked from sidebar');
      }
      await syncCachesAfterMutation();
    } catch (err) {
      const msg = String(err);
      wtLog('error', 'toggle lock failed', { action: 'ui:toggleLock', ...wtSnapshot(wt), error: msg });
      toast.error('Failed to change lock state', { description: msg });
    }
  }, [lock, unlock, syncCachesAfterMutation]);

  const handleRemove = useCallback(async (wt: WorktreeInfo) => {
    wtLog('info', 'user clicked remove', { action: 'ui:remove', ...wtSnapshot(wt) });
    try {
      await removeWorktree(wt.id, wt.is_locked);
      await syncCachesAfterMutation();
    } catch (err) {
      const msg = String(err);
      wtLog('error', 'remove failed', { action: 'ui:remove', ...wtSnapshot(wt), error: msg });
      // Stale entry: backend has no record but frontend does — fall back to prune
      if (msg.includes('Worktree not found') || msg.includes('No such file or directory')) {
        try {
          const pruned = await pruneWorktrees();
          toast.success(
            pruned.length > 0
              ? `Cleaned up ${pruned.length} stale worktree${pruned.length > 1 ? 's' : ''}`
              : 'Worktree already removed — refreshed list',
          );
          await syncCachesAfterMutation();
        } catch (pruneErr) {
          wtLog('error', 'fallback prune failed', {
            action: 'ui:remove:fallbackPrune',
            ...wtSnapshot(wt),
            error: String(pruneErr),
          });
          toast.error('Failed to clean up worktree', { description: String(pruneErr) });
        }
        return;
      }
      toast.error('Failed to remove worktree', { description: msg });
    }
  }, [removeWorktree, pruneWorktrees, syncCachesAfterMutation]);

  const handleViewDiff = useCallback((wt: WorktreeInfo) => {
    usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.WORKTREE_DIFF, {
      worktreeId: wt.id,
      branch: wt.branch ?? wt.id,
    });
  }, []);

  const handlePrune = useCallback(async () => {
    wtLog('info', 'user clicked prune', { action: 'ui:prune', activeRepoPath });
    try {
      const pruned = await pruneWorktrees();
      if (pruned.length > 0) {
        toast.success(`Pruned ${pruned.length} worktree${pruned.length > 1 ? 's' : ''}`);
      } else {
        toast.info('No stale worktrees to prune');
      }
      await syncCachesAfterMutation();
    } catch (err) {
      wtLog('error', 'prune failed', {
        action: 'ui:prune',
        activeRepoPath,
        error: String(err),
      });
      toast.error('Prune failed', { description: String(err) });
    }
  }, [pruneWorktrees, syncCachesAfterMutation, activeRepoPath]);

  const handleRefresh = useCallback(async () => {
    wtLog('info', 'user clicked refresh', { action: 'ui:refresh', activeRepoPath });
    try {
      await syncCachesAfterMutation();
      toast.success('Worktrees refreshed');
    } catch (err) {
      wtLog('error', 'refresh failed', {
        action: 'ui:refresh',
        activeRepoPath,
        error: String(err),
      });
      toast.error('Refresh failed', { description: String(err) });
    }
  }, [syncCachesAfterMutation, activeRepoPath]);

  const handleCreate = useCallback(async () => {
    if (!branchName.trim()) return;
    setIsCreating(true);
    wtLog('info', 'user creating worktree', {
      action: 'ui:create',
      branch: branchName.trim(),
      activeRepoPath,
    });
    try {
      await createWorktree(branchName.trim(), true);
      setBranchName('');
      setShowCreate(false);
      await syncCachesAfterMutation();
    } catch (err) {
      wtLog('error', 'create failed', {
        action: 'ui:create',
        branch: branchName.trim(),
        error: String(err),
      });
    } finally {
      setIsCreating(false);
    }
  }, [branchName, createWorktree, syncCachesAfterMutation, activeRepoPath]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {devSidebarView === 'worktree-list' ? (
          <motion.div
            key="worktree-list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="flex items-center justify-between px-3.5 pb-2 pt-3.5 shrink-0">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
                  Branches
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  Worktree sessions
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowCreate((p) => !p)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-[8px] border border-border/70 bg-background/65',
                    'text-muted-foreground hover:border-border hover:bg-card hover:text-foreground',
                    'active:scale-95 transition-all duration-150',
                  )}
                  title="New Worktree"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleRefresh}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-[8px] border border-border/70 bg-background/65',
                    'text-muted-foreground hover:border-border hover:bg-card hover:text-foreground',
                    'active:scale-95 transition-all duration-150',
                    isSwitching && 'opacity-60',
                  )}
                  title="Refresh worktrees"
                  disabled={isSwitching}
                >
                  <ReloadIcon
                    className={cn('w-3.5 h-3.5', isSwitching && 'animate-spin')}
                  />
                </button>
                <button
                  onClick={handlePrune}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-[8px] border border-border/70 bg-background/65',
                    'text-muted-foreground hover:border-border hover:bg-card hover:text-foreground',
                    'active:scale-95 transition-all duration-150',
                  )}
                  title="Prune stale worktrees"
                >
                  <Brush className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Create form */}
            <AnimatePresence>
              {showCreate && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="mx-3.5 mb-2 rounded-[9px] border border-border/70 bg-background/65 px-3 py-3 space-y-2">
                    <input
                      type="text"
                      placeholder="Branch name"
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                      className="h-8 w-full rounded-[8px] border border-border/70 bg-card px-3 text-xs outline-none focus:ring-1 focus:ring-ring"
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCreate}
                        disabled={!branchName.trim() || isCreating}
                        className="inline-flex h-8 items-center rounded-[8px] bg-primary px-3.5 text-xs font-medium text-primary-foreground hover:brightness-105 disabled:opacity-50"
                      >
                        {isCreating ? 'Creating...' : 'Create'}
                      </button>
                      <button
                        onClick={() => setShowCreate(false)}
                        className="inline-flex h-8 items-center rounded-[8px] px-3 text-xs text-muted-foreground hover:bg-card hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Worktree cards — keyed by repo so a project switch remounts
                the AnimatePresence tree and cards appear instantly,
                while add/remove within the same repo still animates. */}
            <div
              key={activeRepoPath ?? 'no-repo'}
              className="flex-1 overflow-y-auto px-2 pb-3"
            >
              {worktrees.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-[18px] border border-border/60 bg-background/75">
                    <Network className="w-5 h-5 text-muted-foreground/40" />
                  </div>
                  <p className="text-sm font-medium text-foreground">No worktrees yet</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Create one to run agents in isolated branches
                  </p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {worktrees.map((wt) => (
                    <WorktreeCardLarge
                      key={wt.id}
                      worktree={wt}
                      isActive={wt.is_main ? activeWorktreeId === null : activeWorktreeId === wt.id}
                      setupLines={setupProgress.get(wt.id)}
                      onSelect={() => handleSelectWorktree(wt)}
                      onToggleLock={() => handleToggleLock(wt)}
                      onRemove={() => handleRemove(wt)}
                      onViewDiff={() => handleViewDiff(wt)}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="worktree-detail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className="flex-1 flex flex-col min-h-0"
          >
            <WorktreeDetailView onFileOpen={onFileOpen} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
