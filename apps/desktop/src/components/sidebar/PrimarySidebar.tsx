/**
 * PrimarySidebar - Main collapsible sidebar with tab navigation
 */

import { useState, useCallback, useMemo } from 'react';
import type { FC } from 'react';
import { FileExplorer } from '@/components/file-explorer';
import { SessionList, ApiKeyDialog } from '@/components/agent';
import { SidebarToggle } from './SidebarToggle';
import { TabButton } from './TabButton';
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
  const setActiveSession = useAgentStore((state) => state.setActiveSession);
  const createSession = useAgentStore((state) => state.createSession);

  // Get openPanel action directly from store to avoid selector subscription issues
  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  // Provider/credentials state
  const activeProvider = useActiveProvider();
  const hasCredentials = useHasCredentials(activeProvider ?? 'anthropic');
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);

  // Open a session as a tab in the panel system
  const handleSessionSelect = useCallback((sessionId: string): void => {
    setActiveSession(sessionId);
    openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
  }, [setActiveSession, openPanel]);

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

  return (
    <aside
      className="h-full flex flex-col border-r border-border/30 bg-sidebar overflow-hidden"
      style={{
        width,
        transition: `width ${TRANSITIONS.sidebar}`,
      }}
    >
      {/* Header with toggle */}
      <div className="h-10 flex items-center justify-between px-2 shrink-0 border-b border-border/30">
        {!isCollapsed && (
          <span className="text-sm font-medium text-muted-foreground ml-1">Explorer</span>
        )}
        <SidebarToggle className={isCollapsed ? 'mx-auto' : ''} />
      </div>

      {/* Tab Navigation - hidden when collapsed */}
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 shrink-0 overflow-hidden transition-all duration-150',
          isCollapsed ? 'h-0 opacity-0' : 'h-10 opacity-100'
        )}
      >
        <TabButton
          label="Explorer"
          active={activeTab === 'explorer'}
          onClick={() => setActiveTab('explorer')}
        />
        <TabButton
          label="Sessions"
          active={activeTab === 'sessions'}
          onClick={() => setActiveTab('sessions')}
        />
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'explorer' && (
          <FileExplorer
            onFileOpen={onFileOpen}
            className={cn(
              'h-full transition-opacity duration-150',
              isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
            )}
          />
        )}
        {activeTab === 'sessions' && !isCollapsed && (
          <SessionList
            onSessionSelect={handleSessionSelect}
            onNewSession={handleNewSession}
            className="h-full"
          />
        )}
      </div>

      {/* API Key Dialog for onboarding */}
      <ApiKeyDialog
        isOpen={showApiKeyDialog}
        onClose={handleApiKeyDialogClose}
        onSuccess={handleApiKeySaved}
        provider="Anthropic"
      />
    </aside>
  );
};
