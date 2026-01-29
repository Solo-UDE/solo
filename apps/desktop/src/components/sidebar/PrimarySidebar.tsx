/**
 * PrimarySidebar - Main collapsible sidebar with tab navigation
 * Works alongside the ActivityBar for view switching
 */

import { useState, useCallback, useMemo } from 'react';
import type { FC } from 'react';
import { FileExplorer } from '@/components/file-explorer';
import { SessionList, ApiKeyDialog } from '@/components/agent';
import { TRANSITIONS } from '@/lib/constants';
import { useUIStore } from '@/stores/uiStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { useHasCredentials, useActiveProvider } from '@/stores/provider-store';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';

interface PrimarySidebarProps {
  readonly width: number;
  readonly onFileOpen: (path: string) => void;
}

export const PrimarySidebar: FC<PrimarySidebarProps> = ({ width, onFileOpen }) => {
  const activeTab = useUIStore((state) => state.activeTab);
  const setActiveSession = useAgentStore((state) => state.setActiveSession);
  const createSession = useAgentStore((state) => state.createSession);

  // Get openPanel action directly from store to avoid selector subscription issues
  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  // Provider/credentials state
  const activeProvider = useActiveProvider();
  const hasCredentials = useHasCredentials(activeProvider ?? 'anthropic');
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);

  // Check if sidebar is collapsed (width is 0 or near 0)
  const isCollapsed = width <= 40;

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

  // Don't render if collapsed
  if (isCollapsed) {
    return null;
  }

  return (
    <aside
      className="h-full flex flex-col bg-bg-surface-1 overflow-hidden"
      style={{
        width,
        transition: `width ${TRANSITIONS.sidebar}`,
      }}
    >
      {/* Section header */}
      <div className="h-9 flex items-center px-3 shrink-0 border-b border-border-subtle">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {activeTab === 'explorer' ? 'Explorer' : 'Sessions'}
        </span>
      </div>

      {/* Tab Content - Sliding Reel */}
      <div className="flex-1 overflow-hidden">
        <div
          className="flex h-full transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{
            width: '200%',
            transform: activeTab === 'explorer' ? 'translateX(0%)' : 'translateX(-50%)',
          }}
        >
          {/* Explorer Panel */}
          <div className="w-1/2 h-full overflow-hidden">
            <FileExplorer
              onFileOpen={onFileOpen}
              className="h-full"
            />
          </div>
          {/* Sessions Panel */}
          <div className="w-1/2 h-full overflow-hidden">
            <SessionList
              onSessionSelect={handleSessionSelect}
              onNewSession={handleNewSession}
              className="h-full"
            />
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
