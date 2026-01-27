/**
 * UI Store - Manages UI state like sidebar width and active tabs
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { SIDEBAR } from '@/lib/constants';

// Sidebar tab types
export type SidebarTab = 'explorer' | 'sessions';

// Main panel content types
export type MainPanelType = 'file' | 'agent' | 'empty';

interface UIState {
  leftSidebarWidth: number;
  activeTab: SidebarTab;
  mainPanelType: MainPanelType;
}

interface UIActions {
  toggleLeftSidebar: () => void;
  expandLeftSidebar: () => void;
  collapseLeftSidebar: () => void;
  setActiveTab: (tab: SidebarTab) => void;
  setMainPanelType: (type: MainPanelType) => void;
}

type UIStore = UIState & UIActions;

export const useUIStore = create<UIStore>()(
  immer((set) => ({
    leftSidebarWidth: SIDEBAR.expanded,
    activeTab: 'explorer' as SidebarTab,
    mainPanelType: 'empty' as MainPanelType,

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

    setActiveTab: (tab: SidebarTab): void => {
      set((state) => {
        state.activeTab = tab;
      });
    },

    setMainPanelType: (type: MainPanelType): void => {
      set((state) => {
        state.mainPanelType = type;
      });
    },
  }))
);

// Selector hooks
export const useIsLeftSidebarCollapsed = (): boolean => {
  return useUIStore((state) => state.leftSidebarWidth <= SIDEBAR.collapsed);
};
