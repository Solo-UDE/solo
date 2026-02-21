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

const MAX_RECENTS = 10;

interface WorkspaceState {
  recentDirectories: string[];
}

interface WorkspaceActions {
  addRecent: (path: string) => void;
  removeRecent: (path: string) => void;
  clearRecents: () => void;
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

      switchWorkspace: async (path: string) => {
        // 1. Close all editor panels
        usePanelTabsStore.getState().closeAll();

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

        // 3. Reset agent sessions so new ones pick up the new workspace
        const { useAgentStore } = await import('./agentStore');
        const agentState = useAgentStore.getState();
        for (const sessionId of agentState.sessions.keys()) {
          agentState.deleteSession(sessionId);
        }

        // 4. Reset git state
        useGitStore.getState().reset();

        // 5. Close current folder and open new one
        useFileExplorerStore.getState().closeFolder();
        await useFileExplorerStore.getState().setRootPath(path);

        // 6. Track in recents
        get().addRecent(path);

        // 7. Re-detect git (startPolling does immediate fetch + sets up 5s interval)
        useGitStore.getState().startPolling();
      },
    })),
    {
      name: 'solo-workspaces',
      partialize: (state) => ({ recentDirectories: state.recentDirectories }),
    },
  ),
);
