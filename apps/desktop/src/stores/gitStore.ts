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
} from '@/lib/tauri/git';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import type { GitRepoStatus } from '@/bindings/GitRepoStatus';
import type { GitChangedFile } from '@/bindings/GitChangedFile';
import type { GitChangesSummary } from '@/bindings/GitChangesSummary';

interface GitState {
  // Repository status
  repoStatus: GitRepoStatus | null;
  changedFiles: GitChangedFile[];
  changesSummary: GitChangesSummary | null;
  commitsAhead: number | null;

  // Operation flags
  isCommitting: boolean;
  isPushing: boolean;
  isPulling: boolean;
  isDiscarding: boolean;
  isCreatingBranch: boolean;
  isLoading: boolean;

  // User input
  commitMessage: string;
  currentBranch: string;
  githubRepoUrl: string;

  // Polling
  pollIntervalId: ReturnType<typeof setInterval> | null;
}

interface GitActions {
  fetchRepoStatus: () => Promise<void>;
  fetchChanges: () => Promise<void>;
  commit: (commitMessage: string) => Promise<void>;
  push: (accessToken: string) => Promise<void>;
  pull: (accessToken: string, forceReset?: boolean) => Promise<void>;
  discardFile: (filePath: string) => Promise<void>;
  discardAll: () => Promise<void>;
  stageFile: (filePath: string) => Promise<void>;
  unstageFile: (filePath: string) => Promise<void>;
  stageAllFiles: () => Promise<void>;
  unstageAllFiles: () => Promise<void>;
  createBranch: (name: string) => Promise<void>;
  setCommitMessage: (message: string) => void;
  setCurrentBranch: (branch: string) => void;
  setGithubRepoUrl: (url: string) => void;
  startPolling: () => void;
  stopPolling: () => void;
  reset: () => void;
}

const POLL_INTERVAL = 5000;

export const useGitStore = create<GitState & GitActions>()(
  immer((set, get) => ({
    // Initial state
    repoStatus: null,
    changedFiles: [],
    changesSummary: null,
    commitsAhead: null,
    isCommitting: false,
    isPushing: false,
    isPulling: false,
    isDiscarding: false,
    isCreatingBranch: false,
    isLoading: false,
    commitMessage: '',
    currentBranch: 'main',
    githubRepoUrl: '',
    pollIntervalId: null,

    fetchRepoStatus: async () => {
      // Skip when no workspace is open
      if (!useFileExplorerStore.getState().rootPath) return;
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
      try {
        set((state) => { state.isLoading = true; });
        const { currentBranch } = get();
        const result = await gitGetChanges(currentBranch);
        set((state) => {
          state.changedFiles = result.files;
          state.changesSummary = result.summary;
          state.isLoading = false;
        });
      } catch (err) {
        console.error('Failed to fetch changes:', err);
        set((state) => { state.isLoading = false; });
      }
    },

    commit: async (commitMessage: string) => {
      set((state) => { state.isCommitting = true; });
      try {
        await gitCommit(commitMessage);
        set((state) => {
          state.isCommitting = false;
          state.commitMessage = '';
        });
        await get().fetchChanges();
        await get().fetchRepoStatus();
      } catch (err) {
        set((state) => { state.isCommitting = false; });
        throw err;
      }
    },

    push: async (accessToken: string) => {
      const { currentBranch, githubRepoUrl } = get();
      if (!githubRepoUrl) return;

      set((state) => { state.isPushing = true; });
      try {
        await gitPush(accessToken, githubRepoUrl, currentBranch);
        set((state) => { state.isPushing = false; });
        // Refresh after push
        await get().fetchChanges();
        await get().fetchRepoStatus();
      } catch (err) {
        set((state) => { state.isPushing = false; });
        throw err;
      }
    },

    pull: async (accessToken: string, forceReset?: boolean) => {
      const { currentBranch, githubRepoUrl } = get();
      if (!githubRepoUrl) return;

      set((state) => { state.isPulling = true; });
      try {
        await gitPull(accessToken, githubRepoUrl, currentBranch, forceReset ?? false);
        set((state) => { state.isPulling = false; });
        // Refresh after pull
        await get().fetchChanges();
        await get().fetchRepoStatus();
      } catch (err) {
        set((state) => { state.isPulling = false; });
        throw err;
      }
    },

    discardFile: async (filePath: string) => {
      const { currentBranch } = get();
      set((state) => { state.isDiscarding = true; });
      try {
        await gitDiscardFile(filePath, currentBranch);
        set((state) => { state.isDiscarding = false; });
        await get().fetchChanges();
      } catch (err) {
        set((state) => { state.isDiscarding = false; });
        throw err;
      }
    },

    discardAll: async () => {
      const { currentBranch } = get();
      set((state) => { state.isDiscarding = true; });
      try {
        await gitDiscardAll(currentBranch);
        set((state) => { state.isDiscarding = false; });
        await get().fetchChanges();
      } catch (err) {
        set((state) => { state.isDiscarding = false; });
        throw err;
      }
    },

    stageFile: async (filePath: string) => {
      try {
        await gitStageFile(filePath);
        await get().fetchChanges();
      } catch (err) {
        console.error('Failed to stage file:', err);
        throw err;
      }
    },

    unstageFile: async (filePath: string) => {
      try {
        await gitUnstageFile(filePath);
        await get().fetchChanges();
      } catch (err) {
        console.error('Failed to unstage file:', err);
        throw err;
      }
    },

    stageAllFiles: async () => {
      try {
        await gitStageAll();
        await get().fetchChanges();
      } catch (err) {
        console.error('Failed to stage all files:', err);
        throw err;
      }
    },

    unstageAllFiles: async () => {
      try {
        await gitUnstageAll();
        await get().fetchChanges();
      } catch (err) {
        console.error('Failed to unstage all files:', err);
        throw err;
      }
    },

    createBranch: async (name: string) => {
      set((state) => { state.isCreatingBranch = true; });
      try {
        await gitCreateBranch(name);
        set((state) => { state.isCreatingBranch = false; });
        await get().fetchRepoStatus();
        await get().fetchChanges();
      } catch (err) {
        set((state) => { state.isCreatingBranch = false; });
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

      // Fetch immediately
      get().fetchRepoStatus();
      get().fetchChanges();

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
        state.isCommitting = false;
        state.isPushing = false;
        state.isPulling = false;
        state.isDiscarding = false;
        state.isCreatingBranch = false;
        state.isLoading = false;
        state.commitMessage = '';
        state.currentBranch = 'main';
        state.githubRepoUrl = '';
        state.pollIntervalId = null;
      });
    },
  })),
);
