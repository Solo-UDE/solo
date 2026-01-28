/**
 * Auth library for Supabase OAuth integration
 * Type-safe wrappers around Tauri auth commands
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

export type OAuthProvider = "github";

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
 * Send a magic link email for passwordless sign-in
 */
export async function signInWithMagicLink(email: string): Promise<void> {
  await invoke<void>("auth_start_magic_link", { email });
}

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
 * Sign out and clear stored tokens
 */
export async function signOut(): Promise<void> {
  await invoke<void>("auth_sign_out");
}

/**
 * Get the current access token for API calls
 */
export async function getAccessToken(): Promise<string | null> {
  return invoke<string | null>("auth_get_access_token");
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
