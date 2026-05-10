/**
 * LoginScreen - Authentication screen with GitHub, Google, and Email options
 * backed by AWS Cognito.
 */

import { useState, useCallback } from "react";
import { GitHubLogoIcon, EnvelopeClosedIcon, ExclamationTriangleIcon, ExternalLinkIcon } from "@radix-ui/react-icons";
import { Loader2 } from "lucide-react";
import { Button, Input } from "@solo/ui";
import {
  useAuthStore,
  useIsAuthenticating,
  useAuthError,
  usePendingAuthUrl,
} from "../../stores/authStore";
import { diagnoseAuth, openExternalAuthUrl, type AuthDiagnostic } from "../../lib/auth";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [emailFlowStarted, setEmailFlowStarted] = useState(false);
  const [diagnostic, setDiagnostic] = useState<AuthDiagnostic | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  const signInWithGitHub = useAuthStore((state) => state.signInWithGitHub);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const signInWithEmail = useAuthStore((state) => state.signInWithEmail);
  const clearError = useAuthStore((state) => state.clearError);

  const isAuthenticating = useIsAuthenticating();
  const error = useAuthError();
  const pendingAuthUrl = usePendingAuthUrl();

  const handleDiagnose = useCallback(async () => {
    setDiagnosing(true);
    setDiagnosticError(null);
    try {
      const report = await diagnoseAuth();
      setDiagnostic(report);
    } catch (e) {
      setDiagnosticError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiagnosing(false);
    }
  }, []);

  const handleCopyUrl = useCallback(async () => {
    if (!pendingAuthUrl) return;
    try {
      await writeText(pendingAuthUrl);
      setUrlCopied(true);
      window.setTimeout(() => setUrlCopied(false), 1800);
    } catch (e) {
      console.error("Failed to copy URL:", e);
    }
  }, [pendingAuthUrl]);

  const handleOpenManually = useCallback(async () => {
    if (!pendingAuthUrl) return;
    try {
      await openExternalAuthUrl(pendingAuthUrl);
    } catch (e) {
      console.error("Manual external browser open also failed:", e);
    }
  }, [pendingAuthUrl]);

  const handleGitHubClick = useCallback(async () => {
    clearError();
    await signInWithGitHub();
  }, [signInWithGitHub, clearError]);

  const handleGoogleClick = useCallback(async () => {
    clearError();
    await signInWithGoogle();
  }, [signInWithGoogle, clearError]);

  const handleEmailSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim()) return;

      clearError();
      await signInWithEmail(email);
      setEmailFlowStarted(true);
    },
    [email, signInWithEmail, clearError]
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
          <div className="mb-6 p-3 rounded-lg bg-destructive/10 flex items-start gap-2" role="alert">
            <ExclamationTriangleIcon className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* GitHub OAuth button */}
        <Button
          variant="primary"
          size="md"
          onClick={handleGitHubClick}
          disabled={isAuthenticating}
          className="w-full bg-foreground text-background hover:bg-foreground/90 hover:brightness-100"
        >
          {isAuthenticating ? (
            <Loader2 className="w-4 h-4 animate-spin" size={16} />
          ) : (
            <GitHubLogoIcon className="w-4 h-4" />
          )}
          Continue with GitHub
        </Button>

        {/* Google OAuth button */}
        <Button
          variant="secondary"
          size="md"
          onClick={handleGoogleClick}
          disabled={isAuthenticating}
          className="w-full mt-2"
        >
          {isAuthenticating ? (
            <Loader2 className="w-4 h-4 animate-spin" size={16} />
          ) : (
            <GoogleGlyph />
          )}
          Continue with Google
        </Button>

        {/* Browser notice */}
        {isAuthenticating && (
          <p className="mt-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-1">
            <ExternalLinkIcon className="w-3 h-3" />
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

        {/* Email sign-in form (opens Cognito Hosted UI pre-filled) */}
        {emailFlowStarted ? (
          <div className="text-center p-4 rounded-lg bg-muted/50 shadow-sm">
            <EnvelopeClosedIcon className="w-8 h-8 mx-auto text-primary mb-2" />
            <p className="text-sm text-foreground font-medium mb-1">
              Finish in your browser
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              We opened a secure sign-in page for <strong>{email}</strong>
            </p>
            <button
              type="button"
              onClick={() => setEmailFlowStarted(false)}
              className="text-xs text-primary hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleEmailSubmit}>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Email
            </label>
            <Input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={isAuthenticating}
            />
            <Button
              type="submit"
              variant="secondary"
              size="md"
              disabled={isAuthenticating || !email.trim()}
              className="w-full mt-3"
            >
              {isAuthenticating ? (
                <Loader2 className="w-4 h-4 animate-spin" size={16} />
              ) : (
                <EnvelopeClosedIcon className="w-4 h-4" />
              )}
              Continue with Email
            </Button>
          </form>
        )}

        {/* Manual URL fallback — only surfaces when shell.open failed
            or the user wants to paste the URL into a different browser. */}
        {pendingAuthUrl && (
          <div className="mt-6 p-3 rounded-lg bg-muted/40 border border-border text-left">
            <p className="text-xs font-medium text-foreground mb-1.5">
              Browser didn't open or landed on about:blank?
            </p>
            <p className="text-[11px] text-muted-foreground mb-2">
              Copy this URL and paste it into any browser:
            </p>
            <div className="font-mono text-[10px] break-all bg-background rounded px-2 py-1.5 border border-border/50 mb-2 max-h-24 overflow-y-auto">
              {pendingAuthUrl}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCopyUrl}
                className="flex-1 text-xs px-2 py-1 rounded bg-background border border-border hover:bg-accent"
              >
                {urlCopied ? "Copied!" : "Copy URL"}
              </button>
              <button
                type="button"
                onClick={handleOpenManually}
                className="flex-1 text-xs px-2 py-1 rounded bg-background border border-border hover:bg-accent"
              >
                Retry open
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-muted-foreground">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>

        {/* Diagnostics */}
        <div className="mt-4">
          <button
            type="button"
            onClick={handleDiagnose}
            disabled={diagnosing}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {diagnosing ? "Running diagnostics…" : "Run auth diagnostics"}
          </button>
          {diagnosticError && (
            <p className="mt-2 text-[11px] text-destructive">{diagnosticError}</p>
          )}
          {diagnostic && (
            <pre className="mt-2 text-[10px] bg-muted/40 border border-border rounded p-2 overflow-auto max-h-60 text-left font-mono">
              {JSON.stringify(diagnostic, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleGlyph(): React.JSX.Element {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.5Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.6A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 13.9A6 6 0 0 1 6 12c0-.7.1-1.3.3-1.9V7.5H3A10 10 0 0 0 2 12c0 1.6.4 3.1 1 4.5l3.4-2.6Z" />
      <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3 7.5l3.4 2.6C7.2 7.8 9.4 6 12 6Z" />
    </svg>
  );
}
