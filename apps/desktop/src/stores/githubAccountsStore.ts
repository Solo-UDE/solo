/**
 * GitHub Accounts Store — manages GitHub account, token, and installation state.
 *
 * Uses direct GitHub OAuth (not Supabase) for git operations.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { GitHubAccount, GitHubInstallation } from '@/lib/github-api';
import { getAuthenticatedUser, listInstallations } from '@/lib/github-api';
import {
  githubStartAuth,
  githubCompleteAuth,
  githubGetToken,
  githubDisconnect,
} from '@/lib/tauri/git';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

interface GitHubAccountsState {
  user: GitHubAccount | null;
  installations: GitHubInstallation[];
  selectedAccount: GitHubAccount | null;
  isLoading: boolean;
  error: string | null;
  /** GitHub access token for git operations (null = not connected) */
  token: string | null;
  /** Whether a connect flow is in progress */
  isConnecting: boolean;
}

interface GitHubAccountsActions {
  fetchUser: (token: string) => Promise<void>;
  fetchInstallations: (token: string) => Promise<void>;
  setSelectedAccount: (account: GitHubAccount | null) => void;
  /** Load persisted token from keychain on app startup */
  loadToken: () => Promise<void>;
  /** Start the GitHub OAuth flow (opens browser, waits for callback) */
  connectGitHub: () => Promise<void>;
  /** Disconnect GitHub and clear token */
  disconnectGitHub: () => Promise<void>;
  reset: () => void;
}

export const useGitHubAccountsStore = create<GitHubAccountsState & GitHubAccountsActions>()(
  immer((set, get) => ({
    user: null,
    installations: [],
    selectedAccount: null,
    isLoading: false,
    error: null,
    token: null,
    isConnecting: false,

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

    loadToken: async () => {
      try {
        const token = await githubGetToken();
        if (token) {
          set((state) => {
            state.token = token;
          });
          // Fetch user info with the stored token
          await get().fetchUser(token);
        }
      } catch (err) {
        console.error('Failed to load GitHub token:', err);
      }
    },

    connectGitHub: async () => {
      set((state) => {
        state.isConnecting = true;
        state.error = null;
      });

      try {
        // 1. Start the OAuth flow (get auth URL with state)
        const { auth_url, state: oauthState } = await githubStartAuth();

        // 2. Open browser to GitHub authorization page
        try {
          await open(auth_url);
        } catch {
          window.open(auth_url, '_blank');
        }

        // 3. Wait for the callback server to receive the code (backend validates state)
        const [code] = await invoke<[string, string]>('wait_for_oauth_callback', { expectedState: oauthState });

        // 5. Exchange code for token (stored in keychain by backend)
        await githubCompleteAuth(code, oauthState);

        // 6. Fetch the token back for frontend use
        const token = await githubGetToken();
        set((state) => {
          state.token = token;
          state.isConnecting = false;
        });

        // 7. Fetch user info
        if (token) {
          await get().fetchUser(token);
        }
      } catch (err) {
        set((state) => {
          state.error = String(err);
          state.isConnecting = false;
        });
      }
    },

    disconnectGitHub: async () => {
      try {
        await githubDisconnect();
        set((state) => {
          state.token = null;
          state.user = null;
          state.selectedAccount = null;
          state.installations = [];
        });
      } catch (err) {
        console.error('Failed to disconnect GitHub:', err);
      }
    },

    reset: () => {
      set((state) => {
        state.user = null;
        state.installations = [];
        state.selectedAccount = null;
        state.isLoading = false;
        state.error = null;
        state.token = null;
        state.isConnecting = false;
      });
    },
  })),
);
