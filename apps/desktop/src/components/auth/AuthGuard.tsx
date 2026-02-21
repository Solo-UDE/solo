/**
 * AuthGuard - Wrapper component that handles authentication state
 * Shows LoginScreen if not authenticated, children if authenticated
 */

import { useEffect } from "react";
import { Skeleton } from "@solo/ui";
import {
  useAuthStore,
  useIsAuthenticated,
  useIsAuthInitializing,
} from "../../stores/authStore";
import { onAuthCallback } from "../../lib/auth";
import { LoginScreen } from "./LoginScreen";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * In dev mode, bypass auth entirely so we can test without deep link OAuth.
 * In production, delegate to the real auth guard.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  if (import.meta.env.DEV) {
    return <>{children}</>;
  }

  return <AuthGuardInner>{children}</AuthGuardInner>;
}

function AuthGuardInner({ children }: AuthGuardProps) {
  const initialize = useAuthStore((state) => state.initialize);
  const handleAuthCallback = useAuthStore((state) => state.handleAuthCallback);
  const isAuthenticated = useIsAuthenticated();
  const isInitializing = useIsAuthInitializing();

  // Initialize auth on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Listen for auth callback deep links
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await onAuthCallback((code) => {
        handleAuthCallback(code);
      });
    };

    setupListener();

    return () => {
      unlisten?.();
    };
  }, [handleAuthCallback]);

  // Show branded skeleton during initialization
  if (isInitializing) {
    return (
      <div className="h-screen w-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-10 h-10">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <Skeleton shimmer className="h-3 w-24 rounded-full" />
            <Skeleton shimmer className="h-2 w-16 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // Render children if authenticated
  return <>{children}</>;
}
