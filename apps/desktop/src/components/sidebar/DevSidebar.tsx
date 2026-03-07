/**
 * DevSidebar - Developer mode sidebar with worktree-first navigation.
 * Switches between worktree list view and worktree detail (drill-in) view.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Broom, TreeStructure } from '@phosphor-icons/react';
import { WorktreeCardLarge } from './WorktreeCardLarge';
import { WorktreeDetailView } from './WorktreeDetailView';
import { useUIStore } from '@/stores/uiStore';
import { useWorktreeStore, useWorktreeList } from '@/stores/worktreeStore';
import { useRepoStore } from '@/stores/repoStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { WorktreeInfo } from '../../bindings';

interface DevSidebarProps {
  readonly onFileOpen: (path: string) => void;
}

export const DevSidebar: FC<DevSidebarProps> = ({ onFileOpen }) => {
  const devSidebarView = useUIStore((s) => s.devSidebarView);
  const drillIntoWorktree = useUIStore((s) => s.drillIntoWorktree);
  const drillOutOfWorktree = useUIStore((s) => s.drillOutOfWorktree);
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);

  const worktrees = useWorktreeList();
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

  // Load worktrees on mount
  useEffect(() => {
    loadWorktrees();
  }, [loadWorktrees]);

  // Reset drill-in view when repo changes
  useEffect(() => {
    drillOutOfWorktree();
  }, [activeRepoPath, drillOutOfWorktree]);

  const handleSelectWorktree = useCallback(async (wt: WorktreeInfo) => {
    const id = wt.is_main ? null : wt.id;
    await setActive(id);
    drillIntoWorktree(wt.id);
  }, [setActive, drillIntoWorktree]);

  const handleToggleLock = useCallback(async (wt: WorktreeInfo) => {
    if (wt.is_locked) {
      await unlock(wt.id);
    } else {
      await lock(wt.id, 'Locked from sidebar');
    }
  }, [lock, unlock]);

  const handleRemove = useCallback(async (wt: WorktreeInfo) => {
    await removeWorktree(wt.id, wt.is_locked);
  }, [removeWorktree]);

  const handleViewDiff = useCallback((wt: WorktreeInfo) => {
    usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.WORKTREE_DIFF, {
      worktreeId: wt.id,
      branch: wt.branch ?? wt.id,
    });
  }, []);

  const handlePrune = useCallback(async () => {
    try {
      const pruned = await pruneWorktrees();
      if (pruned.length > 0) {
        toast.success(`Pruned ${pruned.length} worktree${pruned.length > 1 ? 's' : ''}`);
      }
    } catch (err) {
      toast.error('Prune failed', { description: String(err) });
    }
  }, [pruneWorktrees]);

  const handleCreate = useCallback(async () => {
    if (!branchName.trim()) return;
    setIsCreating(true);
    try {
      await createWorktree(branchName.trim(), true);
      setBranchName('');
      setShowCreate(false);
    } catch {
      // Error is set in the store
    } finally {
      setIsCreating(false);
    }
  }, [branchName, createWorktree]);

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
            {/* Section header */}
            <div className="flex items-center justify-between px-3 h-8 shrink-0">
              <span className="text-[11px] text-muted-foreground/50 font-semibold">
                Worktrees
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setShowCreate((p) => !p)}
                  className={cn(
                    'w-5 h-5 flex items-center justify-center rounded',
                    'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    'active:scale-95 transition-all duration-200',
                  )}
                  title="New Worktree"
                >
                  <Plus className="w-3 h-3" weight="bold" />
                </button>
                <button
                  onClick={handlePrune}
                  className={cn(
                    'w-5 h-5 flex items-center justify-center rounded',
                    'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    'active:scale-95 transition-all duration-200',
                  )}
                  title="Prune stale worktrees"
                >
                  <Broom className="w-3 h-3" weight="bold" />
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
                  <div className="mx-2 mb-1 px-3 py-2 rounded-lg bg-muted/20 border border-border/20 space-y-2">
                    <input
                      type="text"
                      placeholder="Branch name"
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                      className="w-full h-7 px-2 text-xs bg-muted/30 border border-border/50 rounded outline-none focus:ring-1 focus:ring-ring"
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCreate}
                        disabled={!branchName.trim() || isCreating}
                        className="h-6 px-3 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                      >
                        {isCreating ? 'Creating...' : 'Create'}
                      </button>
                      <button
                        onClick={() => setShowCreate(false)}
                        className="h-6 px-3 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Worktree cards */}
            <div className="flex-1 overflow-y-auto py-1.5">
              {worktrees.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                  <div className="w-10 h-10 rounded-2xl bg-muted/50 flex items-center justify-center mb-2">
                    <TreeStructure className="w-5 h-5 text-muted-foreground/40" />
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">No worktrees yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
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
