/**
 * Workspace Store — manages workspace switching and recent directories
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { usePanelTabsStore } from './panelTabsStore';
import { useTerminalStore } from './terminalStore';
import { useGitStore } from './gitStore';
import { useUIStore } from './uiStore';
import { useFileExplorerStore } from './fileExplorerStore';
import { killTerminal } from '@/lib/tauri/terminal';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels/constants';

const MAX_RECENTS = 10;

interface WorkspaceState {
  recentDirectories: string[];
}

interface WorkspaceActions {
  addRecent: (path: string) => void;
  removeRecent: (path: string) => void;
  clearRecents: () => void;
  closeWorkspace: () => Promise<void>;
  switchWorkspace: (path: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  persist(
    immer((set, get) => ({
      recentDirectories: [],

      addRecent: (path: string) => {
        set((state) => {
          state.recentDirectories = [
            path,
            ...state.recentDirectories.filter((d) => d !== path),
          ].slice(0, MAX_RECENTS);
        });
      },

      removeRecent: (path: string) => {
        set((state) => {
          state.recentDirectories = state.recentDirectories.filter((d) => d !== path);
        });
      },

      clearRecents: () => {
        set((state) => {
          state.recentDirectories = [];
        });
      },

      closeWorkspace: async () => {
        // 1. Close non-agent panels (preserve agent tabs for session persistence)
        const panelState = usePanelTabsStore.getState();
        for (const [instanceId, instance] of panelState.instances) {
          if (instance.panelType !== BUILTIN_PANEL_TYPES.AGENT) {
            panelState.closePanel(instanceId);
          }
        }

        // 2. Kill all terminal PTYs and clear store
        const terminals = useTerminalStore.getState().terminals;
        const killPromises = Array.from(terminals.keys()).map((id) =>
          killTerminal(id).catch(console.error),
        );
        await Promise.all(killPromises);
        useTerminalStore.getState().closeAll();
        if (useUIStore.getState().terminalPanelOpen) {
          useUIStore.getState().toggleTerminalPanel();
        }

        // 3. Save active session context and archive bridge connections
        const { useAgentStore } = await import('./agentStore');
        const agentState = useAgentStore.getState();
        const currentRoot = useFileExplorerStore.getState().rootPath;
        if (currentRoot) {
          agentState.saveActiveSessionForWorkspace(currentRoot);
        }
        agentState.archiveAllSessions();

        // 4. Reset git state
        useGitStore.getState().reset();

        // 5. Close current folder (sets rootPath to null, stops file watcher)
        await useFileExplorerStore.getState().closeFolder();
      },

      switchWorkspace: async (path: string) => {
        // 1. Close non-agent panels (preserve agent tabs for session persistence)
        const panelState = usePanelTabsStore.getState();
        for (const [instanceId, instance] of panelState.instances) {
          if (instance.panelType !== BUILTIN_PANEL_TYPES.AGENT) {
            panelState.closePanel(instanceId);
          }
        }

        // 2. Kill all terminal PTYs and clear store
        const terminals = useTerminalStore.getState().terminals;
        const killPromises = Array.from(terminals.keys()).map((id) =>
          killTerminal(id).catch(console.error),
        );
        await Promise.all(killPromises);
        useTerminalStore.getState().closeAll();
        if (useUIStore.getState().terminalPanelOpen) {
          useUIStore.getState().toggleTerminalPanel();
        }

        // 3. Save active session context and archive bridge connections
        const { useAgentStore } = await import('./agentStore');
        const agentState = useAgentStore.getState();
        const currentRoot = useFileExplorerStore.getState().rootPath;
        if (currentRoot) {
          agentState.saveActiveSessionForWorkspace(currentRoot);
        }
        agentState.archiveAllSessions();

        // 4. Reset git state
        useGitStore.getState().reset();

        // 5. Close current folder and open new one
        await useFileExplorerStore.getState().closeFolder();
        await useFileExplorerStore.getState().setRootPath(path);

        // 5b. Restore active session for the new workspace
        agentState.restoreActiveSessionForWorkspace(path);

        // 6. Track in recents
        get().addRecent(path);

        // 7. Switch sidebar to AI chat tab (delayed so the sidebar mounts
        // at the default explorer tab first, then the spring reel animation
        // slides to sessions after the workspace fade-in completes)
        setTimeout(() => {
          useUIStore.getState().setActiveTab('sessions');
        }, 300);

        // 8. Re-detect git (startPolling does immediate fetch + sets up 5s interval)
        useGitStore.getState().startPolling();
      },
    })),
    {
      name: 'solo-workspaces',
      partialize: (state) => ({ recentDirectories: state.recentDirectories }),
    },
  ),
);
