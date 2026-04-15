/**
 * Git Store — manages git state for the source control sidebar
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  gitGetStatus,
  gitGetChanges,
  gitCommit,
  gitPush,
  gitPull,
  gitDiscardFile,
  gitDiscardAll,
  gitStageFile,
  gitUnstageFile,
  gitStageAll,
  gitUnstageAll,
  gitCreateBranch,
  gitFetch,
  gitListBranches,
  gitCheckoutBranch,
  gitDeleteBranch,
  gitMerge,
  gitStash,
  gitStashPop,
  gitStashList,
  githubGetToken,
} from '@/lib/tauri/git';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { useWorktreeStore } from '@/stores/worktreeStore';
import type { GitRepoStatus } from '@/bindings/GitRepoStatus';
import type { GitChangedFile } from '@/bindings/GitChangedFile';
import type { GitChangesSummary } from '@/bindings/GitChangesSummary';
import type { BranchInfo } from '@/bindings/BranchInfo';
import type { StashEntry } from '@/bindings/StashEntry';
import type { GitMergeResult } from '@/bindings/GitMergeResult';
import type { GitStashPopResult } from '@/bindings/GitStashPopResult';

interface GitState {
  // Repository status
  repoStatus: GitRepoStatus | null;
  changedFiles: GitChangedFile[];
  changesSummary: GitChangesSummary | null;
  commitsAhead: number | null;

  // Branch & stash data
  branches: BranchInfo[];
  stashEntries: StashEntry[];

  // Operation flags
  isCommitting: boolean;
  isPushing: boolean;
  isPulling: boolean;
  isFetching: boolean;
  isDiscarding: boolean;
  isCreatingBranch: boolean;
  isCheckingOut: boolean;
  isMerging: boolean;
  isStashing: boolean;
  isGeneratingMessage: boolean;
  isLoading: boolean;

  // User input
  commitMessage: string;
  currentBranch: string;
  githubRepoUrl: string;

  // Polling
  pollIntervalId: ReturnType<typeof setInterval> | null;

  // Concurrency guards
  _pendingOps: number;
  _fetchSeq: number;
}

interface GitActions {
  fetchRepoStatus: () => Promise<void>;
  fetchChanges: () => Promise<void>;
  commit: (commitMessage: string) => Promise<void>;
  push: () => Promise<void>;
  pull: (forceReset?: boolean) => Promise<void>;
  fetch: () => Promise<void>;
  discardFile: (filePath: string) => Promise<void>;
  discardAll: () => Promise<void>;
  stageFile: (filePath: string) => Promise<void>;
  unstageFile: (filePath: string) => Promise<void>;
  stageAllFiles: () => Promise<void>;
  unstageAllFiles: () => Promise<void>;
  createBranch: (name: string) => Promise<void>;
  listBranches: () => Promise<void>;
  checkoutBranch: (name: string) => Promise<void>;
  deleteBranch: (name: string, force?: boolean) => Promise<void>;
  merge: (sourceBranch: string) => Promise<GitMergeResult>;
  stash: (message?: string) => Promise<void>;
  stashPop: () => Promise<GitStashPopResult>;
  stashList: () => Promise<void>;
  generateCommitMessage: () => Promise<void>;
  setCommitMessage: (message: string) => void;
  setCurrentBranch: (branch: string) => void;
  setGithubRepoUrl: (url: string) => void;
  startPolling: () => void;
  stopPolling: () => void;
  reset: () => void;
}

const POLL_INTERVAL = 5000;

// Tracks worktrees we've already warned about, so we don't spam the console once per poll tick.
const _warnedMissingWorktrees = new Set<string>();

/**
 * Returns true if the active worktree's directory is gone from disk — in which case
 * downstream git ops would fail with "could not find repository" / "No such file or directory".
 * Polling code uses this to early-exit gracefully instead of spamming console errors.
 */
function shouldSkipForMissingWorktree(): boolean {
  const wtState = useWorktreeStore.getState();
  const activeId = wtState.activeWorktreeId;
  if (!activeId) return false; // main workspace; assume fs root presence is enforced elsewhere
  const wt = wtState.worktrees.get(activeId);
  if (wt && wt.exists_on_disk === false) {
    if (!_warnedMissingWorktrees.has(activeId)) {
      _warnedMissingWorktrees.add(activeId);
      console.warn(
        `[gitStore] Skipping git ops: worktree "${activeId}" is missing on disk. ` +
          'Refresh or prune to clean up.',
      );
    }
    return true;
  }
  // If the worktree came back, allow future warnings.
  _warnedMissingWorktrees.delete(activeId);
  return false;
}

export const useGitStore = create<GitState & GitActions>()(
  immer((set, get) => ({
    // Initial state
    repoStatus: null,
    changedFiles: [],
    changesSummary: null,
    commitsAhead: null,
    branches: [],
    stashEntries: [],
    isCommitting: false,
    isPushing: false,
    isPulling: false,
    isFetching: false,
    isDiscarding: false,
    isCreatingBranch: false,
    isCheckingOut: false,
    isMerging: false,
    isStashing: false,
    isGeneratingMessage: false,
    isLoading: false,
    commitMessage: '',
    currentBranch: 'main',
    githubRepoUrl: '',
    pollIntervalId: null,
    _pendingOps: 0,
    _fetchSeq: 0,

    fetchRepoStatus: async () => {
      // Skip when no workspace is open
      if (!useFileExplorerStore.getState().rootPath) return;
      // Skip when active worktree's directory is gone — prevents poll-loop console spam
      if (shouldSkipForMissingWorktree()) return;
      try {
        const status = await gitGetStatus();
        set((state) => {
          state.repoStatus = status;
          state.commitsAhead = status.commits_ahead;
          if (status.current_branch) {
            state.currentBranch = status.current_branch;
          }
          if (status.remote_url) {
            state.githubRepoUrl = status.remote_url;
          }
        });
      } catch (err) {
        console.error('Failed to fetch repo status:', err);
      }
    },

    fetchChanges: async () => {
      // Skip when no workspace is open
      if (!useFileExplorerStore.getState().rootPath) return;
      // Skip while mutating operations are in flight (prevents poll clobbering)
      if (get()._pendingOps > 0) return;
      // Skip when active worktree's directory is gone
      if (shouldSkipForMissingWorktree()) return;

      const seq = get()._fetchSeq;
      try {
        set((state) => { state.isLoading = true; });
        const { currentBranch } = get();
        const result = await gitGetChanges(currentBranch);
        // Discard stale response (worktree switched while fetch was in-flight)
        if (get()._fetchSeq !== seq) return;
        set((state) => {
          state.changedFiles = result.files;
          state.changesSummary = result.summary;
          state.isLoading = false;
        });
      } catch (err) {
        if (get()._fetchSeq !== seq) return;
        console.error('Failed to fetch changes:', err);
        set((state) => { state.isLoading = false; });
      }
    },

    commit: async (commitMessage: string) => {
      set((state) => { state.isCommitting = true; state._pendingOps += 1; });
      try {
        await gitCommit(commitMessage);
        set((state) => {
          state.isCommitting = false;
          state.commitMessage = '';
        });
      } catch (err) {
        set((state) => { state.isCommitting = false; });
        throw err;
      } finally {
        set((state) => { state._pendingOps -= 1; });
      }
      await get().fetchChanges();
      await get().fetchRepoStatus();
    },

    push: async () => {
      const { currentBranch, githubRepoUrl } = get();
      if (!githubRepoUrl) return;

      const accessToken = await githubGetToken();
      if (!accessToken) throw new Error('Not connected to GitHub. Please connect first.');

      set((state) => { state.isPushing = true; });
      try {
        await gitPush(accessToken, githubRepoUrl, currentBranch);
        set((state) => { state.isPushing = false; });
        await get().fetchChanges();
        await get().fetchRepoStatus();
      } catch (err) {
        set((state) => { state.isPushing = false; });
        throw err;
      }
    },

    pull: async (forceReset?: boolean) => {
      const { currentBranch, githubRepoUrl } = get();
      if (!githubRepoUrl) return;

      const accessToken = await githubGetToken();
      if (!accessToken) throw new Error('Not connected to GitHub. Please connect first.');

      set((state) => { state.isPulling = true; });
      try {
        await gitPull(accessToken, githubRepoUrl, currentBranch, forceReset ?? false);
        set((state) => { state.isPulling = false; });
        await get().fetchChanges();
        await get().fetchRepoStatus();
      } catch (err) {
        set((state) => { state.isPulling = false; });
        throw err;
      }
    },

    discardFile: async (filePath: string) => {
      const { currentBranch } = get();
      set((state) => { state.isDiscarding = true; state._pendingOps += 1; });
      try {
        await gitDiscardFile(filePath, currentBranch);
        set((state) => { state.isDiscarding = false; });
      } catch (err) {
        set((state) => { state.isDiscarding = false; });
        throw err;
      } finally {
        set((state) => { state._pendingOps -= 1; });
      }
      await get().fetchChanges();
    },

    discardAll: async () => {
      const { currentBranch } = get();
      set((state) => { state.isDiscarding = true; state._pendingOps += 1; });
      try {
        await gitDiscardAll(currentBranch);
        set((state) => { state.isDiscarding = false; });
      } catch (err) {
        set((state) => { state.isDiscarding = false; });
        throw err;
      } finally {
        set((state) => { state._pendingOps -= 1; });
      }
      await get().fetchChanges();
    },

    stageFile: async (filePath: string) => {
      set((state) => { state._pendingOps += 1; });
      try {
        await gitStageFile(filePath);
      } catch (err) {
        console.error('Failed to stage file:', err);
        throw err;
      } finally {
        set((state) => { state._pendingOps -= 1; });
      }
      await get().fetchChanges();
    },

    unstageFile: async (filePath: string) => {
      set((state) => { state._pendingOps += 1; });
      try {
        await gitUnstageFile(filePath);
      } catch (err) {
        console.error('Failed to unstage file:', err);
        throw err;
      } finally {
        set((state) => { state._pendingOps -= 1; });
      }
      await get().fetchChanges();
    },

    stageAllFiles: async () => {
      set((state) => { state._pendingOps += 1; });
      try {
        await gitStageAll();
      } catch (err) {
        console.error('Failed to stage all files:', err);
        throw err;
      } finally {
        set((state) => { state._pendingOps -= 1; });
      }
      await get().fetchChanges();
    },

    unstageAllFiles: async () => {
      set((state) => { state._pendingOps += 1; });
      try {
        await gitUnstageAll();
      } catch (err) {
        console.error('Failed to unstage all files:', err);
        throw err;
      } finally {
        set((state) => { state._pendingOps -= 1; });
      }
      await get().fetchChanges();
    },

    createBranch: async (name: string) => {
      set((state) => { state.isCreatingBranch = true; });
      try {
        await gitCreateBranch(name);
        set((state) => { state.isCreatingBranch = false; });
        await get().fetchRepoStatus();
        await get().fetchChanges();
        await get().listBranches();
      } catch (err) {
        set((state) => { state.isCreatingBranch = false; });
        throw err;
      }
    },

    fetch: async () => {
      const { currentBranch, githubRepoUrl } = get();
      if (!githubRepoUrl) return;

      const accessToken = await githubGetToken();
      if (!accessToken) throw new Error('Not connected to GitHub. Please connect first.');

      set((state) => { state.isFetching = true; });
      try {
        await gitFetch(accessToken, githubRepoUrl, currentBranch);
        set((state) => { state.isFetching = false; });
        await get().fetchRepoStatus();
        await get().listBranches();
      } catch (err) {
        set((state) => { state.isFetching = false; });
        throw err;
      }
    },

    listBranches: async () => {
      if (shouldSkipForMissingWorktree()) return;
      try {
        const branches = await gitListBranches();
        set((state) => { state.branches = branches; });
      } catch (err) {
        console.error('Failed to list branches:', err);
      }
    },

    checkoutBranch: async (name: string) => {
      set((state) => { state.isCheckingOut = true; });
      try {
        await gitCheckoutBranch(name);
        set((state) => { state.isCheckingOut = false; });
        await get().fetchRepoStatus();
        await get().fetchChanges();
        await get().listBranches();
      } catch (err) {
        set((state) => { state.isCheckingOut = false; });
        throw err;
      }
    },

    deleteBranch: async (name: string, force?: boolean) => {
      try {
        await gitDeleteBranch(name, force ?? false);
        await get().listBranches();
      } catch (err) {
        throw err;
      }
    },

    merge: async (sourceBranch: string) => {
      set((state) => { state.isMerging = true; });
      try {
        const result = await gitMerge(sourceBranch);
        set((state) => { state.isMerging = false; });
        await get().fetchRepoStatus();
        await get().fetchChanges();
        await get().listBranches();
        return result;
      } catch (err) {
        set((state) => { state.isMerging = false; });
        throw err;
      }
    },

    stash: async (message?: string) => {
      set((state) => { state.isStashing = true; });
      try {
        await gitStash(message, true);
        set((state) => { state.isStashing = false; });
        await get().fetchChanges();
        await get().stashList();
      } catch (err) {
        set((state) => { state.isStashing = false; });
        throw err;
      }
    },

    stashPop: async () => {
      set((state) => { state.isStashing = true; });
      try {
        const result = await gitStashPop();
        set((state) => { state.isStashing = false; });
        await get().fetchChanges();
        await get().stashList();
        return result;
      } catch (err) {
        set((state) => { state.isStashing = false; });
        throw err;
      }
    },

    stashList: async () => {
      if (shouldSkipForMissingWorktree()) return;
      try {
        const entries = await gitStashList();
        set((state) => { state.stashEntries = entries; });
      } catch (err) {
        console.error('Failed to list stashes:', err);
      }
    },

    generateCommitMessage: async () => {
      set((state) => { state.isGeneratingMessage = true; });
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const message = await invoke<string>('agent_generate_commit_message');
        set((state) => {
          state.commitMessage = message;
          state.isGeneratingMessage = false;
        });
      } catch (err) {
        set((state) => { state.isGeneratingMessage = false; });
        throw err;
      }
    },

    setCommitMessage: (message: string) => {
      set((state) => { state.commitMessage = message; });
    },

    setCurrentBranch: (branch: string) => {
      set((state) => { state.currentBranch = branch; });
    },

    setGithubRepoUrl: (url: string) => {
      set((state) => { state.githubRepoUrl = url; });
    },

    startPolling: () => {
      const { pollIntervalId } = get();
      if (pollIntervalId) return;

      // Invalidate any stale in-flight fetches from previous context
      set((state) => { state._fetchSeq += 1; });

      // Fetch immediately
      get().fetchRepoStatus();
      get().fetchChanges();
      get().listBranches();
      get().stashList();

      const id = setInterval(() => {
        get().fetchRepoStatus();
        get().fetchChanges();
      }, POLL_INTERVAL);

      set((state) => { state.pollIntervalId = id; });
    },

    stopPolling: () => {
      const { pollIntervalId } = get();
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        set((state) => { state.pollIntervalId = null; });
      }
    },

    reset: () => {
      const { pollIntervalId } = get();
      if (pollIntervalId) clearInterval(pollIntervalId);

      set((state) => {
        state.repoStatus = null;
        state.changedFiles = [];
        state.changesSummary = null;
        state.commitsAhead = null;
        state.branches = [];
        state.stashEntries = [];
        state.isCommitting = false;
        state.isPushing = false;
        state.isPulling = false;
        state.isFetching = false;
        state.isDiscarding = false;
        state.isCreatingBranch = false;
        state.isCheckingOut = false;
        state.isMerging = false;
        state.isStashing = false;
        state.isGeneratingMessage = false;
        state.isLoading = false;
        state.commitMessage = '';
        state.currentBranch = 'main';
        state.githubRepoUrl = '';
        state.pollIntervalId = null;
        state._pendingOps = 0;
        state._fetchSeq += 1; // Invalidate any in-flight fetches
      });
    },
  })),
);
