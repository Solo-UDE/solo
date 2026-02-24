/**
 * PrimarySidebar - Unified accordion sidebar with repo cards.
 * All repos are always visible. The active repo expands inline to show
 * worktree list + horizontal tab bar + panel reel.
 */

import { useCallback, useMemo, forwardRef } from 'react';
import { motion, LayoutGroup } from 'motion/react';
import { FolderPlus } from '@phosphor-icons/react';
import { FileExplorer } from '@/components/file-explorer';
import { SessionList } from '@/components/agent';
import { SourceControlPanel } from '@/components/source-control';
import { ContextHeader } from './ContextHeader';
import { RepoListHeader } from './RepoListHeader';
import { RepoCard } from './RepoCard';
import { InlineWorktreeList } from './InlineWorktreeList';
import { HorizontalTabBar } from './HorizontalTabBar';
import { TRANSITIONS } from '@/lib/constants';
import { useUIStore, useIsLeftSidebarCollapsed } from '@/stores/uiStore';
import { useRepoStore, useRepoList } from '@/stores/repoStore';
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
  const createSession = useAgentStore((state) => state.createSession);
  const addRepo = useRepoStore((state) => state.addRepo);
  const activeRepoPath = useRepoStore((state) => state.activeRepoPath);
  const repos = useRepoList();

  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  // Open a session as a tab - find existing tab first, otherwise open new
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
      className="h-full flex flex-col relative bg-sidebar overflow-hidden pt-[38px]"
      style={{
        width,
        transition: `width ${TRANSITIONS.sidebar}`,
      }}
    >
      {!isCollapsed && (
        <LayoutGroup>
          {/* Header */}
          <RepoListHeader onAddRepo={handleAddRepo} />

          {/* Repo list (accordion) */}
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto py-1">
            {repos.length === 0 ? (
              /* Empty state */
              <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
                <div className="w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center">
                  <FolderPlus className="w-5 h-5 text-muted-foreground/50" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground/70 mb-1">No repositories</p>
                  <p className="text-xs text-muted-foreground/40">Add a repository to get started</p>
                </div>
                <button
                  onClick={handleAddRepo}
                  className="h-8 px-3.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 active:scale-[0.97] transition-all duration-200"
                >
                  Add Repository
                </button>
              </div>
            ) : (
              repos.map((repo) => {
                const isActive = repo.path === activeRepoPath;
                const isExpanded = repo.isExpanded && isActive;

                return (
                  <RepoCard key={repo.path} repo={repo} isActive={isActive}>
                    {isExpanded && (
                      <div className="flex flex-col flex-1 min-h-0">
                        {/* Inline worktree list */}
                        <InlineWorktreeList repo={repo} />

                        {/* Context header (branch switcher + view-specific actions) */}
                        <ContextHeader onNewSession={handleNewSession} />

                        {/* Horizontal tab bar */}
                        <HorizontalTabBar />

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
                      </div>
                    )}
                  </RepoCard>
                );
              })
            )}
          </div>
        </LayoutGroup>
      )}
    </aside>
  );
});
