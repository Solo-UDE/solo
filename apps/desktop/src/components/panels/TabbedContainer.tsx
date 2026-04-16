/**
 * TabbedContainer - Container for a mosaic tile
 * Renders a TabBar and the active panel's content
 */

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { MosaicBranch } from 'react-mosaic-component';
import { MessageCircle } from 'lucide-react';
import { usePanelTabsStore, useTabsForTile, useActiveTabId } from '@/stores/panelTabsStore';
import { usePanelLayoutStore } from '@/stores/panelLayoutStore';
import { useAgentStore } from '@/stores/agentStore';
import { useProviderStore } from '@/stores/provider-store';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { TabBar } from './TabBar';
import { PanelWrapper } from './PanelWrapper';
import { TabContextMenu } from './TabContextMenu';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import type { TileId, PanelInstanceId } from '@/lib/panels/types';

interface ContextMenuState {
  position: { x: number; y: number } | null;
  instanceId: PanelInstanceId | null;
}

interface UnsavedDialogState {
  isOpen: boolean;
  instanceId: PanelInstanceId | null;
  title: string;
}

interface TabbedContainerProps {
  tileId: TileId;
  path: MosaicBranch[];
}

export function TabbedContainer({ tileId }: TabbedContainerProps) {
  // Get actions directly from store state to avoid selector issues
  // Actions are stable references that don't change
  const actions = useMemo(() => {
    const state = usePanelTabsStore.getState();
    return {
      initializeTile: state.initializeTile,
      setActiveTab: state.setActiveTab,
      closePanelInTile: state.closePanelInTile,
      reorderTabs: state.reorderTabs,
      moveTabToTile: state.moveTabToTile,
      closeAllInTile: state.closeAllInTile,
      closeOthersInTile: state.closeOthersInTile,
      setPinned: state.setPinned,
    };
  }, []);

  const {
    initializeTile,
    setActiveTab,
    closePanelInTile,
    reorderTabs,
    moveTabToTile,
    closeAllInTile,
    closeOthersInTile,
    setPinned,
  } = actions;

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    position: null,
    instanceId: null,
  });

  // Unsaved changes dialog state
  const [unsavedDialog, setUnsavedDialog] = useState<UnsavedDialogState>({
    isOpen: false,
    instanceId: null,
    title: '',
  });

  // Initialize tile state on mount (must be in useEffect, not during render)
  useEffect(() => {
    initializeTile(tileId);
  }, [initializeTile, tileId]);

  // Now get the tabs - these hooks subscribe to store changes
  const tabs = useTabsForTile(tileId);
  const activeTabId = useActiveTabId(tileId);

  // Get layout store actions
  const layoutActions = useMemo(() => {
    const state = usePanelLayoutStore.getState();
    return {
      setFocusedTile: state.setFocusedTile,
    };
  }, []);

  const { setFocusedTile } = layoutActions;

  // Handle tile focus (for keyboard navigation)
  const handleTileFocus = useCallback(() => {
    setFocusedTile(tileId);
  }, [setFocusedTile, tileId]);

  // Handle tab activation
  const handleTabActivate = useCallback(
    (instanceId: PanelInstanceId) => {
      setActiveTab(tileId, instanceId);
      setFocusedTile(tileId); // Also set focus when activating a tab
    },
    [setActiveTab, setFocusedTile, tileId]
  );

  // Handle tab close - check for dirty state first
  const handleTabClose = useCallback(
    (instanceId: PanelInstanceId) => {
      const instance = tabs.find((t) => t.id === instanceId);
      if (instance?.isDirty) {
        // Show unsaved changes dialog
        setUnsavedDialog({
          isOpen: true,
          instanceId,
          title: instance.title,
        });
      } else {
        closePanelInTile(instanceId, tileId);
      }
    },
    [tabs, closePanelInTile, tileId]
  );

  // Force close a tab (bypass dirty check)
  const forceCloseTab = useCallback(
    (instanceId: PanelInstanceId) => {
      closePanelInTile(instanceId, tileId);
    },
    [closePanelInTile, tileId]
  );

  // Handle tab reorder within the same tile
  const handleTabReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      reorderTabs(tileId, fromIndex, toIndex);
    },
    [reorderTabs, tileId]
  );

  // Handle tab drop from another tile
  const handleTabDrop = useCallback(
    (instanceId: PanelInstanceId, fromTileId: TileId) => {
      moveTabToTile(instanceId, fromTileId, tileId);
    },
    [moveTabToTile, tileId]
  );

  // Handle context menu open
  const handleContextMenu = useCallback(
    (e: MouseEvent, instanceId: PanelInstanceId) => {
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        instanceId,
      });
    },
    []
  );

  // Handle context menu close
  const handleContextMenuClose = useCallback(() => {
    setContextMenu({ position: null, instanceId: null });
  }, []);

  // Handle context menu actions
  const handleCloseTab = useCallback(() => {
    if (contextMenu.instanceId) {
      handleTabClose(contextMenu.instanceId);
    }
  }, [contextMenu.instanceId, handleTabClose]);

  const handleCloseOthers = useCallback(() => {
    if (contextMenu.instanceId) {
      closeOthersInTile(tileId, contextMenu.instanceId);
    }
  }, [contextMenu.instanceId, closeOthersInTile, tileId]);

  const handleCloseAll = useCallback(() => {
    closeAllInTile(tileId);
  }, [closeAllInTile, tileId]);

  const handleTogglePin = useCallback(() => {
    if (contextMenu.instanceId) {
      const instance = tabs.find((t) => t.id === contextMenu.instanceId);
      if (instance) {
        setPinned(contextMenu.instanceId, !instance.isPinned);
      }
    }
  }, [contextMenu.instanceId, tabs, setPinned]);

  // Get the current tab's pinned state for context menu
  const contextMenuTab = tabs.find((t) => t.id === contextMenu.instanceId);

  // Handle unsaved changes dialog actions
  const handleUnsavedDontSave = useCallback(() => {
    if (unsavedDialog.instanceId) {
      forceCloseTab(unsavedDialog.instanceId);
    }
    setUnsavedDialog({ isOpen: false, instanceId: null, title: '' });
  }, [unsavedDialog.instanceId, forceCloseTab]);

  const handleUnsavedCancel = useCallback(() => {
    setUnsavedDialog({ isOpen: false, instanceId: null, title: '' });
  }, []);

  return (
    <div
      className="h-full w-full flex flex-col bg-background overflow-hidden"
      onClick={handleTileFocus}
    >
      {/* Tab bar */}
      <TabBar
        tileId={tileId}
        tabs={tabs}
        activeTabId={activeTabId}
        onTabActivate={handleTabActivate}
        onTabClose={handleTabClose}
        onTabReorder={handleTabReorder}
        onTabDrop={handleTabDrop}
        onTabContextMenu={handleContextMenu}
      />

      {/* Context menu */}
      <TabContextMenu
        position={contextMenu.position}
        instanceId={contextMenu.instanceId}
        tileId={tileId}
        isPinned={contextMenuTab?.isPinned ?? false}
        tabCount={tabs.length}
        onClose={handleContextMenuClose}
        onCloseTab={handleCloseTab}
        onCloseOthers={handleCloseOthers}
        onCloseAll={handleCloseAll}
        onTogglePin={handleTogglePin}
      />

      {/* Unsaved changes dialog */}
      <UnsavedChangesDialog
        isOpen={unsavedDialog.isOpen}
        title={unsavedDialog.title}
        onDontSave={handleUnsavedDontSave}
        onCancel={handleUnsavedCancel}
      />

      {/* Panel content area */}
      <div className="flex-1 overflow-hidden">
        {tabs.length === 0 ? (
          <EmptyTile />
        ) : (
          // Render all panels but only show the active one
          // This preserves state when switching tabs
          tabs.map((tab) => (
            <PanelWrapper
              key={tab.id}
              instance={tab}
              isActive={tab.id === activeTabId}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * EmptyTile - Shown when a tile has no tabs
 */
function EmptyTile() {
  const openPanel = usePanelTabsStore((s) => s.openPanel);

  const handleNewChat = useCallback(async () => {
    try {
      const model = useProviderStore.getState().selectedModel || undefined;
      const sessionId = await useAgentStore.getState().createSession(model);
      if (sessionId) {
        openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [openPanel]);

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center space-y-3 animate-slide-up">
        <p className="text-muted-foreground text-sm">No panels open</p>
        <p className="text-muted-foreground/60 text-xs">Open a file from the explorer</p>
        <button
          onClick={handleNewChat}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-foreground bg-primary rounded-lg hover:brightness-110 active:scale-[0.97] transition-all duration-200"
        >
          <MessageCircle className="w-3.5 h-3.5" size={14} />
          New AI Chat
        </button>
      </div>
    </div>
  );
}
