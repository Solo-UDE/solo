# Building Solo Desktop

This guide covers the **current** Solo desktop auth/build flow.

Solo desktop authentication is now **AWS Cognito-based**. Any older Supabase
desktop-auth instructions are obsolete.

## Desktop auth env contract

The desktop app reads these values:

| Variable | Purpose |
|---|---|
| `SOLO_COGNITO_DOMAIN` | Cognito Hosted UI domain, for example `solo-ide-dev.auth.us-east-1.amazoncognito.com` |
| `SOLO_COGNITO_CLIENT_ID` | Cognito desktop app client ID |
| `SOLO_AWS_REGION` | AWS region for Cognito and related APIs |
| `SOLO_API_ENDPOINT` | Solo API Gateway base URL used after sign-in |

### Build-time vs runtime

- **Release / bundled builds:** use compile-time embedded values. This matters because Finder-launched macOS apps do not inherit your shell environment.
- **`tauri dev`:** can use runtime env values. In debug builds Solo also loads local env files automatically from:
  - `infra/.env.dev`
  - `infra/.env`
  - `.env.local`
  - `.env`

## Local auth testing

### Recommended path

```bash
cd /Users/sachin/Developer/Orbit_Main/solo

bun run auth:doctor
bun run dev:auth
```

What this does:

- loads the local desktop auth env
- sets `VITE_AUTH_ENABLED=1` and `VITE_AUTH_BYPASS=0`
- launches `tauri dev` with the real login screen mounted

### Expected behavior

1. Login screen appears with **GitHub**, **Google**, and **Email**.
2. Clicking GitHub or Google opens the Cognito Hosted UI in your browser.
3. After successful auth, the browser redirects to:
   - `http://127.0.0.1:19877/callback?code=...`
4. Solo exchanges the code for Cognito tokens and stores them in the macOS keychain.
5. Relaunching the app restores the session until you explicitly sign out.

### Sign-out test

- Open **Settings**
- Click **Log out**
- Solo should clear local tokens, hit the Cognito logout URL in the browser, and return to the login screen

### Session persistence test

1. Sign in with any provider
2. Quit the app fully (`Cmd+Q`)
3. Relaunch Solo
4. You should land in the authenticated app without signing in again

## Callback handling

Solo starts a one-shot local callback server at `127.0.0.1:19877` for desktop
sign-in. The `soloide://` URL scheme remains registered as a fallback and for
sign-out callbacks.

Quick check:

```bash
open "soloide://auth/callback?code=test"
```

If macOS does not hand this URL to Solo:

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Solo.app
```

Then relaunch the app and try again.

### macOS local auth bundle

For macOS OAuth callback testing, `tauri dev` is not enough by itself because
the `soloide://` deep link must be handled by an installed app bundle in
`/Applications`.

Use:

```bash
cd /Users/sachin/Developer/Orbit_Main/solo

bun run auth:doctor
bun run dev:auth:mac
```

What this does:

- loads the local desktop auth env
- builds a local debug `Solo.app` bundle with updater signing disabled
- backs up an existing `/Applications/Solo.app` to `/Applications/Solo (Production Backup).app`
- installs the local debug build into `/Applications/Solo.app`
- refreshes Launch Services for the `soloide://` scheme
- opens the installed local app

To restore the previous installed app:

```bash
bun run dev:auth:mac:restore
```

## Local unsigned build

If you want a local desktop bundle instead of `tauri dev`, export the desktop
env contract first, then build:

```bash
export SOLO_COGNITO_DOMAIN="solo-ide-dev.auth.us-east-1.amazoncognito.com"
export SOLO_COGNITO_CLIENT_ID="3lvjbkkev35ejmm927rkfn13d3"
export SOLO_AWS_REGION="us-east-1"
export SOLO_API_ENDPOINT="https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com"

cd apps/desktop
bunx tauri build --bundles app,dmg
```

For local dev auth testing, `bun run dev:auth` is still the preferred path.

## CI / release env mapping

GitHub Actions maps stage-specific repo variables into the generic desktop env
contract at build time:

### Dev workflows

- `.github/workflows/premerge-master.yml`
- `.github/workflows/build-master-dmg.yml`

These expect:

- `SOLO_DEV_COGNITO_DOMAIN`
- `SOLO_DEV_COGNITO_CLIENT_ID`
- `SOLO_DEV_AWS_REGION`
- `SOLO_DEV_API_ENDPOINT`

### Release workflow

- `.github/workflows/release.yml`

This expects:

- `SOLO_PROD_COGNITO_DOMAIN`
- `SOLO_PROD_COGNITO_CLIENT_ID`
- `SOLO_PROD_AWS_REGION`
- `SOLO_PROD_API_ENDPOINT`

## Troubleshooting

### `Desktop Cognito domain is not configured`

Run:

```bash
bun run auth:doctor
```

If values are missing, populate `infra/.env.dev` for local work or the correct
GitHub Actions variables for CI.

### `No pending OAuth flow`

The app lost its PKCE verifier between starting the browser flow and receiving
the callback. Start sign-in again without restarting the app mid-flow.

### Sign-in completes in browser but the app does not unlock

Check:

- the app is running
- the browser redirected to `http://127.0.0.1:19877/callback?...`
- `bun run auth:diagnose dev` shows `http://127.0.0.1:19877/callback` in Cognito callback URLs
- the `soloide://` scheme is registered on macOS
- `bun run auth:doctor` shows a valid Cognito domain and client ID

### App relaunch forgets the user

Tokens should live in the shared Solo keychain vault under `cognito.*`.
If relaunch does not restore the session, inspect keychain state and rerun the
sign-in flow from a clean app launch.
