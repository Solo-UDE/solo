/**
 * UI Store - Manages UI state like sidebar width and active tabs
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { SIDEBAR, TERMINAL_SECTION } from '@/lib/constants';

// Sidebar tab types
export type SidebarTab = 'explorer' | 'sessions' | 'source-control';

// Settings tab types
export type SettingsTabId = 'general' | 'editor' | 'terminal' | 'files' | 'shortcuts' | 'ai' | 'voice';

// Dev/Studio sidebar mode
export type SidebarMode = 'dev' | 'studio';
export type DevSidebarView = 'worktree-list' | 'worktree-detail';
export type StudioNav = 'sessions' | 'vault' | 'automations' | 'content-creation';

interface UIState {
  leftSidebarWidth: number;
  _previousSidebarWidth: number;
  activeTab: SidebarTab;
  railExpanded: boolean;
  terminalPanelOpen: boolean;
  terminalPanelHeight: number;
  settingsOpen: boolean;
  settingsTab: SettingsTabId;
  tourActive: boolean;
  tourStep: number;
  sidebarMode: SidebarMode;
  devSidebarView: DevSidebarView;
  devDetailWorktreeId: string | null;
  studioActiveNav: StudioNav;
}

interface UIActions {
  toggleLeftSidebar: () => void;
  expandLeftSidebar: () => void;
  collapseLeftSidebar: () => void;
  setLeftSidebarWidth: (width: number) => void;
  setActiveTab: (tab: SidebarTab) => void;
  toggleRailExpanded: () => void;
  setRailExpanded: (expanded: boolean) => void;
  toggleTerminalPanel: () => void;
  setTerminalPanelHeight: (height: number) => void;
  openSettings: (tab?: SettingsTabId) => void;
  closeSettings: () => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  startTour: () => void;
  nextTourStep: () => void;
  prevTourStep: () => void;
  endTour: () => void;
  setSidebarMode: (mode: SidebarMode) => void;
  drillIntoWorktree: (worktreeId: string) => void;
  drillOutOfWorktree: () => void;
  setStudioNav: (nav: StudioNav) => void;
}

type UIStore = UIState & UIActions;

export const useUIStore = create<UIStore>()(
  immer((set) => ({
    leftSidebarWidth: SIDEBAR.expanded,
    _previousSidebarWidth: SIDEBAR.expanded,
    activeTab: 'explorer' as SidebarTab,
    railExpanded: false,
    terminalPanelOpen: false,
    terminalPanelHeight: TERMINAL_SECTION.defaultHeight,
    settingsOpen: false,
    settingsTab: 'general' as SettingsTabId,
    tourActive: false,
    tourStep: 0,
    sidebarMode: 'dev' as SidebarMode,
    devSidebarView: 'worktree-list' as DevSidebarView,
    devDetailWorktreeId: null,
    studioActiveNav: 'sessions' as StudioNav,

    toggleLeftSidebar: (): void => {
      set((state) => {
        if (state.leftSidebarWidth > SIDEBAR.collapsed) {
          state._previousSidebarWidth = state.leftSidebarWidth;
          state.leftSidebarWidth = SIDEBAR.collapsed;
        } else {
          state.leftSidebarWidth = state._previousSidebarWidth;
        }
      });
    },

    expandLeftSidebar: (): void => {
      set((state) => {
        state.leftSidebarWidth = state._previousSidebarWidth;
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
        if (width > SIDEBAR.collapsed) {
          state._previousSidebarWidth = width;
        }
      });
    },

    setActiveTab: (tab: SidebarTab): void => {
      set((state) => {
        state.activeTab = tab;
      });
    },

    toggleRailExpanded: (): void => {
      set((state) => {
        state.railExpanded = !state.railExpanded;
      });
    },

    setRailExpanded: (expanded: boolean): void => {
      set((state) => {
        state.railExpanded = expanded;
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

    startTour: (): void => {
      set((state) => {
        state.tourActive = true;
        state.tourStep = 0;
      });
    },

    nextTourStep: (): void => {
      set((state) => {
        state.tourStep += 1;
      });
    },

    prevTourStep: (): void => {
      set((state) => {
        if (state.tourStep > 0) {
          state.tourStep -= 1;
        }
      });
    },

    endTour: (): void => {
      set((state) => {
        state.tourActive = false;
        state.tourStep = 0;
      });
    },

    setSidebarMode: (mode: SidebarMode): void => {
      set((state) => {
        state.sidebarMode = mode;
      });
    },

    drillIntoWorktree: (worktreeId: string): void => {
      set((state) => {
        state.devSidebarView = 'worktree-detail';
        state.devDetailWorktreeId = worktreeId;
      });
    },

    drillOutOfWorktree: (): void => {
      set((state) => {
        state.devSidebarView = 'worktree-list';
        state.devDetailWorktreeId = null;
      });
    },

    setStudioNav: (nav: StudioNav): void => {
      set((state) => {
        state.studioActiveNav = nav;
      });
    },
  }))
);

// Selector hooks
export const useIsLeftSidebarCollapsed = (): boolean => {
  return useUIStore((state) => state.leftSidebarWidth <= SIDEBAR.collapsed);
};
