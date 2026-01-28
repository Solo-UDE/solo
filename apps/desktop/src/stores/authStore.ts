/**
 * Auth Zustand Store
 * Manages authentication state, session persistence, and OAuth flows
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { User } from "../lib/auth";
import * as auth from "../lib/auth";

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
  immer((set, _get) => ({
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

    signInWithMagicLink: async (email: string) => {
      set((state) => {
        state.isAuthenticating = true;
        state.error = null;
      });

      try {
        await auth.signInWithMagicLink(email);
        set((state) => {
          state.isAuthenticating = false;
        });
      } catch (error) {
        console.error("Failed to send magic link:", error);
        set((state) => {
          state.isAuthenticating = false;
          state.error =
            error instanceof Error ? error.message : "Failed to send magic link";
        });
      }
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
      try {
        await auth.signOut();

        set((state) => {
          state.user = null;
          state.isAuthenticated = false;
        });
      } catch (error) {
        console.error("Failed to sign out:", error);
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
