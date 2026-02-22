/**
 * Repo Store — manages multiple repositories in the sidebar
 * Each repo can be expanded to show its worktrees. Selecting a worktree
 * triggers a full context switch via workspaceStore + worktreeStore.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { WorktreeInfo } from '../bindings';
import * as worktreeApi from '../lib/tauri/worktree';
import * as fsApi from '../lib/tauri/fs';
import { gitGetStatus } from '../lib/tauri/git';

enableMapSet();

// Serialize refreshWorktrees calls to prevent workspace_root interleaving
let _refreshMutex: Promise<void> = Promise.resolve();

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _refreshMutex;
  let resolve: () => void;
  _refreshMutex = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

export interface RepoEntry {
  /** Absolute filesystem path to the repo root */
  path: string;
  /** Display name (last path segment) */
  name: string;
  /** Whether this repo's tree is expanded in the sidebar */
  isExpanded: boolean;
  /** Cached worktree list (loaded lazily on first expand) */
  worktrees: WorktreeInfo[];
  /** Current branch name */
  currentBranch: string;
  /** Whether worktrees have been loaded at least once */
  _worktreesLoaded: boolean;
}

interface RepoState {
  repos: Map<string, RepoEntry>;
  activeRepoPath: string | null;
  activeWorktreeId: string | null;
  /** Guards against concurrent context switches */
  _switchSeq: number;
}

interface RepoActions {
  addRepo: (path: string) => Promise<void>;
  removeRepo: (path: string) => void;
  toggleExpanded: (path: string) => Promise<void>;
  selectWorktree: (repoPath: string, worktreeId: string | null) => Promise<void>;
  refreshWorktrees: (repoPath: string) => Promise<void>;
  /** Restore active repo on startup */
  restoreActiveRepo: () => Promise<void>;
}

type RepoStore = RepoState & RepoActions;

export const useRepoStore = create<RepoStore>()(
  persist(
    immer((set, get) => ({
      repos: new Map(),
      activeRepoPath: null,
      activeWorktreeId: null,
      _switchSeq: 0,

      addRepo: async (path: string) => {
        if (get().repos.has(path)) return;

        const name = path.split('/').pop() ?? path;

        set((state) => {
          state.repos.set(path, {
            path,
            name,
            isExpanded: false,
            worktrees: [],
            currentBranch: '',
            _worktreesLoaded: false,
          });
        });

        // Auto-expand and activate the newly added repo
        await get().toggleExpanded(path);
        await get().selectWorktree(path, null);
      },

      removeRepo: (path: string) => {
        set((state) => {
          state.repos.delete(path);
          if (state.activeRepoPath === path) {
            state.activeRepoPath = null;
            state.activeWorktreeId = null;
          }
        });
      },

      toggleExpanded: async (path: string) => {
        const repo = get().repos.get(path);
        if (!repo) return;

        const willExpand = !repo.isExpanded;

        set((state) => {
          const entry = state.repos.get(path);
          if (entry) entry.isExpanded = willExpand;
        });

        // Lazy-load worktrees on first expand
        if (willExpand && !repo._worktreesLoaded) {
          await get().refreshWorktrees(path);
        }
      },

      refreshWorktrees: async (repoPath: string) => {
        await withRefreshLock(async () => {
          const currentActive = get().activeRepoPath;
          const needsSwitch = currentActive !== repoPath;

          try {
            // If this repo isn't the active workspace, we need to
            // temporarily switch to it to list worktrees
            if (needsSwitch) {
              await fsApi.setWorkspaceRoot(repoPath);
            }

            const [worktrees, status] = await Promise.all([
              worktreeApi.listWorktrees(),
              gitGetStatus().catch(() => null),
            ]);

            // Restore original workspace if we switched
            if (needsSwitch && currentActive) {
              await fsApi.setWorkspaceRoot(currentActive);
            }

            set((state) => {
              const entry = state.repos.get(repoPath);
              if (entry) {
                entry.worktrees = worktrees;
                entry.currentBranch = status?.current_branch ?? '';
                entry._worktreesLoaded = true;
              }
            });
          } catch (err) {
            console.error(`Failed to refresh worktrees for ${repoPath}:`, err);
            // Restore workspace on error too
            if (needsSwitch && currentActive) {
              await fsApi.setWorkspaceRoot(currentActive).catch(() => {});
            }
          }
        });
      },

      selectWorktree: async (repoPath: string, worktreeId: string | null) => {
        // Increment switch sequence to detect stale switches
        set((state) => { state._switchSeq += 1; });
        const seq = get()._switchSeq;

        const { useWorkspaceStore } = await import('./workspaceStore');
        const { useWorktreeStore } = await import('./worktreeStore');
        const { useUIStore } = await import('./uiStore');
        const { useFileExplorerStore } = await import('./fileExplorerStore');

        // 1. If switching repos, do a full workspace switch
        const currentRepo = get().activeRepoPath;

        if (currentRepo !== repoPath) {
          await useWorkspaceStore.getState().switchWorkspace(repoPath);
        } else {
          // Same repo — ensure rootPath is set (may be null after app restart)
          const currentRoot = useFileExplorerStore.getState().rootPath;
          if (!currentRoot) {
            await useFileExplorerStore.getState().setRootPath(repoPath);
          }
        }

        // Abort if a newer switch happened while we were awaiting
        if (get()._switchSeq !== seq) return;

        // 2. Activate the worktree (null = main workspace)
        try {
          if (worktreeId) {
            await useWorktreeStore.getState().setActive(worktreeId);
          } else if (useWorktreeStore.getState().activeWorktreeId !== null) {
            await useWorktreeStore.getState().setActive(null);
          }
        } catch (err) {
          console.error('Failed to set active worktree:', err);
        }

        if (get()._switchSeq !== seq) return;

        // 3. Update our state
        set((state) => {
          state.activeRepoPath = repoPath;
          state.activeWorktreeId = worktreeId;
        });

        // 4. Transition sidebar to worktree detail view
        useUIStore.getState().setSidebarView('worktree');

        // 5. Refresh the worktree list for the repo we just activated
        await get().refreshWorktrees(repoPath);
      },

      restoreActiveRepo: async () => {
        const { activeRepoPath, activeWorktreeId } = get();
        if (!activeRepoPath) return;

        // Validate the repo path still exists
        const repo = get().repos.get(activeRepoPath);
        if (!repo) {
          set((state) => {
            state.activeRepoPath = null;
            state.activeWorktreeId = null;
          });
          return;
        }

        await get().selectWorktree(activeRepoPath, activeWorktreeId);
      },
    })),
    {
      name: 'solo-repos',
      partialize: (state) => ({
        repos: Array.from(state.repos.entries()).map(([_path, entry]) => ({
          path: entry.path,
          name: entry.name,
          isExpanded: entry.isExpanded,
        })),
        activeRepoPath: state.activeRepoPath,
        activeWorktreeId: state.activeWorktreeId,
      }),
      merge: (persisted, current) => {
        const p = persisted as {
          repos?: { path: string; name: string; isExpanded: boolean }[];
          activeRepoPath?: string | null;
          activeWorktreeId?: string | null;
        };
        const repoMap = new Map<string, RepoEntry>();
        if (p?.repos) {
          for (const r of p.repos) {
            repoMap.set(r.path, {
              path: r.path,
              name: r.name,
              isExpanded: r.isExpanded,
              worktrees: [],
              currentBranch: '',
              _worktreesLoaded: false,
            });
          }
        }
        return {
          ...current,
          repos: repoMap,
          activeRepoPath: p?.activeRepoPath ?? null,
          activeWorktreeId: p?.activeWorktreeId ?? null,
        };
      },
    },
  ),
);

// Selectors
export const useRepoList = (): RepoEntry[] => {
  const repos = useRepoStore((state) => state.repos);
  return Array.from(repos.values());
};

export const useActiveRepo = (): RepoEntry | null => {
  const activeRepoPath = useRepoStore((state) => state.activeRepoPath);
  const repos = useRepoStore((state) => state.repos);
  if (!activeRepoPath) return null;
  return repos.get(activeRepoPath) ?? null;
};
