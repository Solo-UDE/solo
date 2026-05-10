/**
 * DevSidebar — session-first Dev mode sidebar.
 *
 * Replaces the previous worktree-list-first layout with a Codex-style
 * SessionThreadList. Two buttons sit in the header:
 *
 *   - "+ New Session"  — creates an agent session on the active worktree
 *                        (or main). Opens it in a panel tab.
 *   - "+ New Worktree" — immediately creates a worktree with a name
 *                        auto-picked from the user's current tier pool.
 *                        No branch-name modal; right-click → Rename on a
 *                        group header is the escape hatch for users who
 *                        want something specific.
 *
 * The drill-in animation is preserved: clicking a worktree's branch badge
 * swaps to `WorktreeDetailView` via the existing `devSidebarView` state.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PlusIcon, ReloadIcon } from '@radix-ui/react-icons';
import { Brush, GitBranch, MessageCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { WorktreeDetailView } from './WorktreeDetailView';
import { SessionThreadList } from './SessionThreadList';
import { useUIStore } from '@/stores/uiStore';
import { useWorktreeStore } from '@/stores/worktreeStore';
import { useAgentStore } from '@/stores/agentStore';
import { useRepoStore } from '@/stores/repoStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { useAutoNamedWorktreeCreator } from '@/hooks/useAutoNamedWorktree';
import { cn } from '@/lib/utils';
import { wtLog } from '@/lib/worktreeLogger';

interface DevSidebarProps {
  readonly onFileOpen: (path: string) => void;
  readonly isActive?: boolean;
}

export const DevSidebar: FC<DevSidebarProps> = ({ onFileOpen, isActive = true }) => {
  const devSidebarView = useUIStore((s) => s.devSidebarView);
  const drillOutOfWorktree = useUIStore((s) => s.drillOutOfWorktree);
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);
  const isSwitching = useRepoStore((s) => s.isSwitching);
  const refreshRepoWorktrees = useRepoStore((s) => s.refreshWorktrees);

  const loadWorktrees = useWorktreeStore((s) => s.loadWorktrees);
  const pruneWorktrees = useWorktreeStore((s) => s.pruneWorktrees);

  const createSession = useAgentStore((s) => s.createSession);
  const { createAutoNamed } = useAutoNamedWorktreeCreator();

  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);

  useEffect(() => {
    if (!isActive || !activeRepoPath) return;
    void refreshRepoWorktrees(activeRepoPath);
    void loadWorktrees();
  }, [activeRepoPath, isActive, refreshRepoWorktrees, loadWorktrees]);

  // Reset drill-in view on project switch.
  useEffect(() => {
    if (!isActive) return;
    drillOutOfWorktree();
  }, [activeRepoPath, drillOutOfWorktree, isActive]);

  const syncAfterMutation = useCallback(async () => {
    if (!activeRepoPath) return;
    await Promise.all([refreshRepoWorktrees(activeRepoPath), loadWorktrees()]);
  }, [activeRepoPath, refreshRepoWorktrees, loadWorktrees]);

  const handleSessionSelect = useCallback((sessionId: string) => {
    const store = usePanelTabsStore.getState();
    for (const [instanceId, instance] of store.instances.entries()) {
      if (
        instance.panelType === BUILTIN_PANEL_TYPES.AGENT &&
        (instance.data as Record<string, unknown>)?.sessionId === sessionId
      ) {
        const tileId = store.findTileForPanel(instanceId);
        if (tileId) {
          store.setActiveTab(tileId, instanceId);
          return;
        }
      }
    }
    store.openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
  }, []);

  const handleNewSession = useCallback(async () => {
    if (isCreatingSession) return;
    setIsCreatingSession(true);
    try {
      const sessionId = await createSession();
      if (sessionId) {
        usePanelTabsStore
          .getState()
          .openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
      }
    } catch (err) {
      toast.error('Failed to start session', { description: String(err) });
    } finally {
      setIsCreatingSession(false);
    }
  }, [createSession, isCreatingSession]);

  const handleNewWorktree = useCallback(async () => {
    if (isCreatingWorktree) return;
    setIsCreatingWorktree(true);
    try {
      const { worktree, pick } = await createAutoNamed();
      await syncAfterMutation();
      toast.success(`Worktree ${pick.poolName} created`, {
        description: worktree.branch ?? pick.branch,
      });
    } catch (err) {
      wtLog('error', 'auto-named worktree creation failed', {
        action: 'ui:autoCreate',
        error: String(err),
      });
      toast.error('Failed to create worktree', { description: String(err) });
    } finally {
      setIsCreatingWorktree(false);
    }
  }, [createAutoNamed, syncAfterMutation, isCreatingWorktree]);

  const handleRefresh = useCallback(async () => {
    try {
      await syncAfterMutation();
      toast.success('Worktrees refreshed');
    } catch (err) {
      toast.error('Refresh failed', { description: String(err) });
    }
  }, [syncAfterMutation]);

  const handlePrune = useCallback(async () => {
    try {
      const pruned = await pruneWorktrees();
      if (pruned.length > 0) {
        toast.success(
          `Pruned ${pruned.length} worktree${pruned.length > 1 ? 's' : ''}`,
        );
      } else {
        toast.info('No stale worktrees to prune');
      }
      await syncAfterMutation();
    } catch (err) {
      toast.error('Prune failed', { description: String(err) });
    }
  }, [pruneWorktrees, syncAfterMutation]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        {devSidebarView === 'worktree-list' ? (
          <motion.div
            key="session-thread-list"
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.09, ease: [0.2, 0, 0, 1] }}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="flex items-center justify-between px-3.5 pb-2 pt-3.5 shrink-0">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
                  Sessions
                </p>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={handleRefresh}
                  disabled={isSwitching}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-md text-muted-foreground',
                    'hover:bg-accent hover:text-foreground',
                    'active:scale-95 transition-[background-color,color,transform] duration-150',
                    isSwitching && 'opacity-60',
                  )}
                  title="Refresh"
                >
                  <ReloadIcon
                    className={cn('w-3.5 h-3.5', isSwitching && 'animate-spin')}
                  />
                </button>
                <button
                  onClick={handlePrune}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-md text-muted-foreground',
                    'hover:bg-accent hover:text-foreground',
                    'active:scale-95 transition-[background-color,color,transform] duration-150',
                  )}
                  title="Prune stale worktrees"
                >
                  <Brush className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Primary actions: new session + new worktree */}
            <div className="mx-3.5 mb-2 grid grid-cols-2 gap-2 shrink-0">
              <button
                onClick={handleNewSession}
                disabled={isCreatingSession || !activeRepoPath}
                className={cn(
                  'inline-flex h-8 items-center justify-center gap-1.5 rounded-md',
                  'text-[12px] font-medium text-foreground',
                  'hover:bg-accent',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'active:scale-[0.98] transition-[background-color,transform] duration-150',
                )}
                title="New agent session"
              >
                {isCreatingSession ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MessageCircle className="h-3.5 w-3.5" />
                )}
                <span>New Session</span>
              </button>
              <button
                onClick={handleNewWorktree}
                disabled={isCreatingWorktree || !activeRepoPath}
                className={cn(
                  'inline-flex h-8 items-center justify-center gap-1.5 rounded-md',
                  'text-[12px] font-medium text-foreground',
                  'hover:bg-accent',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'active:scale-[0.98] transition-[background-color,transform] duration-150',
                )}
                title="Auto-create a worktree using a name from your current tier"
              >
                {isCreatingWorktree ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlusIcon className="h-3.5 w-3.5" />
                )}
                <span>New Worktree</span>
              </button>
            </div>

            <div
              key={activeRepoPath ?? 'no-repo'}
              className="min-h-0 flex-1 flex flex-col"
            >
              {!activeRepoPath ? (
                <EmptyNoProject />
              ) : (
                <SessionThreadList onSessionSelect={handleSessionSelect} />
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="worktree-detail"
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.09, ease: [0.2, 0, 0, 1] }}
            className="flex-1 flex flex-col min-h-0"
          >
            <WorktreeDetailView onFileOpen={onFileOpen} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const EmptyNoProject: FC = () => (
  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
    <div className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-border/60 bg-background/75">
      <GitBranch className="h-4 w-4 text-muted-foreground/45" />
    </div>
    <p className="text-sm font-medium text-foreground">Open a project</p>
    <p className="max-w-[22ch] text-xs leading-relaxed text-muted-foreground">
      Pick a repo from the rail to see its sessions and worktrees.
    </p>
  </div>
);
