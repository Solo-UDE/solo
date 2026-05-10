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
import { pickRandomIcon, pickRandomColor } from '../lib/repoIdentity';
import { settleAfterPaint, trace } from '../lib/perf';
import type { RepoIconName, RepoColorName } from '../lib/repoIdentity';

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
  /** Count of worktrees with uncommitted changes */
  dirtyWorktreeCount: number;
  /** Whether any worktree has an active agent session */
  hasActiveAgent: boolean;
  /** Cached commits ahead (persisted when switching away) */
  cachedCommitsAhead: number;
  /** Cached commits behind (persisted when switching away) */
  cachedCommitsBehind: number;
  /** Phosphor icon name for visual identity */
  icon: RepoIconName;
  /** Color token for visual identity */
  color: RepoColorName;
}

interface RepoState {
  repos: Map<string, RepoEntry>;
  activeRepoPath: string | null;
  activeWorktreeId: string | null;
  /** True while a repo/worktree context switch is in flight */
  isSwitching: boolean;
  /** Guards against concurrent context switches */
  _switchSeq: number;
}

interface RepoActions {
  addRepo: (path: string) => Promise<void>;
  removeRepo: (path: string) => void;
  toggleExpanded: (path: string) => Promise<void>;
  selectWorktree: (repoPath: string, worktreeId: string | null) => Promise<void>;
  refreshWorktrees: (repoPath: string) => Promise<void>;
  /** Recompute health fields from worktrees array */
  syncRepoHealth: (repoPath: string) => void;
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
      isSwitching: false,
      _switchSeq: 0,

      addRepo: async (path: string) => {
        if (get().repos.has(path)) return;

        const name = path.split('/').pop() ?? path;

        // Pick unique icon + color, avoiding duplicates where possible
        const existingRepos = Array.from(get().repos.values());
        const usedIcons = existingRepos.map((r) => r.icon).filter(Boolean);
        const usedColors = existingRepos.map((r) => r.color).filter(Boolean);
        const icon = pickRandomIcon(usedIcons);
        const color = pickRandomColor(usedColors);

        set((state) => {
          state.repos.set(path, {
            path,
            name,
            isExpanded: false,
            worktrees: [],
            currentBranch: '',
            _worktreesLoaded: false,
            dirtyWorktreeCount: 0,
            hasActiveAgent: false,
            cachedCommitsAhead: 0,
            cachedCommitsBehind: 0,
            icon,
            color,
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
          const { useFileExplorerStore } = await import('./fileExplorerStore');
          const currentRoot = useFileExplorerStore.getState().rootPath;
          const needsSwitch = currentActive !== repoPath;
          const needsRootBootstrap = currentActive === repoPath && !currentRoot;

          try {
            // If this repo isn't the active workspace, we need to
            // temporarily switch to it to list worktrees
            // On app startup, activeRepoPath is persisted but the Tauri
            // workspace root is not, so bootstrap it before listing.
            if (needsSwitch || needsRootBootstrap) {
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

            // Recompute health from the fresh worktree list
            get().syncRepoHealth(repoPath);
          } catch (err) {
            console.error(`Failed to refresh worktrees for ${repoPath}:`, err);
            // Restore workspace on error too
            if (needsSwitch && currentActive) {
              await fsApi.setWorkspaceRoot(currentActive).catch(() => {});
            }
          }
        });
      },

      syncRepoHealth: (repoPath: string) => {
        set((state) => {
          const entry = state.repos.get(repoPath);
          if (!entry) return;
          entry.dirtyWorktreeCount = entry.worktrees.filter((wt) => wt.is_dirty).length;
          entry.hasActiveAgent = entry.worktrees.some((wt) => wt.agent_session_id != null);
        });
      },

      selectWorktree: async (repoPath: string, worktreeId: string | null) => {
        const repo = get().repos.get(repoPath);
        const previousActiveRepoPath = get().activeRepoPath;
        const perf = trace('repo.worktree.switch', `${repo?.name ?? repoPath}:${worktreeId ?? 'main'}`);

        // Increment switch sequence and expose the target immediately so the
        // sidebar can repaint from cached repo/worktree metadata.
        set((state) => {
          state._switchSeq += 1;
          state.isSwitching = true;
          if (state.activeRepoPath && state.activeRepoPath !== repoPath) {
            const prevEntry = state.repos.get(state.activeRepoPath);
            if (prevEntry) prevEntry.isExpanded = false;
          }
          state.activeRepoPath = repoPath;
          state.activeWorktreeId = worktreeId;
          const entry = state.repos.get(repoPath);
          if (entry) entry.isExpanded = true;
        });
        perf.endHandler();
        const seq = get()._switchSeq;

        const settle = () => {
          if (get()._switchSeq === seq) {
            set((state) => { state.isSwitching = false; });
          }
          settleAfterPaint(perf);
        };
        const isStale = () => {
          if (get()._switchSeq === seq) return false;
          settleAfterPaint(perf);
          return true;
        };

        try {
          const { useWorkspaceStore } = await import('./workspaceStore');
          const { useWorktreeStore } = await import('./worktreeStore');
          const { useFileExplorerStore } = await import('./fileExplorerStore');

          // 1. If switching repos, do a light workspace switch.
          const previousRepo = previousActiveRepoPath === repoPath ? null : previousActiveRepoPath;
          const currentRoot = useFileExplorerStore.getState().rootPath;

          if (previousActiveRepoPath !== repoPath) {
            const { useGitStore } = await import('./gitStore');

            // Cache git stats for the repo we're leaving
            if (previousRepo) {
              try {
                const gitState = useGitStore.getState();
                set((state) => {
                  const entry = state.repos.get(previousRepo);
                  if (entry) {
                    entry.cachedCommitsAhead = gitState.commitsAhead ?? 0;
                  }
                });
              } catch {
                // Non-critical - just skip caching
              }
            }

            useGitStore.getState().reset();
            await fsApi.stopWatching().catch(console.error);
            if (isStale()) return;

            await useFileExplorerStore.getState().setRootPath(repoPath);
            if (isStale()) return;

            useWorkspaceStore.getState().addRecent(repoPath);
            useGitStore.getState().startPolling();
          } else if (!currentRoot) {
            await useFileExplorerStore.getState().setRootPath(repoPath);
          }

          if (isStale()) return;

          // 2. Activate the worktree (null = main workspace). The worktree
          // store updates active state synchronously and refreshes roots from
          // cache before backend confirmation.
          let effectiveWorktreeId = worktreeId;
          try {
            if (worktreeId) {
              await useWorktreeStore.getState().setActive(worktreeId);
            } else if (useWorktreeStore.getState().activeWorktreeId !== null) {
              await useWorktreeStore.getState().setActive(null);
            }
          } catch (err) {
            console.error('Failed to set active worktree:', err);
            effectiveWorktreeId = useWorktreeStore.getState().activeWorktreeId;
          }

          if (isStale()) return;

          set((state) => {
            state.activeRepoPath = repoPath;
            state.activeWorktreeId = effectiveWorktreeId;
            const entry = state.repos.get(repoPath);
            if (entry) entry.isExpanded = true;
          });

          // 3. Worktree metadata refresh is no longer on the interaction hot path.
          settle();
          void get().refreshWorktrees(repoPath).finally(() => {
            if (get()._switchSeq === seq) settleAfterPaint(perf);
          });
        } catch (error) {
          console.error('Failed to switch worktree:', error);
          settle();
          throw error;
        }
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
          cachedCommitsAhead: entry.cachedCommitsAhead,
          cachedCommitsBehind: entry.cachedCommitsBehind,
          icon: entry.icon,
          color: entry.color,
        })),
        activeRepoPath: state.activeRepoPath,
        activeWorktreeId: state.activeWorktreeId,
      }),
      merge: (persisted, current) => {
        const p = persisted as {
          repos?: { path: string; name: string; isExpanded: boolean; cachedCommitsAhead?: number; cachedCommitsBehind?: number; icon?: RepoIconName; color?: RepoColorName }[];
          activeRepoPath?: string | null;
          activeWorktreeId?: string | null;
        };
        const repoMap = new Map<string, RepoEntry>();
        const usedIcons: string[] = [];
        const usedColors: string[] = [];
        if (p?.repos) {
          for (const r of p.repos) {
            // Assign identity if missing (migration from old persisted data)
            const icon = r.icon ?? pickRandomIcon(usedIcons);
            const color = r.color ?? pickRandomColor(usedColors);
            usedIcons.push(icon);
            usedColors.push(color);
            repoMap.set(r.path, {
              path: r.path,
              name: r.name,
              isExpanded: r.isExpanded,
              worktrees: [],
              currentBranch: '',
              _worktreesLoaded: false,
              dirtyWorktreeCount: 0,
              hasActiveAgent: false,
              cachedCommitsAhead: r.cachedCommitsAhead ?? 0,
              cachedCommitsBehind: r.cachedCommitsBehind ?? 0,
              icon,
              color,
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
