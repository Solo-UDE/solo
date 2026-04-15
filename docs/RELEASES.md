# Release & Distribution Guide

Solo IDE's auto-update and DMG distribution pipeline.

---

## Architecture

```
Developer pushes v* tag
        │
        ▼
GitHub Actions (release.yml)
        │
        ├── Build aarch64 macOS app
        ├── (Phase 2) Sign with Developer ID certificate
        ├── (Phase 2) Notarize with Apple
        ├── Sign update artifacts with Tauri key
        │
        ▼
Draft GitHub Release
        │
        ├── Solo_x.x.x_aarch64.dmg
        ├── Solo.app.tar.gz        (updater payload)
        ├── Solo.app.tar.gz.sig    (updater signature)
        └── latest.json            (updater manifest)
        │
        ▼
Developer reviews draft, publishes
        │
        ▼
Existing installations detect update on next launch
        │
        ▼
User sees toast → clicks "Restart" → app updates
```

---

## Phases

### Phase 1 — Personal Use (no Apple Developer account)

- Unsigned DMG builds via GitHub Actions
- Auto-update works via Tauri RSA signing (independent of Apple)
- Bypass Gatekeeper: right-click → Open (once per install)
- Requires only 2 GitHub secrets

### Phase 2 — Public Distribution (Apple Developer account)

- Code-signed and notarized builds
- No Gatekeeper warnings for end users
- Zero code changes — just add Apple secrets to GitHub
- The workflow conditionally enables Apple signing when secrets are present

---

## GitHub Secrets

### Phase 1 (required now)

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/solo-ide.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Empty string |

## GitHub Variables

These public values are required for desktop authentication builds:

| Variable | Value |
|----------|-------|
| `SOLO_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SOLO_SUPABASE_ANON_KEY` | Supabase anon/public key for that project |

### Phase 2 (add later)

| Secret | Value | How to Get |
|--------|-------|-----------|
| `APPLE_CERTIFICATE` | Base64 `.p12` | `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` export password | Set during export |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAM)` | Keychain Access |
| `APPLE_API_ISSUER` | Issuer ID | App Store Connect |
| `APPLE_API_KEY` | Key ID | App Store Connect |
| `APPLE_API_KEY_CONTENT` | Contents of `.p8` file | `cat AuthKey_XXXX.p8` |

---

## Signing Keys

Generated with `bun tauri signer generate -w ~/.tauri/solo-ide.key --ci`.

| File | Purpose | Location |
|------|---------|----------|
| `solo-ide.key` | Private key (signs updates) | `~/.tauri/solo-ide.key` (never commit) |
| `solo-ide.key.pub` | Public key (verifies updates) | `~/.tauri/solo-ide.key.pub` + `tauri.conf.json` |

To regenerate with a password:
```bash
bun tauri signer generate -w ~/.tauri/solo-ide.key -f -p "your-password"
```
Then update the public key in `tauri.conf.json` and the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret.

---

## How to Release

```bash
# 1. Bump version everywhere
bun run version:bump 0.2.0

# 2. Commit and tag
git add Cargo.toml apps/desktop/src-tauri/tauri.conf.json apps/desktop/package.json
git commit -m "Release v0.2.0"
git tag v0.2.0

# 3. Push (triggers CI)
git push origin master --tags

# 4. Review draft release on GitHub → add changelog → Publish
```

---

## Local Development Build

```bash
# Unsigned build (no signing needed)
bun tauri build

# With updater artifacts (needs Tauri key)
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/solo-ide.key)"
bun tauri build

# Output:
#   target/release/bundle/macos/Solo.app
#   target/release/bundle/dmg/Solo_0.1.0_aarch64.dmg
#   target/release/bundle/macos/Solo.app.tar.gz      (updater payload)
#   target/release/bundle/macos/Solo.app.tar.gz.sig   (updater signature)
```

---

## Update Flow

1. User launches Solo IDE
2. After 5 seconds, `useUpdateStream` calls `checkForUpdate()`
3. Rust fetches `latest.json` from GitHub Releases
4. If newer version found → emits `BackendEvent::UpdateAvailable`
5. Frontend shows persistent toast: "New update available"
6. User clicks "Restart" → downloads `.tar.gz`, verifies `.sig`, installs, restarts
7. User clicks "See changes" → opens GitHub Release page in browser

---

## File Reference

| File | Role |
|------|------|
| `apps/desktop/src-tauri/src/update_commands.rs` | Rust update commands |
| `apps/desktop/src-tauri/tauri.conf.json` | Updater config, public key, endpoints |
| `apps/desktop/src-tauri/Entitlements.plist` | macOS entitlements for code signing |
| `apps/desktop/src-tauri/capabilities/default.json` | Updater + process permissions |
| `apps/desktop/src-tauri/Cargo.toml` | Plugin dependencies |
| `apps/desktop/src/hooks/useUpdateStream.ts` | Frontend update check + toast |
| `apps/desktop/src/lib/tauri/update.ts` | TypeScript IPC wrappers |
| `apps/desktop/src/App.tsx` | Mounts `useUpdateStream()` |
| `.github/workflows/release.yml` | CI/CD release pipeline |
| `scripts/bump-version.mjs` | Version bump across all manifests |
| `~/.tauri/solo-ide.key` | Private signing key (local, never committed) |

---

## Apple Developer Setup (Phase 2)

1. Enroll at https://developer.apple.com/programs/ ($99/year, up to 48h approval)
2. Create "Developer ID Application" certificate in Certificates, Identifiers & Profiles
3. Export as `.p12` from Keychain Access
4. Create App Store Connect API key (Users & Access → Integrations)
5. Add all Phase 2 secrets to GitHub
