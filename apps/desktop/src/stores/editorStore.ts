/**
 * Editor Store - Manages open tabs, dirty state, and editor settings
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

enableMapSet();

/**
 * Represents an open tab in the editor
 */
export interface EditorTab {
  /** File path (unique identifier) */
  path: string;
  /** Original content when file was loaded */
  originalContent: string;
  /** Current content in the editor */
  currentContent: string;
  /** Scroll position for restoration */
  scrollTop?: number;
  /** Cursor position for restoration */
  cursorPosition?: { line: number; col: number };
}

interface EditorState {
  /** Map of open tabs by path */
  tabs: Map<string, EditorTab>;
  /** Currently active tab path */
  activeTab: string | null;
  /** Ordered list of tab paths for display */
  tabOrder: string[];
}

interface EditorActions {
  /** Open a file in a new tab or focus existing tab */
  openTab: (path: string, content: string) => void;
  /** Close a tab */
  closeTab: (path: string) => void;
  /** Set the active tab */
  setActiveTab: (path: string | null) => void;
  /** Update content for a tab (marks as dirty if changed) */
  updateContent: (path: string, content: string) => void;
  /** Mark a tab as saved (content becomes original) */
  markSaved: (path: string) => void;
  /** Update scroll position for a tab */
  updateScrollPosition: (path: string, scrollTop: number) => void;
  /** Update cursor position for a tab */
  updateCursorPosition: (path: string, line: number, col: number) => void;
  /** Check if any tabs have unsaved changes */
  hasUnsavedChanges: () => boolean;
  /** Get all dirty tabs */
  getDirtyTabs: () => string[];
  /** Handle external file change - reload content if not dirty */
  handleExternalChange: (path: string, newContent: string) => void;
  /** Handle external file deletion */
  handleFileDeleted: (path: string) => void;
  /** Handle file rename */
  handleFileRenamed: (oldPath: string, newPath: string) => void;
  /** Close all tabs */
  closeAllTabs: () => void;
  /** Close all tabs except one */
  closeOtherTabs: (keepPath: string) => void;
}

type EditorStore = EditorState & EditorActions;

const initialState: EditorState = {
  tabs: new Map(),
  activeTab: null,
  tabOrder: [],
};

export const useEditorStore = create<EditorStore>()(
  immer((set, get) => ({
    ...initialState,

    openTab: (path: string, content: string) => {
      set((state) => {
        // If tab already exists, just make it active
        if (state.tabs.has(path)) {
          state.activeTab = path;
          return;
        }

        // Create new tab
        state.tabs.set(path, {
          path,
          originalContent: content,
          currentContent: content,
        });
        state.tabOrder.push(path);
        state.activeTab = path;
      });
    },

    closeTab: (path: string) => {
      set((state) => {
        const tabIndex = state.tabOrder.indexOf(path);
        if (tabIndex === -1) return;

        // Remove tab
        state.tabs.delete(path);
        state.tabOrder.splice(tabIndex, 1);

        // Update active tab if needed
        if (state.activeTab === path) {
          if (state.tabOrder.length === 0) {
            state.activeTab = null;
          } else {
            // Prefer tab to the right, then left
            const newIndex = Math.min(tabIndex, state.tabOrder.length - 1);
            state.activeTab = state.tabOrder[newIndex];
          }
        }
      });
    },

    setActiveTab: (path: string | null) => {
      set((state) => {
        // Always set activeTab - CodeEditor will load the file if needed
        state.activeTab = path;
      });
    },

    updateContent: (path: string, content: string) => {
      set((state) => {
        const tab = state.tabs.get(path);
        if (tab) {
          tab.currentContent = content;
        }
      });
    },

    markSaved: (path: string) => {
      set((state) => {
        const tab = state.tabs.get(path);
        if (tab) {
          tab.originalContent = tab.currentContent;
        }
      });
    },

    updateScrollPosition: (path: string, scrollTop: number) => {
      set((state) => {
        const tab = state.tabs.get(path);
        if (tab) {
          tab.scrollTop = scrollTop;
        }
      });
    },

    updateCursorPosition: (path: string, line: number, col: number) => {
      set((state) => {
        const tab = state.tabs.get(path);
        if (tab) {
          tab.cursorPosition = { line, col };
        }
      });
    },

    hasUnsavedChanges: () => {
      const state = get();
      for (const tab of state.tabs.values()) {
        if (tab.currentContent !== tab.originalContent) {
          return true;
        }
      }
      return false;
    },

    getDirtyTabs: () => {
      const state = get();
      const dirty: string[] = [];
      for (const tab of state.tabs.values()) {
        if (tab.currentContent !== tab.originalContent) {
          dirty.push(tab.path);
        }
      }
      return dirty;
    },

    handleExternalChange: (path: string, newContent: string) => {
      set((state) => {
        const tab = state.tabs.get(path);
        if (tab) {
          // Only auto-reload if file is not dirty
          if (tab.currentContent === tab.originalContent) {
            tab.originalContent = newContent;
            tab.currentContent = newContent;
          }
          // If dirty, we could show a conflict dialog (future enhancement)
        }
      });
    },

    handleFileDeleted: (path: string) => {
      // Close the tab if the file was deleted externally
      get().closeTab(path);
    },

    handleFileRenamed: (oldPath: string, newPath: string) => {
      set((state) => {
        const tab = state.tabs.get(oldPath);
        if (tab) {
          // Update path
          tab.path = newPath;

          // Move in the map
          state.tabs.delete(oldPath);
          state.tabs.set(newPath, tab);

          // Update tab order
          const index = state.tabOrder.indexOf(oldPath);
          if (index !== -1) {
            state.tabOrder[index] = newPath;
          }

          // Update active tab
          if (state.activeTab === oldPath) {
            state.activeTab = newPath;
          }
        }
      });
    },

    closeAllTabs: () => {
      set((state) => {
        state.tabs = new Map();
        state.tabOrder = [];
        state.activeTab = null;
      });
    },

    closeOtherTabs: (keepPath: string) => {
      set((state) => {
        const tabToKeep = state.tabs.get(keepPath);
        if (tabToKeep) {
          state.tabs = new Map([[keepPath, tabToKeep]]);
          state.tabOrder = [keepPath];
          state.activeTab = keepPath;
        } else {
          state.tabs = new Map();
          state.tabOrder = [];
          state.activeTab = null;
        }
      });
    },
  }))
);

/**
 * Check if a specific tab is dirty
 */
export function useIsTabDirty(path: string | null): boolean {
  return useEditorStore((state) => {
    if (!path) return false;
    const tab = state.tabs.get(path);
    if (!tab) return false;
    return tab.currentContent !== tab.originalContent;
  });
}

/**
 * Get a tab by path
 */
export function useTab(path: string | null): EditorTab | null {
  return useEditorStore((state) => {
    if (!path) return null;
    return state.tabs.get(path) ?? null;
  });
}

/**
 * Get the file name from a path
 */
export function getFileName(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
}
