/**
 * useSidebarActions - Shared sidebar actions for session and file operations.
 * Extracted from PrimarySidebar so both DevSidebar and StudioSidebar can reuse.
 */

import { useCallback, useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';

export function useSidebarActions() {
  const createSession = useAgentStore((s) => s.createSession);
  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  /** Open an existing session tab or create a new panel for it */
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

  /** Create a new agent session and open it in a panel */
  const handleNewSession = useCallback((): void => {
    createSession().then((sessionId) => {
      if (sessionId) {
        openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
      }
    }).catch((err: unknown) => {
      console.error('Failed to create session:', err);
    });
  }, [createSession, openPanel]);

  /** Open a file in the editor panel */
  const handleFileOpen = useCallback((path: string) => {
    const fileName = path.split('/').pop() ?? 'Untitled';
    openPanel(BUILTIN_PANEL_TYPES.FILE_VIEWER, { filePath: path, fileName });
  }, [openPanel]);

  return { handleSessionSelect, handleNewSession, handleFileOpen };
}
