/**
 * Auth Zustand Store
 * Manages authentication state, session persistence, and OAuth flows
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { AuthCallbackPayload, User } from "../lib/auth";
import * as auth from "../lib/auth";
import { signInWithOAuthLoopback } from "../lib/auth";
import { useCloudStatsStore } from "./cloudStatsStore";

// =============================================================================
// Types
// =============================================================================

interface AuthState {
  // Session state
  user: User | null;
  isAuthenticated: boolean;

  // Loading states
  isInitializing: boolean;
  isAuthenticating: boolean;

  // Error state
  error: string | null;

  // Last generated OAuth URL (exposed so LoginScreen can offer a manual
  // "Open in browser" fallback when shell.open misbehaves — e.g. default
  // browser navigates to about:blank, custom handler intercepts, etc).
  pendingAuthUrl: string | null;
}

interface AuthActions {
  // Initialization
  initialize: () => Promise<void>;

  // OAuth
  signInWithGitHub: () => Promise<void>;
  signInWithDifferentGitHubAccount: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  handleAuthCallback: (payload: AuthCallbackPayload) => Promise<void>;

  // Session
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;

  // Error handling
  clearError: () => void;
  cancelAuth: () => void;
}

type AuthStore = AuthState & AuthActions;

// =============================================================================
// Initial State
// =============================================================================

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isInitializing: true,
  isAuthenticating: false,
  error: null,
  pendingAuthUrl: null,
};

// =============================================================================
// Store
// =============================================================================

export const useAuthStore = create<AuthStore>()(
  immer((set, get) => ({
    ...initialState,

    initialize: async () => {
      set((state) => {
        state.isInitializing = true;
        state.error = null;
      });

      try {
        const session = await auth.getSession();

        set((state) => {
          state.user = session.user;
          state.isAuthenticated = session.is_authenticated;
          state.isInitializing = false;
        });

        if (session.is_authenticated) {
          void useCloudStatsStore.getState().initialize();
        }
      } catch (error) {
        console.error("Failed to initialize auth:", error);
        set((state) => {
          state.isInitializing = false;
          state.error =
            error instanceof Error ? error.message : "Failed to initialize auth";
        });
      }
    },

    signInWithGitHub: async () => {
      set((state) => {
        state.isAuthenticating = true;
        state.error = null;
        state.pendingAuthUrl = null;
      });

      try {
        const result = await signInWithOAuthLoopback("github");
        set((state) => {
          state.pendingAuthUrl = result.authUrl || null;
          if (!result.opened) {
            state.error =
              result.error ??
              "We couldn't open your browser automatically. Copy the URL below and open it manually.";
            state.isAuthenticating = false;
          }
        });
      } catch (error) {
        console.error("Failed to start GitHub OAuth:", error);
        set((state) => {
          state.isAuthenticating = false;
          state.error =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "Failed to start authentication";
        });
      }
    },

    signInWithDifferentGitHubAccount: async () => {
      // GitHub's OAuth has no `prompt=select_account` — the only way to let
      // the user switch GitHub identities is to clear github.com's session
      // first, then run the normal OAuth flow. We open the logout URL in
      // the same browser, wait briefly for it to land, then start OAuth.
      // The user will see GitHub's login page and can pick any account.
      set((state) => {
        state.isAuthenticating = true;
        state.error = null;
        state.pendingAuthUrl = null;
      });

      try {
        await auth.openGitHubLogout();
        // Give the browser ~1.2s to actually navigate to the logout page so
        // the next tab doesn't race the logout. Without this delay the OAuth
        // tab can open while github.com is still serving the previous
        // session cookie, defeating the point.
        await new Promise((r) => setTimeout(r, 1200));
        const result = await signInWithOAuthLoopback("github");
        set((state) => {
          state.pendingAuthUrl = result.authUrl || null;
          if (!result.opened) {
            state.error =
              result.error ??
              "We couldn't open your browser automatically. Copy the URL below and open it manually.";
            state.isAuthenticating = false;
          }
        });
      } catch (error) {
        console.error("Failed to start GitHub OAuth (different account):", error);
        set((state) => {
          state.isAuthenticating = false;
          state.error =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "Failed to start authentication";
        });
      }
    },

    signInWithGoogle: async () => {
      set((state) => {
        state.isAuthenticating = true;
        state.error = null;
        state.pendingAuthUrl = null;
      });

      try {
        const result = await signInWithOAuthLoopback("google");
        set((state) => {
          state.pendingAuthUrl = result.authUrl || null;
          if (!result.opened) {
            state.error =
              result.error ??
              "We couldn't open your browser automatically. Copy the URL below and open it manually.";
            state.isAuthenticating = false;
          }
        });
      } catch (error) {
        console.error("Failed to start Google OAuth:", error);
        set((state) => {
          state.isAuthenticating = false;
          state.error =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "Failed to start Google sign-in";
        });
      }
    },

    signInWithEmail: async (email: string) => {
      set((state) => {
        state.isAuthenticating = true;
        state.error = null;
      });

      try {
        await auth.signInWithEmail(email);
      } catch (error) {
        console.error("Failed to start email sign-in:", error);
        set((state) => {
          state.isAuthenticating = false;
          state.error =
            error instanceof Error ? error.message : "Failed to start email sign-in";
        });
      }
    },

    signInWithMagicLink: async (email: string) => {
      await get().signInWithEmail(email);
    },

    handleAuthCallback: async (payload: AuthCallbackPayload) => {
      if (payload.kind === "signout") {
        set((s) => {
          s.isAuthenticating = false;
          s.error = null;
        });
        return;
      }

      if (payload.kind === "oauth_error") {
        console.error("OAuth callback returned provider error:", payload);
        set((s) => {
          s.isAuthenticating = false;
          s.error = payload.errorDescription
            ? `${payload.error}: ${payload.errorDescription}`
            : payload.error;
        });
        return;
      }

      if (payload.kind === "invalid") {
        console.error("Invalid auth callback:", payload);
        set((s) => {
          s.isAuthenticating = false;
          s.error = payload.message;
        });
        return;
      }

      set((s) => {
        s.isAuthenticating = true;
        s.error = null;
      });

      try {
        const session = await auth.exchangeCodeForSession(payload.code);

        set((s) => {
          s.user = session.user;
          s.isAuthenticated = session.is_authenticated;
          s.isAuthenticating = false;
        });

        if (session.is_authenticated) {
          void useCloudStatsStore.getState().initialize();
        }
      } catch (error) {
        console.error("Failed to complete authentication:", error);
        set((s) => {
          s.isAuthenticating = false;
          s.error =
            error instanceof Error
              ? error.message
              : "Failed to complete authentication";
        });
      }
    },

    signOut: async () => {
      console.debug("[authStore.signOut] optimistic clear");
      // Optimistic: flip the UI first so the user sees immediate feedback.
      // Rust cleanup (vault deletes + Cognito logout URL) runs concurrently;
      // if it errors we surface a toast-level message but don't rehydrate
      // the session — the user's intent is unambiguous.
      set((state) => {
        state.user = null;
        state.isAuthenticated = false;
        state.isAuthenticating = false;
        state.error = null;
      });
      useCloudStatsStore.getState().reset();
      console.debug("[authStore.signOut] state cleared; invoking Rust");

      try {
        await auth.signOut();
        console.debug("[authStore.signOut] Rust signOut completed");
      } catch (error) {
        console.error("[authStore.signOut] Rust signOut errored:", error);
        set((state) => {
          state.error =
            error instanceof Error ? error.message : "Failed to sign out";
        });
      }
    },

    refreshSession: async () => {
      try {
        const session = await auth.refreshSession();

        set((state) => {
          state.user = session.user;
          state.isAuthenticated = session.is_authenticated;
        });
      } catch (error) {
        console.error("Failed to refresh session:", error);
        // Session expired, clear auth state
        set((state) => {
          state.user = null;
          state.isAuthenticated = false;
        });
      }
    },

    clearError: () => {
      set((state) => {
        state.error = null;
      });
    },

    cancelAuth: () => {
      set((state) => {
        state.isAuthenticating = false;
        state.error = null;
        state.pendingAuthUrl = null;
      });
      // Fire-and-forget: release the loopback port on the Rust side so the
      // user can immediately start another sign-in attempt without waiting
      // for the 5-minute timeout.
      void auth.cancelOAuthLoopback();
    },
  }))
);

// =============================================================================
// Selectors
// =============================================================================

export const useUser = () => useAuthStore((state) => state.user);
export const useIsAuthenticated = () =>
  useAuthStore((state) => state.isAuthenticated);
export const useIsAuthInitializing = () =>
  useAuthStore((state) => state.isInitializing);
export const useIsAuthenticating = () =>
  useAuthStore((state) => state.isAuthenticating);
export const useAuthError = () => useAuthStore((state) => state.error);
export const usePendingAuthUrl = () =>
  useAuthStore((state) => state.pendingAuthUrl);
