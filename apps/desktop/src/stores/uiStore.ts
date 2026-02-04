/**
 * UI Store - Manages UI state like sidebar width and active tabs
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { SIDEBAR, TERMINAL_SECTION } from '@/lib/constants';

// Sidebar tab types
export type SidebarTab = 'explorer' | 'sessions';

// Settings tab types
export type SettingsTabId = 'general' | 'editor' | 'files' | 'shortcuts' | 'ai';

interface UIState {
  leftSidebarWidth: number;
  activeTab: SidebarTab;
  terminalPanelOpen: boolean;
  terminalPanelHeight: number;
  settingsOpen: boolean;
  settingsTab: SettingsTabId;
}

interface UIActions {
  toggleLeftSidebar: () => void;
  expandLeftSidebar: () => void;
  collapseLeftSidebar: () => void;
  setLeftSidebarWidth: (width: number) => void;
  setActiveTab: (tab: SidebarTab) => void;
  toggleTerminalPanel: () => void;
  setTerminalPanelHeight: (height: number) => void;
  openSettings: (tab?: SettingsTabId) => void;
  closeSettings: () => void;
  setSettingsTab: (tab: SettingsTabId) => void;
}

type UIStore = UIState & UIActions;

export const useUIStore = create<UIStore>()(
  immer((set) => ({
    leftSidebarWidth: SIDEBAR.expanded,
    activeTab: 'explorer' as SidebarTab,
    terminalPanelOpen: false,
    terminalPanelHeight: TERMINAL_SECTION.defaultHeight,
    settingsOpen: false,
    settingsTab: 'general' as SettingsTabId,

    toggleLeftSidebar: (): void => {
      set((state) => {
        state.leftSidebarWidth = state.leftSidebarWidth > SIDEBAR.collapsed
          ? SIDEBAR.collapsed
          : SIDEBAR.expanded;
      });
    },

    expandLeftSidebar: (): void => {
      set((state) => {
        state.leftSidebarWidth = SIDEBAR.expanded;
      });
    },

    collapseLeftSidebar: (): void => {
      set((state) => {
        state.leftSidebarWidth = SIDEBAR.collapsed;
      });
    },

    setLeftSidebarWidth: (width: number): void => {
      set((state) => {
        state.leftSidebarWidth = width;
      });
    },

    setActiveTab: (tab: SidebarTab): void => {
      set((state) => {
        state.activeTab = tab;
      });
    },

    toggleTerminalPanel: (): void => {
      set((state) => {
        state.terminalPanelOpen = !state.terminalPanelOpen;
      });
    },

    setTerminalPanelHeight: (height: number): void => {
      set((state) => {
        const dynamicMax = Math.min(
          TERMINAL_SECTION.maxHeight,
          Math.floor(window.innerHeight * 0.6),
        );
        state.terminalPanelHeight = Math.max(
          TERMINAL_SECTION.minHeight,
          Math.min(height, dynamicMax),
        );
      });
    },

    openSettings: (tab?: SettingsTabId): void => {
      set((state) => {
        state.settingsOpen = true;
        if (tab) state.settingsTab = tab;
      });
    },

    closeSettings: (): void => {
      set((state) => {
        state.settingsOpen = false;
      });
    },

    setSettingsTab: (tab: SettingsTabId): void => {
      set((state) => {
        state.settingsTab = tab;
      });
    },
  }))
);

// Selector hooks
export const useIsLeftSidebarCollapsed = (): boolean => {
  return useUIStore((state) => state.leftSidebarWidth <= SIDEBAR.collapsed);
};
