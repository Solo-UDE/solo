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

export function AuthGuard({ children }: AuthGuardProps) {
  const initialize = useAuthStore((state) => state.initialize);
  const handleAuthCallback = useAuthStore((state) => state.handleAuthCallback);

  const isAuthenticated = useIsAuthenticated();
  const isInitializing = useIsAuthInitializing();

  // Initialize auth on mount (skip in dev mode)
  useEffect(() => {
    if (!import.meta.env.DEV) {
      initialize();
    }
  }, [initialize]);

  // Listen for auth callback deep links (skip in dev mode)
  useEffect(() => {
    if (import.meta.env.DEV) return;

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

  // In dev mode, bypass auth so we can test without deep link OAuth
  if (import.meta.env.DEV) {
    return <>{children}</>;
  }

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
