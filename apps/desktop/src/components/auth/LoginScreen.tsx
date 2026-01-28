/**
 * LoginScreen - Authentication screen with GitHub OAuth and Magic Link options
 */

import { useState, useCallback } from "react";
import { Github, Mail, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import {
  useAuthStore,
  useIsAuthenticating,
  useAuthError,
} from "../../stores/authStore";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const signInWithGitHub = useAuthStore((state) => state.signInWithGitHub);
  const signInWithMagicLink = useAuthStore((state) => state.signInWithMagicLink);
  const clearError = useAuthStore((state) => state.clearError);

  const isAuthenticating = useIsAuthenticating();
  const error = useAuthError();

  const handleGitHubClick = useCallback(async () => {
    clearError();
    await signInWithGitHub();
  }, [signInWithGitHub, clearError]);

  const handleMagicLinkSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim()) return;

      clearError();
      await signInWithMagicLink(email);
      setMagicLinkSent(true);
    },
    [email, signInWithMagicLink, clearError]
  );

  return (
    <div className="h-screen w-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-sm mx-auto p-8">
        {/* Logo and title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-2">Solo</h1>
          <p className="text-sm text-muted-foreground">
            AI-native development environment
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 p-3 rounded-md bg-destructive/10 border border-destructive/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* GitHub OAuth button */}
        <button
          type="button"
          onClick={handleGitHubClick}
          disabled={isAuthenticating}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-foreground text-background font-medium text-sm transition-colors hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isAuthenticating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Github className="w-4 h-4" />
          )}
          Continue with GitHub
        </button>

        {/* Browser notice */}
        {isAuthenticating && (
          <p className="mt-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-1">
            <ExternalLink className="w-3 h-3" />
            Complete sign in in your browser
          </p>
        )}

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-background px-2 text-muted-foreground">or</span>
          </div>
        </div>

        {/* Magic link form */}
        {magicLinkSent ? (
          <div className="text-center p-4 rounded-md bg-muted/50 border border-border">
            <Mail className="w-8 h-8 mx-auto text-primary mb-2" />
            <p className="text-sm text-foreground font-medium mb-1">
              Check your email
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              We sent a magic link to <strong>{email}</strong>
            </p>
            <button
              type="button"
              onClick={() => setMagicLinkSent(false)}
              className="text-xs text-primary hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleMagicLinkSubmit}>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Email
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={isAuthenticating}
              className="w-full px-3 py-2 rounded-md bg-muted/50 border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isAuthenticating || !email.trim()}
              className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-muted border border-border text-foreground font-medium text-sm transition-colors hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAuthenticating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Mail className="w-4 h-4" />
              )}
              Send Magic Link
            </button>
          </form>
        )}

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-muted-foreground">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
