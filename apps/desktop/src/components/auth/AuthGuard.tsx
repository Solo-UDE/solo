/**
 * AuthGuard - Wrapper component that handles authentication state
 * Shows LoginScreen if not authenticated, children if authenticated
 */

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
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

  // Show loading spinner during initialization
  if (isInitializing) {
    return (
      <div className="h-screen w-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
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
