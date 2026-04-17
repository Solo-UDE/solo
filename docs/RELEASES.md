# Release & Distribution Guide

Solo IDE's auto-update and DMG distribution pipeline.

---

## Architecture

```
Solo-UDE/solo  (private source)              Solo-UDE/solo-releases  (public downloads)
───────────────────────────                  ────────────────────────────────────────
  push tag v*
        │
        ▼
  .github/workflows/release.yml
        │
        ├── build .app (Tauri, aarch64-apple-darwin)
        ├── code-sign with Developer ID Application (inside-out)
        ├── notarize via xcrun notarytool (blocking)
        ├── staple ticket + spctl assess
        ├── create DMG, code-sign DMG
        ├── create Solo.app.tar.gz, minisign with Tauri key
        ├── generate latest.json
        │
        └──────► publish via RELEASE_PAT ─────►  GitHub Release
                                                    - Solo_X.Y.Z_aarch64.dmg
                                                    - Solo.app.tar.gz
                                                    - Solo.app.tar.gz.sig
                                                    - latest.json
                                                        ▲
                                                        │ anonymous HTTPS GET
                                                        │
                                                Installed Solo checks
                                                `/releases/latest/download/latest.json`
                                                on next launch → toast → update
```

Why the two-repo split: Tauri's updater does an anonymous `GET` for `latest.json`. GitHub blocks anonymous downloads from private-repo release assets, so the source repo stays private while a public sibling hosts the downloads.

---

## GitHub Secrets (on Solo-UDE/solo, repo-level)

| Secret | Value | Source |
|---|---|---|
| `APPLE_CERTIFICATE_P12` | base64-encoded `.p12` | `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` export password | set during Keychain export |
| `APPLE_ID` | Apple ID email | — |
| `APPLE_APP_PASSWORD` | app-specific password | appleid.apple.com → Sign-In and Security |
| `APPLE_TEAM_ID` | Apple team identifier | developer.apple.com → Membership |
| `APPLE_SIGN_IDENTITY` | `Developer ID Application: Name (TEAM)` | `security find-identity -v -p codesigning` |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/solo-ide.key` | `cat ~/.tauri/solo-ide.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | empty string | (key generated without password) |
| `RELEASE_PAT` | fine-grained PAT with `Contents: write` on Solo-UDE/solo-releases | github.com/settings/personal-access-tokens/new |

## GitHub Variables (on Solo-UDE/solo, repo-level)

| Variable | Value |
|---|---|
| `SOLO_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SOLO_SUPABASE_ANON_KEY` | Supabase anon/public key |

---

## Tauri signing keys

Private key `~/.tauri/solo-ide.key` is the minisign key that signs `Solo.app.tar.gz`. Its public half is base64-embedded in `apps/desktop/src-tauri/tauri.conf.json` under `plugins.updater.pubkey` — every installed Solo verifies updates against that pubkey.

**Never regenerate this key.** Changing it would strand every existing install (they would reject every future update as "invalid signature") with no in-app recovery path.

Back up `~/.tauri/solo-ide.key` to a password manager or encrypted archive.

---

## How to release

```bash
# 1. Bump version across Cargo.toml, tauri.conf.json, apps/desktop/package.json
bun run version:bump 0.3.0           # or 0.3.0-beta.1 for a beta

# 2. Commit the 3-file bump (one commit per file is the project convention)
git add Cargo.toml
git commit -m "release: bump workspace version to 0.3.0"
git add apps/desktop/src-tauri/tauri.conf.json
git commit -m "release: bump tauri.conf.json version to 0.3.0"
git add apps/desktop/package.json
git commit -m "release: bump desktop app version to 0.3.0"

# 3. Draft a changelog and annotate the tag with it
git tag -a v0.3.0 -m "$(cat <<'EOF'
Solo v0.3.0

- Feature X
- Fix Y
EOF
)"

# 4. Push master and the tag (tag push triggers release.yml)
git push origin master
git push origin v0.3.0

# 5. Monitor the build
gh run watch --repo Solo-UDE/solo

# 6. Verify the release on solo-releases
gh release view v0.3.0 --repo Solo-UDE/solo-releases
```

---

## Pre-release (beta) versions

Semver pre-release suffixes work: `0.3.0-beta.1`, `0.3.0-rc.2`, etc. Semver ordering is `0.2.0 < 0.3.0-beta.1 < 0.3.0`, so existing stable installs will auto-update to betas as long as:

- The GitHub "Set as a pre-release" checkbox on the Release is **unchecked** (the workflow leaves it unchecked by default).

If you want a gated beta channel where only opted-in users see betas, that is a larger design change — a dual-channel `latest-stable.json` / `latest-beta.json` split with channel-selector UI. Not implemented.

---

## Update flow (end user)

1. User launches Solo.
2. 5 s after launch, `useUpdateStream` calls `check_for_update()`.
3. Rust fetches `https://github.com/Solo-UDE/solo-releases/releases/latest/download/latest.json`.
4. If `latest.json.version > installed-version`, emits `BackendEvent::UpdateAvailable`.
5. Frontend shows persistent toast: "New update available".
6. User clicks "Restart" → Tauri downloads `.tar.gz`, verifies `.sig` against pubkey, swaps app, restarts.
7. User clicks "See changes" → opens GitHub Release page in browser.

---

## Local development build (unsigned)

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/solo-ide.key)"
bun tauri build

# Output:
#   target/release/bundle/macos/Solo.app
#   target/release/bundle/dmg/Solo_X.Y.Z_aarch64.dmg      (unsigned, right-click-open)
#   target/release/bundle/macos/Solo.app.tar.gz           (updater payload)
#   target/release/bundle/macos/Solo.app.tar.gz.sig       (updater signature)
```

Use this to sanity-check changes locally before tagging. For Apple-signed builds, only CI produces them (requires the keychain dance in `release.yml`).

---

## File reference

| File | Role |
|---|---|
| `apps/desktop/src-tauri/src/update_commands.rs` | Rust update commands |
| `apps/desktop/src-tauri/tauri.conf.json` | Updater endpoint, pubkey, version |
| `apps/desktop/src-tauri/Entitlements.plist` | macOS entitlements for code signing |
| `apps/desktop/src-tauri/capabilities/default.json` | Updater + process permissions |
| `apps/desktop/src-tauri/Cargo.toml` | Plugin dependencies |
| `apps/desktop/src/hooks/useUpdateStream.ts` | Frontend update toast |
| `apps/desktop/src/lib/tauri/update.ts` | TypeScript IPC wrappers |
| `apps/desktop/src/App.tsx` | Mounts `useUpdateStream()` |
| `.github/workflows/release.yml` | CI/CD release pipeline |
| `scripts/bump-version.mjs` | Version bump across all manifests |
| `~/.tauri/solo-ide.key` | Private signing key (local, never committed) |
| `docs/superpowers/specs/2026-04-17-solo-dmg-autoupdate-design.md` | Design rationale |
| `docs/superpowers/plans/2026-04-17-solo-dmg-autoupdate.md` | Implementation plan |

---

## Failure recovery

### Workflow fails before release is published

Delete the tag, fix, re-tag:

```bash
git tag -d v0.X.Y
git push origin :refs/tags/v0.X.Y
# fix, commit
git tag -a v0.X.Y -m "..."
git push origin v0.X.Y
```

### Workflow succeeded but release is broken (DMG bad, latest.json malformed, etc.)

**Never re-tag a public release.** Bump the patch (e.g., `v0.X.Y+1`), cut a new release. Delete the broken GitHub Release from solo-releases so the updater does not see it:

```bash
gh release delete vX.Y.Z --repo Solo-UDE/solo-releases --yes
```

### Notarization fails

Read the submission log for the specific rejection:

```bash
xcrun notarytool log <submission-id> \
  --apple-id "$APPLE_ID" --password "$APPLE_APP_PASSWORD" --team-id "$APPLE_TEAM_ID"
```

Common causes: unsigned `.dylib` inside Frameworks (workflow should have caught it), entitlements mismatch, expired cert.
