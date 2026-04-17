/**
 * Auth Zustand Store
 * Manages authentication state, session persistence, and OAuth flows
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { User } from "../lib/auth";
import * as auth from "../lib/auth";
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
}

interface AuthActions {
  // Initialization
  initialize: () => Promise<void>;

  // OAuth
  signInWithGitHub: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  handleAuthCallback: (code: string) => Promise<void>;

  // Session
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;

  // Error handling
  clearError: () => void;
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
      });

      try {
        await auth.signInWithOAuth("github");
        // Browser will open, user completes auth, deep link callback will fire
      } catch (error) {
        console.error("Failed to start GitHub OAuth:", error);
        set((state) => {
          state.isAuthenticating = false;
          state.error =
            error instanceof Error
              ? error.message
              : "Failed to start authentication";
        });
      }
    },

    signInWithGoogle: async () => {
      set((state) => {
        state.isAuthenticating = true;
        state.error = null;
      });

      try {
        await auth.signInWithOAuth("google");
      } catch (error) {
        console.error("Failed to start Google OAuth:", error);
        set((state) => {
          state.isAuthenticating = false;
          state.error =
            error instanceof Error ? error.message : "Failed to start Google sign-in";
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

    handleAuthCallback: async (code: string) => {
      set((s) => {
        s.isAuthenticating = true;
        s.error = null;
      });

      try {
        const session = await auth.exchangeCodeForSession(code);

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
