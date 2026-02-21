/**
 * PrimarySidebar - Main collapsible sidebar with icon rail navigation
 */

import { useCallback, useMemo, forwardRef } from 'react';
import { motion } from 'motion/react';
import { FileExplorer } from '@/components/file-explorer';
import { SessionList } from '@/components/agent';
import { SourceControlPanel } from '@/components/source-control';
import { IconRail } from './IconRail';
import { WorktreeScopeBar } from './WorktreeScopeBar';
import { ContextHeader } from './ContextHeader';
import { TRANSITIONS } from '@/lib/constants';
import { useUIStore, useIsLeftSidebarCollapsed } from '@/stores/uiStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { cn } from '@/lib/utils';

interface PrimarySidebarProps {
  readonly width: number;
  readonly onFileOpen: (path: string) => void;
}

const TAB_KEYS = ['explorer', 'sessions', 'source-control'] as const;

export const PrimarySidebar = forwardRef<HTMLElement, PrimarySidebarProps>(({ width, onFileOpen }, ref) => {
  const isCollapsed = useIsLeftSidebarCollapsed();
  const activeTab = useUIStore((state) => state.activeTab);
  const createSession = useAgentStore((state) => state.createSession);

  // Get store actions directly to avoid selector subscription issues
  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  // Open a session as a tab — find existing tab first, otherwise open new
  const handleSessionSelect = useCallback((sessionId: string): void => {
    const store = usePanelTabsStore.getState();
    // Search for an existing agent panel with this session
    for (const [instanceId, instance] of store.instances.entries()) {
      if (
        instance.panelType === BUILTIN_PANEL_TYPES.AGENT &&
        (instance.data as Record<string, unknown>)?.sessionId === sessionId
      ) {
        // Found existing tab — activate it
        const tileId = store.findTileForPanel(instanceId);
        if (tileId) {
          store.setActiveTab(tileId, instanceId);
          return;
        }
      }
    }
    // No existing tab found — open a new one
    openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
  }, [openPanel]);

  // Create session and open as tab
  const createSessionAndShow = useCallback((): void => {
    createSession().then((sessionId) => {
      if (sessionId) {
        openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
      }
    }).catch((err) => {
      console.error('Failed to create session:', err);
    });
  }, [createSession, openPanel]);

  // Server mode handles its own auth — no local credential check needed
  const handleNewSession = useCallback((): void => {
    createSessionAndShow();
  }, [createSessionAndShow]);

  // Compute x offset for the 3-panel reel (percentage of container width)
  const activeTabIndex = TAB_KEYS.indexOf(activeTab);
  const reelOffsetPercent = (activeTabIndex >= 0 ? activeTabIndex : 0) * -33.333;

  return (
    <aside
      ref={ref}
      className="h-full flex flex-row border-r border-sidebar-border bg-sidebar overflow-hidden pt-[38px]"
      style={{
        width,
        transition: `width ${TRANSITIONS.sidebar}`,
      }}
    >
      {/* Icon Rail */}
      {!isCollapsed && <IconRail />}

      {/* Content Column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!isCollapsed && <WorktreeScopeBar />}
        {!isCollapsed && <ContextHeader onNewSession={handleNewSession} />}

        {/* Tab Content - Sliding Reel (3 panels) */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <motion.div
            className="flex h-full"
            style={{ width: '300%' }}
            animate={{ x: `${reelOffsetPercent}%` }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          >
            {/* Explorer Panel */}
            <div className="w-1/3 h-full overflow-hidden">
              <FileExplorer
                onFileOpen={onFileOpen}
                className={cn(
                  'h-full transition-opacity duration-150',
                  isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                )}
              />
            </div>
            {/* Sessions Panel */}
            <div className="w-1/3 h-full overflow-hidden">
              {!isCollapsed && (
                <SessionList
                  onSessionSelect={handleSessionSelect}
                  onNewSession={handleNewSession}
                  className="h-full"
                />
              )}
            </div>
            {/* Source Control Panel */}
            <div className="w-1/3 h-full overflow-hidden">
              {!isCollapsed && (
                <SourceControlPanel className="h-full" />
              )}
            </div>
          </motion.div>
        </div>
      </div>

    </aside>
  );
});
