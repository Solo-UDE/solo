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
  githubStartDeviceAuth,
  githubPollDeviceAuth,
} from '@/lib/tauri/git';
import { open } from '@tauri-apps/plugin-shell';
import { toast } from 'sonner';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

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
  loadToken: () => Promise<void>;
  /** Start the GitHub Device Flow (show code, poll for completion) */
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
        state.userCode = null;
        state.verificationUri = null;
      });

      let toastId: string | number | undefined;

      try {
        // 1. Start the Device Flow (get user_code + device_code)
        const { user_code, verification_uri, device_code, expires_in, interval } =
          await githubStartDeviceAuth();

        // 2. Store in state + show toast with the code
        set((state) => {
          state.userCode = user_code;
          state.verificationUri = verification_uri;
        });

        // Auto-copy code to clipboard
        try {
          await writeText(user_code);
        } catch {
          navigator.clipboard.writeText(user_code).catch(() => {});
        }

        // Show persistent toast with the device code
        toastId = toast(`Enter code at github.com/login/device`, {
          description: `Your code: ${user_code} (copied to clipboard)`,
          duration: Infinity,
        });

        // 3. Open verification URL in browser
        try {
          await open(verification_uri);
        } catch {
          window.open(verification_uri, '_blank');
        }

        // 4. Poll until authorized, expired, or error
        const deadline = Date.now() + expires_in * 1000;
        const pollInterval = interval * 1000;

        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, pollInterval));

          // Check if we've been cancelled (disconnected while connecting)
          if (!get().isConnecting) {
            if (toastId) toast.dismiss(toastId);
            return;
          }

          const result = await githubPollDeviceAuth(device_code);

          if (result.status === 'complete') {
            if (toastId) toast.dismiss(toastId);
            // Token stored by backend — fetch it for frontend use
            const token = await githubGetToken();
            set((state) => {
              state.token = token;
              state.isConnecting = false;
              state.userCode = null;
              state.verificationUri = null;
            });
            if (token) {
              await get().fetchUser(token);
            }
            toast.success('Connected to GitHub');
            return;
          }

          if (result.status === 'expired') {
            throw new Error('Device code expired. Please try again.');
          }

          if (result.status === 'error') {
            throw new Error(result.message);
          }

          // status === 'pending' → continue polling
        }

        throw new Error('Timed out waiting for authorization.');
      } catch (err) {
        if (toastId) toast.dismiss(toastId);
        toast.error('GitHub sign in failed', { description: String(err) });
        set((state) => {
          state.error = String(err);
          state.isConnecting = false;
          state.userCode = null;
          state.verificationUri = null;
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
        state.userCode = null;
        state.verificationUri = null;
      });
    },
  })),
);
