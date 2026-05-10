/**
 * GitHub Accounts Store — manages GitHub account, token, and installation state.
 *
 * Uses direct GitHub OAuth (not Supabase) for git operations.
 * Primary auth method: GitHub Device Flow (no secret, no callback server).
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { GitHubAccount, GitHubInstallation } from '@/lib/github-api';
import { getAuthenticatedUser, listInstallations } from '@/lib/github-api';
import {
  githubGetToken,
  githubDisconnect,
  githubStartLink,
} from '@/lib/tauri/git';
import { openExternalAuthUrl } from '@/lib/auth';
import { toast } from 'sonner';

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
  /** Device Flow: user code to display (e.g. "ABCD-1234") */
  userCode: string | null;
  /** Device Flow: URL where user enters the code */
  verificationUri: string | null;
}

interface GitHubAccountsActions {
  fetchUser: (token: string) => Promise<void>;
  fetchInstallations: (token: string) => Promise<void>;
  setSelectedAccount: (account: GitHubAccount | null) => void;
  /** Load persisted token from keychain on app startup */
  loadToken: (options?: { retry?: boolean }) => Promise<void>;
  /** Start the cloud link flow for the signed-in Solo account */
  connectGitHub: () => Promise<void>;
  /** Complete the cloud link flow after the soloide://github/linked callback */
  completeLinkCallback: (success: boolean, error?: string | null) => Promise<void>;
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
    userCode: null,
    verificationUri: null,

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

    loadToken: async (options?: { retry?: boolean }) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const maxAttempts = options?.retry ? 5 : 1;
        let token: string | null = null;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          token = await githubGetToken();
          if (token || attempt === maxAttempts - 1) break;

          // Cognito's post-auth trigger writes the GitHub token server-side.
          // On a fresh GitHub Solo sign-in, give that row a moment to appear.
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }

        if (!token) {
          set((state) => {
            state.user = null;
            state.installations = [];
            state.selectedAccount = null;
            state.token = null;
            state.isLoading = false;
          });
          return;
        }

        set((state) => {
          state.token = token;
        });
        // Fetch user info with the token linked to the current Solo account.
        await get().fetchUser(token);
      } catch (err) {
        console.error('Failed to load GitHub token:', err);
        set((state) => {
          state.error = String(err);
          state.user = null;
          state.installations = [];
          state.selectedAccount = null;
          state.token = null;
          state.isLoading = false;
        });
      }
    },

    connectGitHub: async () => {
      set((state) => {
        state.isConnecting = true;
        state.error = null;
        state.userCode = null;
        state.verificationUri = null;
      });

      try {
        const authorizeUrl = await githubStartLink();

        set((state) => {
          state.verificationUri = authorizeUrl;
        });

        try {
          await openExternalAuthUrl(authorizeUrl);
        } catch {
          window.open(authorizeUrl, '_blank');
        }

        toast('Finish linking GitHub in your browser', {
          description: 'GitHub will return to Solo when the account is linked.',
        });
      } catch (err) {
        toast.error('GitHub link failed', { description: String(err) });
        set((state) => {
          state.error = String(err);
          state.isConnecting = false;
          state.userCode = null;
          state.verificationUri = null;
        });
      }
    },

    completeLinkCallback: async (success: boolean, error?: string | null) => {
      if (!success) {
        const message = error ?? 'GitHub did not finish linking.';
        toast.error('GitHub link failed', { description: message });
        set((state) => {
          state.error = message;
          state.isConnecting = false;
          state.userCode = null;
          state.verificationUri = null;
        });
        return;
      }

      await get().loadToken();
      const token = get().token;

      set((state) => {
        state.isConnecting = false;
        state.userCode = null;
        state.verificationUri = null;
      });

      if (token) {
        toast.success('GitHub linked to Solo');
      } else {
        const message = 'GitHub linked, but Solo could not load the linked token yet.';
        toast.error('GitHub link incomplete', { description: message });
        set((state) => {
          state.error = message;
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
          state.isConnecting = false;
          state.userCode = null;
          state.verificationUri = null;
        });
        toast.success('GitHub disconnected from Solo');
      } catch (err) {
        console.error('Failed to disconnect GitHub:', err);
        toast.error('Failed to disconnect GitHub', { description: String(err) });
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
        state.userCode = null;
        state.verificationUri = null;
      });
    },
  })),
);
