/**
 * Editor Store - Manages open tabs, dirty state, and editor settings
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

enableMapSet();

/**
 * Represents an open tab in the editor
 */
export type MarkdownMode = 'off' | 'split' | 'rendered' | 'raw';

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
  /** Total line count in the document */
  lineCount?: number;
  /** Markdown mode: off (editor only), split, rendered, raw */
  markdownMode?: MarkdownMode;
  /** Split pane position (0-100 percentage) */
  markdownSplitPosition?: number;
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
  /** Update line count for a tab */
  updateLineCount: (path: string, lineCount: number) => void;
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
  /** Cycle markdown mode: off → split → rendered → raw → off */
  cycleMarkdownMode: (path: string) => void;
  /** Set markdown split position for a tab */
  setMarkdownSplitPosition: (path: string, position: number) => void;
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

    updateLineCount: (path: string, lineCount: number) => {
      set((state) => {
        const tab = state.tabs.get(path);
        if (tab) {
          tab.lineCount = lineCount;
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

    cycleMarkdownMode: (path: string) => {
      set((state) => {
        const tab = state.tabs.get(path);
        if (!tab) return;
        const current = tab.markdownMode ?? 'off';
        const cycle: Record<MarkdownMode, MarkdownMode> = {
          off: 'split',
          split: 'rendered',
          rendered: 'raw',
          raw: 'off',
        };
        tab.markdownMode = cycle[current];
        if (tab.markdownSplitPosition === undefined) {
          tab.markdownSplitPosition = 50;
        }
      });
    },

    setMarkdownSplitPosition: (path: string, position: number) => {
      set((state) => {
        const tab = state.tabs.get(path);
        if (tab) {
          tab.markdownSplitPosition = Math.max(20, Math.min(80, position));
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

/**
 * Get language display name from file extension
 */
export function getLanguageName(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript React',
    js: 'JavaScript',
    jsx: 'JavaScript React',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    rs: 'Rust',
    py: 'Python',
    pyw: 'Python',
    pyi: 'Python',
    json: 'JSON',
    jsonc: 'JSON with Comments',
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    md: 'Markdown',
    markdown: 'Markdown',
    toml: 'TOML',
    yaml: 'YAML',
    yml: 'YAML',
    xml: 'XML',
    sql: 'SQL',
    sh: 'Shell',
    bash: 'Bash',
    zsh: 'Zsh',
  };
  return langMap[ext] ?? 'Plain Text';
}

const DEFAULT_TAB_STATUS_CURSOR = { line: 1, col: 1 };

/**
 * Hook to get active tab status info for the status bar
 * Uses useShallow for stable object references
 */
export function useActiveTabStatus() {
  return useEditorStore(
    useShallow((state) => {
      if (!state.activeTab) return null;
      const tab = state.tabs.get(state.activeTab);
      if (!tab) return null;

      return {
        path: tab.path,
        isDirty: tab.currentContent !== tab.originalContent,
        cursorPosition: tab.cursorPosition ?? DEFAULT_TAB_STATUS_CURSOR,
        lineCount: tab.lineCount ?? 0,
        language: getLanguageName(tab.path),
      };
    })
  );
}

/**
 * Check if a file is a markdown file based on extension
 */
export function isMarkdownFile(path: string | null): boolean {
  if (!path) return false;
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'md' || ext === 'markdown';
}

/**
 * Get markdown preview state for a tab
 */
export function useMarkdownPreview(path: string | null) {
  return useEditorStore(
    useShallow((state) => {
      if (!path) return { enabled: false, splitPosition: 50, mode: 'off' as MarkdownMode };
      const tab = state.tabs.get(path);
      if (!tab) return { enabled: false, splitPosition: 50, mode: 'off' as MarkdownMode };
      const mode = tab.markdownMode ?? 'off';
      return {
        enabled: mode !== 'off',
        splitPosition: tab.markdownSplitPosition ?? 50,
        mode,
      };
    })
  );
}
