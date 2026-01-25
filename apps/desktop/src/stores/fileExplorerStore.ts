/**
 * File Explorer Zustand Store
 * Manages file tree state, selection, and expansion
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { FileTreeEntry } from '../bindings';
import * as fs from '../lib/tauri/fs';

// Enable Map and Set support in Immer
enableMapSet();

interface FileTreeState {
  // Root workspace path
  rootPath: string | null;
  // Flat map of path -> entry for O(1) lookups
  entries: Map<string, FileTreeEntry>;
  // Set of expanded directory paths
  expanded: Set<string>;
  // Currently selected paths
  selected: Set<string>;
  // Path being renamed (if any)
  renamingPath: string | null;
  // Loading directories
  loading: Set<string>;
  // Error state
  error: string | null;
}

interface FileTreeActions {
  // Initialization
  openFolder: () => Promise<void>;
  setRootPath: (path: string) => Promise<void>;
  closeFolder: () => void;

  // Tree navigation
  expandDirectory: (path: string) => Promise<void>;
  collapseDirectory: (path: string) => void;
  toggleDirectory: (path: string) => Promise<void>;

  // Selection
  selectFile: (path: string, multi?: boolean) => void;
  clearSelection: () => void;

  // CRUD operations
  createFile: (parentPath: string, name: string) => Promise<void>;
  createDirectory: (parentPath: string, name: string) => Promise<void>;
  rename: (path: string, newName: string) => Promise<void>;
  delete: (paths: string[]) => Promise<void>;

  // Rename mode
  startRename: (path: string) => void;
  cancelRename: () => void;

  // File watcher events
  handleFileCreated: (path: string) => void;
  handleFileDeleted: (path: string) => void;
  handleFileChanged: (path: string) => void;
  handleFileRenamed: (oldPath: string, newPath: string) => void;

  // Error handling
  setError: (error: string | null) => void;
}

type FileExplorerStore = FileTreeState & FileTreeActions;

const initialState: FileTreeState = {
  rootPath: null,
  entries: new Map(),
  expanded: new Set(),
  selected: new Set(),
  renamingPath: null,
  loading: new Set(),
  error: null,
};

export const useFileExplorerStore = create<FileExplorerStore>()(
  immer((set, get) => ({
    ...initialState,

    openFolder: async () => {
      try {
        const path = await fs.openFolderDialog();
        if (path) {
          await get().setRootPath(path);
        }
      } catch (error) {
        console.error('Failed to open folder:', error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        set((state) => {
          state.error = `Failed to open folder: ${errorMsg}`;
        });
      }
    },

    setRootPath: async (path: string) => {
      try {
        // Set workspace root in backend
        await fs.setWorkspaceRoot(path);

        // Start watching for changes
        await fs.startWatching(path, true);

        // Read the root directory
        const response = await fs.readDirectory(path, 1);

        set((state) => {
          state.rootPath = path;
          state.entries = new Map();
          state.expanded = new Set([path]);
          state.selected = new Set();
          state.loading = new Set();
          state.error = null;

          // Add root entry
          state.entries.set(path, response.entry);

          // Add children entries
          if (response.entry.children) {
            for (const child of response.entry.children) {
              state.entries.set(child.path, child);
            }
          }
        });
      } catch (error) {
        set((state) => {
          state.error = `Failed to open folder: ${error}`;
        });
      }
    },

    closeFolder: () => {
      fs.stopWatching().catch(console.error);

      set((state) => {
        state.rootPath = null;
        state.entries = new Map();
        state.expanded = new Set();
        state.selected = new Set();
        state.loading = new Set();
        state.error = null;
      });
    },

    expandDirectory: async (path: string) => {
      const entry = get().entries.get(path);
      if (!entry || !entry.is_dir) return;

      // Already expanded with children loaded
      if (get().expanded.has(path) && entry.children !== null) return;

      set((state) => {
        state.loading.add(path);
      });

      try {
        const response = await fs.readDirectory(path, 1);

        set((state) => {
          state.expanded.add(path);
          state.loading.delete(path);

          // Update the directory entry with children
          const existingEntry = state.entries.get(path);
          if (existingEntry) {
            existingEntry.children = response.entry.children;
          }

          // Add children entries to the map
          if (response.entry.children) {
            for (const child of response.entry.children) {
              state.entries.set(child.path, child);
            }
          }
        });
      } catch (error) {
        set((state) => {
          state.loading.delete(path);
          state.error = `Failed to load directory: ${error}`;
        });
      }
    },

    collapseDirectory: (path: string) => {
      set((state) => {
        state.expanded.delete(path);
      });
    },

    toggleDirectory: async (path: string) => {
      if (get().expanded.has(path)) {
        get().collapseDirectory(path);
      } else {
        await get().expandDirectory(path);
      }
    },

    selectFile: (path: string, multi: boolean = false) => {
      set((state) => {
        if (multi) {
          if (state.selected.has(path)) {
            state.selected.delete(path);
          } else {
            state.selected.add(path);
          }
        } else {
          state.selected = new Set([path]);
        }
      });
    },

    clearSelection: () => {
      set((state) => {
        state.selected = new Set();
      });
    },

    createFile: async (parentPath: string, name: string) => {
      const path = `${parentPath}/${name}`;

      try {
        const entry = await fs.createFile(path);

        set((state) => {
          state.entries.set(path, entry);

          // Add to parent's children
          const parent = state.entries.get(parentPath);
          if (parent && parent.children) {
            parent.children.push(entry);
            // Sort children
            parent.children.sort((a, b) => {
              if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
              return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });
          }

          // Select the new file
          state.selected = new Set([path]);
        });
      } catch (error) {
        set((state) => {
          state.error = `Failed to create file: ${error}`;
        });
      }
    },

    createDirectory: async (parentPath: string, name: string) => {
      const path = `${parentPath}/${name}`;

      try {
        const entry = await fs.createDirectory(path);

        set((state) => {
          state.entries.set(path, entry);

          // Add to parent's children
          const parent = state.entries.get(parentPath);
          if (parent && parent.children) {
            parent.children.push(entry);
            // Sort children
            parent.children.sort((a, b) => {
              if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
              return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });
          }

          // Expand the new directory
          state.expanded.add(path);
          state.selected = new Set([path]);
        });
      } catch (error) {
        set((state) => {
          state.error = `Failed to create directory: ${error}`;
        });
      }
    },

    rename: async (path: string, newName: string) => {
      const entry = get().entries.get(path);
      if (!entry) return;

      const parentPath = path.substring(0, path.lastIndexOf('/'));
      const newPath = `${parentPath}/${newName}`;

      try {
        const updatedEntry = await fs.renameFile(path, newPath);

        set((state) => {
          // Remove old entry
          state.entries.delete(path);
          state.selected.delete(path);
          state.expanded.delete(path);

          // Add new entry
          state.entries.set(newPath, updatedEntry);
          state.selected.add(newPath);

          // Update parent's children
          const parent = state.entries.get(parentPath);
          if (parent && parent.children) {
            const index = parent.children.findIndex((c) => c.path === path);
            if (index !== -1) {
              parent.children[index] = updatedEntry;
              // Re-sort children
              parent.children.sort((a, b) => {
                if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
              });
            }
          }

          state.renamingPath = null;
        });
      } catch (error) {
        set((state) => {
          state.error = `Failed to rename: ${error}`;
          state.renamingPath = null;
        });
      }
    },

    delete: async (paths: string[]) => {
      try {
        for (const path of paths) {
          const entry = get().entries.get(path);
          await fs.deleteFile(path, entry?.is_dir ?? false);

          set((state) => {
            // Remove from entries
            state.entries.delete(path);
            state.selected.delete(path);
            state.expanded.delete(path);

            // Remove from parent's children
            const parentPath = path.substring(0, path.lastIndexOf('/'));
            const parent = state.entries.get(parentPath);
            if (parent && parent.children) {
              parent.children = parent.children.filter((c) => c.path !== path);
            }
          });
        }
      } catch (error) {
        set((state) => {
          state.error = `Failed to delete: ${error}`;
        });
      }
    },

    startRename: (path: string) => {
      set((state) => {
        state.renamingPath = path;
      });
    },

    cancelRename: () => {
      set((state) => {
        state.renamingPath = null;
      });
    },

    handleFileCreated: (path: string) => {
      // File was created externally - refresh parent directory
      const parentPath = path.substring(0, path.lastIndexOf('/'));
      const state = get();

      // Only refresh if parent is expanded
      if (state.expanded.has(parentPath)) {
        fs.readDirectory(parentPath, 1)
          .then((response) => {
            set((state) => {
              const parent = state.entries.get(parentPath);
              if (parent) {
                parent.children = response.entry.children;
              }

              // Add new children to entries map
              if (response.entry.children) {
                for (const child of response.entry.children) {
                  state.entries.set(child.path, child);
                }
              }
            });
          })
          .catch(console.error);
      }
    },

    handleFileDeleted: (path: string) => {
      set((state) => {
        // Remove from entries
        state.entries.delete(path);
        state.selected.delete(path);
        state.expanded.delete(path);

        // Remove from parent's children
        const parentPath = path.substring(0, path.lastIndexOf('/'));
        const parent = state.entries.get(parentPath);
        if (parent && parent.children) {
          parent.children = parent.children.filter((c) => c.path !== path);
        }
      });
    },

    handleFileChanged: (path: string) => {
      // File content changed - we might want to update metadata
      const entry = get().entries.get(path);
      if (entry && !entry.is_dir) {
        // Could refresh metadata here if needed
      }
    },

    handleFileRenamed: (oldPath: string, newPath: string) => {
      set((state) => {
        const entry = state.entries.get(oldPath);
        if (entry) {
          // Update the entry's path and name
          entry.path = newPath;
          entry.name = newPath.substring(newPath.lastIndexOf('/') + 1);

          // Move in the map
          state.entries.delete(oldPath);
          state.entries.set(newPath, entry);

          // Update selection
          if (state.selected.has(oldPath)) {
            state.selected.delete(oldPath);
            state.selected.add(newPath);
          }

          // Update expanded state
          if (state.expanded.has(oldPath)) {
            state.expanded.delete(oldPath);
            state.expanded.add(newPath);
          }
        }
      });
    },

    setError: (error: string | null) => {
      set((state) => {
        state.error = error;
      });
    },
  }))
);

// Selector for flattened tree items
export function useFlattenedTree() {
  // Subscribe to the entire store state to ensure we re-render on any change
  // This is necessary because Map/Set changes need special handling in Zustand
  const store = useFileExplorerStore();
  const { rootPath, entries, expanded } = store;

  if (!rootPath) return [];

  const result: Array<{ entry: FileTreeEntry; depth: number }> = [];

  function traverse(path: string, depth: number) {
    const entry = entries.get(path);
    if (!entry) return;

    result.push({ entry, depth });

    if (entry.is_dir && expanded.has(path) && entry.children) {
      for (const child of entry.children) {
        traverse(child.path, depth + 1);
      }
    }
  }

  traverse(rootPath, 0);

  return result;
}
