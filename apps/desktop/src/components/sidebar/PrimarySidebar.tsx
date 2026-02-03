/**
 * PrimarySidebar - Main collapsible sidebar with tab navigation
 */

import { useState, useCallback, useMemo } from 'react';
import type { FC } from 'react';
import { FileExplorer } from '@/components/file-explorer';
import { SessionList, ApiKeyDialog } from '@/components/agent';
import { SidebarToggle } from './SidebarToggle';
import { TabGroup } from './TabButton';
import { TRANSITIONS } from '@/lib/constants';
import { useUIStore, useIsLeftSidebarCollapsed } from '@/stores/uiStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { useHasCredentials, useActiveProvider } from '@/stores/provider-store';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { cn } from '@/lib/utils';

interface PrimarySidebarProps {
  readonly width: number;
  readonly onFileOpen: (path: string) => void;
}

export const PrimarySidebar: FC<PrimarySidebarProps> = ({ width, onFileOpen }) => {
  const isCollapsed = useIsLeftSidebarCollapsed();
  const activeTab = useUIStore((state) => state.activeTab);
  const setActiveTab = useUIStore((state) => state.setActiveTab);
  const createSession = useAgentStore((state) => state.createSession);

  // Get store actions directly to avoid selector subscription issues
  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  // Provider/credentials state
  const activeProvider = useActiveProvider();
  const hasCredentials = useHasCredentials(activeProvider ?? 'anthropic');
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);

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

  const handleNewSession = useCallback((): void => {
    // Check if credentials exist before creating session
    if (!hasCredentials) {
      // Show API key dialog first
      setShowApiKeyDialog(true);
      return;
    }
    // Credentials exist, create session directly
    createSessionAndShow();
  }, [hasCredentials, createSessionAndShow]);

  const handleApiKeyDialogClose = useCallback((): void => {
    setShowApiKeyDialog(false);
  }, []);

  // Called after successful API key save
  const handleApiKeySaved = useCallback((): void => {
    setShowApiKeyDialog(false);
    // Small delay to ensure provider store is fully updated
    setTimeout(() => {
      createSessionAndShow();
    }, 100);
  }, [createSessionAndShow]);

  const tabs = ['Explorer', 'Sessions'] as const;
  const activeTabIndex = activeTab === 'explorer' ? 0 : 1;
  const handleTabChange = useCallback((index: number) => {
    setActiveTab(index === 0 ? 'explorer' : 'sessions');
  }, [setActiveTab]);

  return (
    <aside
      className="h-full flex flex-col border-r border-border/30 bg-sidebar overflow-hidden"
      style={{
        width,
        transition: `width ${TRANSITIONS.sidebar}`,
      }}
    >
      {/* Header with tabs and toggle */}
      <div className="h-10 flex items-center justify-between px-2 shrink-0 border-b border-border/30">
        {!isCollapsed && (
          <TabGroup
            tabs={tabs}
            activeIndex={activeTabIndex}
            onTabChange={handleTabChange}
          />
        )}
        <SidebarToggle className={isCollapsed ? 'mx-auto' : ''} />
      </div>

      {/* Tab Content - Sliding Reel */}
      <div className="flex-1 overflow-hidden">
        <div
          className="flex h-full transition-transform duration-300 ease-[cubic-bezier(0.18,1.14,0.5,1.18)]"
          style={{
            width: '200%',
            transform: activeTab === 'explorer' ? 'translateX(0%)' : 'translateX(-50%)',
          }}
        >
          {/* Explorer Panel */}
          <div className="w-1/2 h-full overflow-hidden">
            <FileExplorer
              onFileOpen={onFileOpen}
              className={cn(
                'h-full transition-opacity duration-150',
                isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
              )}
            />
          </div>
          {/* Sessions Panel */}
          <div className="w-1/2 h-full overflow-hidden">
            {!isCollapsed && (
              <SessionList
                onSessionSelect={handleSessionSelect}
                onNewSession={handleNewSession}
                className="h-full"
              />
            )}
          </div>
        </div>
      </div>

      {/* API Key Dialog for onboarding */}
      <ApiKeyDialog
        isOpen={showApiKeyDialog}
        onClose={handleApiKeyDialogClose}
        onSuccess={handleApiKeySaved}
        provider="anthropic"
      />
    </aside>
  );
};
