/**
 * UI Store - Manages UI state like sidebar width and active tabs
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { SIDEBAR, TERMINAL_SECTION } from '@/lib/constants';

// Sidebar tab types
export type SidebarTab = 'explorer' | 'sessions' | 'source-control';

// Settings tab types
export type SettingsTabId = 'journey' | 'leaderboard' | 'general' | 'editor' | 'terminal' | 'files' | 'shortcuts' | 'ai' | 'voice' | 'skills' | 'plugins';

// Dev/Vault sidebar mode.
// Sessions moved out of the Vault tab (they're worktree-bound and live under Dev now).
// Automations + ContentCreation were deprecated during the Solo IDE redesign.
export type SidebarMode = 'dev' | 'vault';
export type DevSidebarView = 'worktree-list' | 'worktree-detail';
export type VaultNav =
  | 'skills'
  | 'memory'
  | 'tasks'
  | 'current-vault'
  | 'plugins'
  | 'connectors';

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
  vaultActiveNav: VaultNav;
  zoomLevel: number;
}

export const ZOOM = {
  min: 0.5,
  max: 2.5,
  step: 0.1,
  default: 1.0,
} as const;

const ZOOM_STORAGE_KEY = 'solo.zoomLevel';

function loadPersistedZoom(): number {
  if (typeof window === 'undefined') return ZOOM.default;
  const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
  if (!raw) return ZOOM.default;
  const n = Number(raw);
  if (!Number.isFinite(n)) return ZOOM.default;
  return Math.max(ZOOM.min, Math.min(ZOOM.max, n));
}

function clampZoom(n: number): number {
  // Round to one decimal to avoid floating-point drift across many step presses.
  const rounded = Math.round(n * 10) / 10;
  return Math.max(ZOOM.min, Math.min(ZOOM.max, rounded));
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
  setVaultNav: (nav: VaultNav) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setZoom: (level: number) => void;
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
    settingsTab: 'journey' as SettingsTabId,
    tourActive: false,
    tourStep: 0,
    sidebarMode: 'dev' as SidebarMode,
    devSidebarView: 'worktree-list' as DevSidebarView,
    devDetailWorktreeId: null,
    vaultActiveNav: 'memory' as VaultNav,
    zoomLevel: loadPersistedZoom(),

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

    setVaultNav: (nav: VaultNav): void => {
      set((state) => {
        state.vaultActiveNav = nav;
      });
    },

    zoomIn: (): void => {
      set((state) => {
        state.zoomLevel = clampZoom(state.zoomLevel + ZOOM.step);
      });
    },

    zoomOut: (): void => {
      set((state) => {
        state.zoomLevel = clampZoom(state.zoomLevel - ZOOM.step);
      });
    },

    resetZoom: (): void => {
      set((state) => {
        state.zoomLevel = ZOOM.default;
      });
    },

    setZoom: (level: number): void => {
      set((state) => {
        state.zoomLevel = clampZoom(level);
      });
    },
  }))
);

if (typeof window !== 'undefined') {
  useUIStore.subscribe((state, prev) => {
    if (state.zoomLevel !== prev.zoomLevel) {
      try {
        window.localStorage.setItem(ZOOM_STORAGE_KEY, String(state.zoomLevel));
      } catch {
        // localStorage may be unavailable (private mode, quota); zoom still works in-session.
      }
    }
  });
}

// Selector hooks
export const useIsLeftSidebarCollapsed = (): boolean => {
  return useUIStore((state) => state.leftSidebarWidth <= SIDEBAR.collapsed);
};
