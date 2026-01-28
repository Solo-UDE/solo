/**
 * UI Store - Manages UI state like sidebar width and active tabs
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { SIDEBAR } from '@/lib/constants';

// Sidebar tab types
export type SidebarTab = 'explorer' | 'sessions';

interface UIState {
  leftSidebarWidth: number;
  activeTab: SidebarTab;
}

interface UIActions {
  toggleLeftSidebar: () => void;
  expandLeftSidebar: () => void;
  collapseLeftSidebar: () => void;
  setLeftSidebarWidth: (width: number) => void;
  setActiveTab: (tab: SidebarTab) => void;
}

type UIStore = UIState & UIActions;

export const useUIStore = create<UIStore>()(
  immer((set) => ({
    leftSidebarWidth: SIDEBAR.expanded,
    activeTab: 'explorer' as SidebarTab,

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
  }))
);

// Selector hooks
export const useIsLeftSidebarCollapsed = (): boolean => {
  return useUIStore((state) => state.leftSidebarWidth <= SIDEBAR.collapsed);
};
