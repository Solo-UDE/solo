/**
 * Auth library for AWS Cognito OAuth integration.
 * Type-safe wrappers around Tauri auth commands.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";

// =============================================================================
// Types
// =============================================================================

export interface User {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuthState {
  user: User | null;
  is_authenticated: boolean;
}

export type OAuthProvider = "github" | "google" | "email";

// =============================================================================
// Auth Functions
// =============================================================================

/**
 * Start OAuth sign-in flow
 * Opens the system browser to the OAuth provider
 */
export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
  const authUrl = await invoke<string>("auth_start_oauth", { provider });
  console.log("Opening OAuth URL:", authUrl);
  try {
    await open(authUrl);
  } catch (error) {
    console.error("Failed to open browser:", error);
    // Fallback: try window.open
    window.open(authUrl, "_blank");
  }
}

/**
 * Open the Cognito Hosted UI sign-in page with the email pre-filled
 * (via the `login_hint` OAuth parameter). The backend stashes a PKCE verifier
 * so the subsequent `/auth/callback` code can be exchanged.
 */
export async function signInWithEmail(email: string): Promise<void> {
  const authUrl = await invoke<string>("auth_start_magic_link", { email });
  try {
    await open(authUrl);
  } catch (error) {
    console.error("Failed to open browser:", error);
    window.open(authUrl, "_blank");
  }
}

/**
 * Deprecated alias kept for call-site compatibility; behaves identically to
 * `signInWithEmail` now that Cognito's Hosted UI replaced Supabase's magic link.
 */
export const signInWithMagicLink = signInWithEmail;

/**
 * Exchange authorization code for session tokens
 * Called after OAuth callback
 */
export async function exchangeCodeForSession(code: string): Promise<AuthState> {
  return invoke<AuthState>("auth_exchange_code", { code });
}

/**
 * Get current session state
 * Restores session from keychain if available
 */
export async function getSession(): Promise<AuthState> {
  return invoke<AuthState>("auth_get_session");
}

/**
 * Refresh the session using the stored refresh token
 */
export async function refreshSession(): Promise<AuthState> {
  return invoke<AuthState>("auth_refresh_session");
}

/**
 * Sign out, clear stored tokens, and receive the Cognito logout URL so the
 * frontend can open it in the browser to end the hosted-UI session.
 *
 * The Rust side may return an empty URL when Cognito config is unavailable
 * (e.g. env vars missing at startup); we just skip the browser hop in that
 * case so local sign-out still succeeds.
 */
export async function signOut(): Promise<string> {
  console.debug("[auth.signOut] invoking auth_sign_out");
  const logoutUrl = await invoke<string>("auth_sign_out");
  console.debug("[auth.signOut] auth_sign_out returned", {
    hasUrl: logoutUrl.length > 0,
  });
  if (logoutUrl.length === 0) {
    console.warn(
      "[auth.signOut] no logout URL — local state cleared, skipping Cognito browser hop",
    );
    return logoutUrl;
  }
  try {
    await open(logoutUrl);
    console.debug("[auth.signOut] opened logout URL in browser");
  } catch (error) {
    console.error("[auth.signOut] failed to open browser for logout:", error);
  }
  return logoutUrl;
}

/**
 * Get the current access token for calls to Solo's API Gateway (carries
 * the Cognito JWT used by the `HttpJwtAuthorizer`).
 */
export async function getAccessToken(): Promise<string | null> {
  return invoke<string | null>("auth_get_access_token");
}

/**
 * Get the stored ID token (JWT with identity claims). Used for extracting
 * user info without a userInfo round-trip.
 */
export async function getIdToken(): Promise<string | null> {
  return invoke<string | null>("auth_get_id_token");
}

// =============================================================================
// Event Listeners
// =============================================================================

/**
 * Listen for auth callback deep links
 * Returns an unlisten function to clean up the listener
 */
export async function onAuthCallback(
  callback: (code: string) => void
): Promise<UnlistenFn> {
  console.log("Setting up auth-callback listener...");
  return listen<string>("auth-callback", (event) => {
    console.log("Received auth-callback event:", event.payload);
    try {
      const url = new URL(event.payload);
      const code = url.searchParams.get("code");
      console.log("Extracted code:", code);

      if (code) {
        callback(code);
      } else {
        console.error("No code in callback URL");
      }
    } catch (error) {
      console.error("Failed to parse callback URL:", error);
    }
  });
}
