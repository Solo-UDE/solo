/**
 * PrimarySidebar - Dual-mode sidebar: repo list or worktree detail view
 */

import { useCallback, useMemo, forwardRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileExplorer } from '@/components/file-explorer';
import { SessionList } from '@/components/agent';
import { SourceControlPanel } from '@/components/source-control';
import { IconRail } from './IconRail';
import { ContextHeader } from './ContextHeader';
import { RepoListHeader } from './RepoListHeader';
import { RepoList } from './RepoList';
import { WorktreeBackButton } from './WorktreeBackButton';
import { TRANSITIONS } from '@/lib/constants';
import { useUIStore, useIsLeftSidebarCollapsed } from '@/stores/uiStore';
import { useRepoStore } from '@/stores/repoStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { openFolderDialog } from '@/lib/tauri/fs';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PrimarySidebarProps {
  readonly width: number;
  readonly onFileOpen: (path: string) => void;
}

const TAB_KEYS = ['explorer', 'sessions', 'source-control'] as const;

export const PrimarySidebar = forwardRef<HTMLElement, PrimarySidebarProps>(({ width, onFileOpen }, ref) => {
  const isCollapsed = useIsLeftSidebarCollapsed();
  const activeTab = useUIStore((state) => state.activeTab);
  const sidebarView = useUIStore((state) => state.sidebarView);
  const createSession = useAgentStore((state) => state.createSession);
  const addRepo = useRepoStore((state) => state.addRepo);

  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  // Open a session as a tab — find existing tab first, otherwise open new
  const handleSessionSelect = useCallback((sessionId: string): void => {
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
    openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
  }, [openPanel]);

  // Create session and open as tab
  const createSessionAndShow = useCallback((): void => {
    createSession().then((sessionId) => {
      if (sessionId) {
        openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
      }
    }).catch((err: unknown) => {
      console.error('Failed to create session:', err);
    });
  }, [createSession, openPanel]);

  const handleNewSession = useCallback((): void => {
    createSessionAndShow();
  }, [createSessionAndShow]);

  // Add repository via folder picker
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

  // Compute x offset for the 3-panel reel
  const activeTabIndex = TAB_KEYS.indexOf(activeTab);
  const reelOffsetPercent = (activeTabIndex >= 0 ? activeTabIndex : 0) * -33.333;

  return (
    <aside
      ref={ref}
      className="h-full flex flex-row relative bg-sidebar overflow-hidden pt-[38px]"
      style={{
        width,
        transition: `width ${TRANSITIONS.sidebar}`,
      }}
    >
      {/* Icon Rail — only in worktree detail view */}
      {!isCollapsed && sidebarView === 'worktree' && <IconRail />}

      {/* Content Column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {!isCollapsed && sidebarView === 'repos' ? (
            /* ── Repos View ── */
            <motion.div
              key="repos"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="flex flex-col h-full"
            >
              <RepoListHeader onAddRepo={handleAddRepo} />
              <RepoList onAddRepo={handleAddRepo} />
            </motion.div>
          ) : !isCollapsed && sidebarView === 'worktree' ? (
            /* ── Worktree Detail View ── */
            <motion.div
              key="worktree"
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="flex flex-col h-full"
            >
              <WorktreeBackButton />
              <ContextHeader onNewSession={handleNewSession} />

              {/* Tab Content - Sliding Reel (3 panels) */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <motion.div
                  className="flex h-full"
                  style={{ width: '300%' }}
                  animate={{ x: `${reelOffsetPercent}%` }}
                  transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                >
                  <div className="w-1/3 h-full overflow-hidden">
                    <FileExplorer
                      onFileOpen={onFileOpen}
                      className={cn(
                        'h-full transition-opacity duration-150',
                        isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                      )}
                    />
                  </div>
                  <div className="w-1/3 h-full overflow-hidden">
                    <SessionList
                      onSessionSelect={handleSessionSelect}
                      onNewSession={handleNewSession}
                      className="h-full"
                    />
                  </div>
                  <div className="w-1/3 h-full overflow-hidden">
                    <SourceControlPanel className="h-full" />
                  </div>
                </motion.div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </aside>
  );
});
