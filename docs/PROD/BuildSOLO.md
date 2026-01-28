# Building Solo Desktop

This guide covers local development setup, authentication configuration, and important implementation details.

## Prerequisites

- **Rust** (latest stable)
- **Bun** (or npm/yarn)
- **macOS** (for deep link testing and Keychain storage)
- **Supabase project** with GitHub OAuth configured

## Quick Start

```bash
# Install dependencies
bun install

# Development mode (hot reload, but deep links won't work)
bun run dev

# Production build (required for OAuth testing)
bun run build

# Install to /Applications for deep link registration
cp -R target/release/bundle/macos/Solo.app /Applications/
```

## Authentication Architecture

Solo uses Supabase OAuth with PKCE flow for secure desktop authentication.

### Flow Overview

```
User clicks "Sign in with GitHub"
    ↓
App generates PKCE codes (verifier + challenge)
    ↓
Opens browser → Supabase OAuth → GitHub
    ↓
User authenticates in browser
    ↓
Browser redirects to soloide://auth/callback?code=X
    ↓
macOS opens Solo app with deep link
    ↓
App exchanges code + verifier for session tokens
    ↓
Tokens stored in Keychain → User signed in
```

### Key Files

| File | Purpose |
|------|---------|
| `src-tauri/src/auth_commands.rs` | Rust OAuth logic, PKCE, token exchange, Keychain |
| `src/lib/auth.ts` | TypeScript wrappers for Tauri auth commands |
| `src/stores/authStore.ts` | Zustand store for auth state |
| `src/components/auth/LoginScreen.tsx` | Login UI |
| `src/components/auth/AuthGuard.tsx` | Auth wrapper component |

## Supabase Configuration

### Required Setup

1. **Supabase Dashboard → Authentication → URL Configuration**
   - Add `soloide://auth/callback` to **Redirect URLs**

2. **Supabase Dashboard → Authentication → Providers**
   - Enable GitHub provider with OAuth app credentials

### Embedded Credentials

The Supabase URL and anon key are embedded in `auth_commands.rs`:

```rust
const SUPABASE_URL: &str = "https://krhyecazjzbjhmmofnkj.supabase.co";
const SUPABASE_ANON_KEY: &str = "eyJ...";
```

These are **public values** (anon key is designed for client-side use with Row Level Security). They are embedded because:
- `.env` files don't work reliably in production Tauri builds
- The anon key is not a secret (RLS protects data)

## Deep Linking

### URL Scheme

The app registers the `soloide://` URL scheme for OAuth callbacks.

### Configuration

**tauri.conf.json:**
```json
"plugins": {
  "deep-link": {
    "desktop": {
      "schemes": ["soloide"]
    }
  }
}
```

### Important: Dev Mode vs Production Build

| Mode | Deep Links Work? | Notes |
|------|------------------|-------|
| `bun run dev` | No | URL scheme not registered with macOS |
| `bun run build` + install .app | Yes | .app bundle registers the scheme |

**To test OAuth, you must:**
1. Run `bun run build`
2. Install the .app to /Applications (or run it from the bundle location)

### Troubleshooting Deep Links

```bash
# Test if deep link scheme is registered
open "soloide://auth/callback?code=test"

# If multiple versions conflict, reset Launch Services
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain system -domain user

# Then reinstall the app
rm -rf /Applications/Solo.app
cp -R target/release/bundle/macos/Solo.app /Applications/
```

## Supabase PKCE Token Exchange

### Critical: Non-Standard API

Supabase GoTrue uses **non-standard parameter names** for PKCE token exchange:

| Standard OAuth2 | Supabase GoTrue |
|-----------------|-----------------|
| `code` | `auth_code` |
| `grant_type=authorization_code` (form) | `?grant_type=pkce` (query param) |
| `application/x-www-form-urlencoded` | `application/json` |

**Correct request format:**
```
POST /auth/v1/token?grant_type=pkce
Content-Type: application/json
apikey: <anon-key>

{
  "auth_code": "<authorization-code>",
  "code_verifier": "<pkce-verifier>"
}
```

Reference: https://github.com/supabase/auth/issues/2306

## Token Storage

Tokens are stored in macOS Keychain:

| Service Name | Content |
|--------------|---------|
| `solo.supabase.accessToken` | JWT access token |
| `solo.supabase.refreshToken` | Refresh token |

```bash
# View stored tokens (for debugging)
security find-generic-password -s "solo.supabase.accessToken" -w

# Delete tokens (to reset auth state)
security delete-generic-password -s "solo.supabase.accessToken"
security delete-generic-password -s "solo.supabase.refreshToken"
```

## Local Development Workflow

### For UI/Frontend Work (no auth needed)

```bash
bun run dev
```

### For Auth Testing

```bash
# 1. Build the app
bun run build

# 2. Kill any existing instance
pkill -9 "Solo"

# 3. Install fresh build
rm -rf /Applications/Solo.app
cp -R target/release/bundle/macos/Solo.app /Applications/

# 4. Run with debug logging
RUST_LOG=debug /Applications/Solo.app/Contents/MacOS/Solo 2>&1 | tee /tmp/solo-auth.log
```

### Debugging Auth Issues

```bash
# Watch auth logs in real-time
tail -f /tmp/solo-auth.log | grep -E "(auth|OAuth|PKCE|token)"
```

Common issues:
- **"unsupported_grant_type"**: Check token exchange uses `auth_code` not `code`
- **"No PKCE state found"**: App was restarted between OAuth start and callback
- **Deep link not opening app**: Need production build, not dev mode

## Dependencies

### Cargo (src-tauri/Cargo.toml)

```toml
# Auth-related
tauri-plugin-deep-link = "2"
tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }
reqwest = { version = "0.12", features = ["json"] }
sha2 = "0.10"
base64 = "0.22"
rand = "0.8"
url = "2"
urlencoding = "2"
```

### NPM (package.json)

```json
"@tauri-apps/plugin-deep-link": "^2.0.0"
```

## Checklist for New Developers

- [ ] Supabase project URL and anon key are correct in `auth_commands.rs`
- [ ] `soloide://auth/callback` is in Supabase redirect URLs
- [ ] GitHub OAuth provider is enabled in Supabase
- [ ] Using production build (not dev mode) for auth testing
- [ ] App is installed to /Applications for deep link registration
- [ ] No conflicting Solo.app versions in Launch Services
