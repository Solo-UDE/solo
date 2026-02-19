/**
 * GitHub Accounts Store — manages GitHub account and installation state
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { GitHubAccount, GitHubInstallation } from '@/lib/github-api';
import { getAuthenticatedUser, listInstallations } from '@/lib/github-api';

interface GitHubAccountsState {
  user: GitHubAccount | null;
  installations: GitHubInstallation[];
  selectedAccount: GitHubAccount | null;
  isLoading: boolean;
  error: string | null;
}

interface GitHubAccountsActions {
  fetchUser: (token: string) => Promise<void>;
  fetchInstallations: (token: string) => Promise<void>;
  setSelectedAccount: (account: GitHubAccount | null) => void;
  reset: () => void;
}

export const useGitHubAccountsStore = create<GitHubAccountsState & GitHubAccountsActions>()(
  immer((set) => ({
    user: null,
    installations: [],
    selectedAccount: null,
    isLoading: false,
    error: null,

    fetchUser: async (token: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const user = await getAuthenticatedUser(token);
        set((state) => {
          state.user = user;
          state.selectedAccount = user;
          state.isLoading = false;
        });
      } catch (err) {
        set((state) => {
          state.error = String(err);
          state.isLoading = false;
        });
      }
    },

    fetchInstallations: async (token: string) => {
      try {
        const installations = await listInstallations(token);
        set((state) => {
          state.installations = installations;
        });
      } catch (err) {
        console.error('Failed to fetch installations:', err);
      }
    },

    setSelectedAccount: (account: GitHubAccount | null) => {
      set((state) => {
        state.selectedAccount = account;
      });
    },

    reset: () => {
      set((state) => {
        state.user = null;
        state.installations = [];
        state.selectedAccount = null;
        state.isLoading = false;
        state.error = null;
      });
    },
  })),
);
