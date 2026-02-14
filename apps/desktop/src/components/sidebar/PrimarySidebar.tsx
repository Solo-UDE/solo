/**
 * PrimarySidebar - Main collapsible sidebar with tab navigation
 */

import { useState, useCallback, useMemo, forwardRef } from 'react';
import { FileExplorer } from '@/components/file-explorer';
import { SessionList, ApiKeyDialog } from '@/components/agent';
import { SourceControlPanel } from '@/components/source-control';
import { SidebarToggle } from './SidebarToggle';
import { TabGroup } from './TabButton';
import { TRANSITIONS } from '@/lib/constants';
import { useUIStore, useIsLeftSidebarCollapsed } from '@/stores/uiStore';
import type { SidebarTab } from '@/stores/uiStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { useHasCredentials, useActiveProvider } from '@/stores/provider-store';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { cn } from '@/lib/utils';

interface PrimarySidebarProps {
  readonly width: number;
  readonly onFileOpen: (path: string) => void;
}

const TAB_ORDER: SidebarTab[] = ['explorer', 'sessions', 'source-control'];
const TAB_LABELS = ['Explorer', 'Sessions', 'Source Control'] as const;

export const PrimarySidebar = forwardRef<HTMLElement, PrimarySidebarProps>(({ width, onFileOpen }, ref) => {
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

  const activeTabIndex = TAB_ORDER.indexOf(activeTab);
  const handleTabChange = useCallback((index: number) => {
    setActiveTab(TAB_ORDER[index]);
  }, [setActiveTab]);

  const translateX = activeTabIndex * (-100 / TAB_ORDER.length);

  return (
    <aside
      ref={ref}
      className="h-full flex flex-col border-r border-white/[0.06] bg-sidebar overflow-hidden pt-[38px]"
      style={{
        width,
        transition: `width ${TRANSITIONS.sidebar}`,
      }}
    >
      {/* Header with tabs and toggle */}
      <div className="h-10 flex items-center justify-between px-2 shrink-0 border-b border-border/30">
        {!isCollapsed && (
          <TabGroup
            tabs={TAB_LABELS}
            activeIndex={activeTabIndex >= 0 ? activeTabIndex : 0}
            onTabChange={handleTabChange}
          />
        )}
        <div className="flex items-center gap-0.5">
          <SidebarToggle className={isCollapsed ? 'mx-auto' : ''} />
        </div>
      </div>

      {/* Tab Content - Sliding Reel */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          className="flex h-full transition-transform duration-300 ease-[cubic-bezier(0.18,1.14,0.5,1.18)]"
          style={{
            width: `${TAB_ORDER.length * 100}%`,
            transform: `translateX(${translateX}%)`,
          }}
        >
          {/* Explorer Panel */}
          <div style={{ width: `${100 / TAB_ORDER.length}%` }} className="h-full overflow-hidden">
            <FileExplorer
              onFileOpen={onFileOpen}
              className={cn(
                'h-full transition-opacity duration-150',
                isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
              )}
            />
          </div>
          {/* Sessions Panel */}
          <div style={{ width: `${100 / TAB_ORDER.length}%` }} className="h-full overflow-hidden">
            {!isCollapsed && (
              <SessionList
                onSessionSelect={handleSessionSelect}
                onNewSession={handleNewSession}
                className="h-full"
              />
            )}
          </div>
          {/* Source Control Panel */}
          <div style={{ width: `${100 / TAB_ORDER.length}%` }} className="h-full overflow-hidden">
            {!isCollapsed && (
              <SourceControlPanel className="h-full" />
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
});
