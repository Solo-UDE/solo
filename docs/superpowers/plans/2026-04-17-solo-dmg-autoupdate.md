# Solo DMG + Auto-Update Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Solo IDE as a code-signed, notarized macOS DMG with Tauri auto-updates; publish v0.2.0-beta.1 as the first green end-to-end release.

**Architecture:** Two-repo split — private `Solo-UDE/solo` (source + CI) publishes artifacts via `RELEASE_PAT` to public `Solo-UDE/solo-releases` (downloads + `latest.json`). A `macos-14` GitHub runner builds → signs inside-out → notarizes via `notarytool --wait` → staples → DMGs → minisigns the updater `.tar.gz` → publishes. Existing `~/.tauri/solo-ide.key` (already embedded as pubkey in `tauri.conf.json`) is preserved so v0.1.x installs can verify v0.2.0-beta.1 updates.

**Tech Stack:** Tauri 2, Rust, Bun, GitHub Actions, `xcrun notarytool`, `codesign`, `hdiutil`, `gh` CLI.

**Spec:** [`docs/superpowers/specs/2026-04-17-solo-dmg-autoupdate-design.md`](../specs/2026-04-17-solo-dmg-autoupdate-design.md)

**Prerequisites (already verified):**
- ✅ 9 secrets on `Solo-UDE/solo` (`APPLE_CERTIFICATE_P12`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_SIGN_IDENTITY`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `RELEASE_PAT`)
- ✅ `Solo-UDE/solo-releases` public repo exists
- ✅ `~/.tauri/solo-ide.key` present locally (the minisign private key)
- ✅ `scripts/bump-version.mjs` supports pre-release semver (`0.2.0-beta.1` valid)

**Commit style:** One commit per file, no Claude attribution (per user's persistent preferences).

**File structure after plan:**

| File | Change |
|---|---|
| `apps/desktop/src-tauri/tauri.conf.json` | MODIFY — version + updater endpoint |
| `Cargo.toml` | MODIFY — workspace version |
| `apps/desktop/package.json` | MODIFY — version |
| `.github/workflows/release.yml` | REWRITE — voiceflow-style pipeline |
| `docs/RELEASES.md` | MODIFY — new secret names + operator flow |
| `.github/workflows/premerge-master.yml` | UNCHANGED |
| `.github/workflows/build-master-dmg.yml` | UNCHANGED |
| `apps/desktop/src-tauri/Entitlements.plist` | UNCHANGED |
| `apps/desktop/src-tauri/src/update_commands.rs` | UNCHANGED |
| `apps/desktop/src/hooks/useUpdateStream.ts` | UNCHANGED |

---

## Task 1: Update `tauri.conf.json` — version + updater endpoint

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`

- [ ] **Step 1: Make the two edits**

Change line 4 (version):
```diff
-  "version": "0.1.0",
+  "version": "0.2.0-beta.1",
```

Change line 66 (endpoint inside `plugins.updater.endpoints`):
```diff
-        "https://github.com/Solo-UDE/solo/releases/latest/download/latest.json"
+        "https://github.com/Solo-UDE/solo-releases/releases/latest/download/latest.json"
```

**Do NOT change** `plugins.updater.pubkey` — the existing value corresponds to `~/.tauri/solo-ide.key` and is what v0.1.x installs expect.

- [ ] **Step 2: Validate JSON**

Run: `jq empty apps/desktop/src-tauri/tauri.conf.json && echo OK`
Expected: `OK` (no parse error).

- [ ] **Step 3: Verify values**

Run:
```bash
jq -r '.version, .plugins.updater.endpoints[0]' apps/desktop/src-tauri/tauri.conf.json
```
Expected:
```
0.2.0-beta.1
https://github.com/Solo-UDE/solo-releases/releases/latest/download/latest.json
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/tauri.conf.json
git commit -m "release: bump version and point updater at solo-releases"
```

---

## Task 2: Bump root workspace `Cargo.toml` version

**Files:**
- Modify: `Cargo.toml` (single `version = "..."` line under `[workspace.package]`)

- [ ] **Step 1: Edit the version line**

Change:
```diff
-version = "0.1.0"
+version = "0.2.0-beta.1"
```

(There is exactly one such line in the root `Cargo.toml`; all workspace crates inherit via `version.workspace = true`.)

- [ ] **Step 2: Verify**

Run: `grep -n '^version = ' Cargo.toml`
Expected: `<line>:version = "0.2.0-beta.1"`

- [ ] **Step 3: Commit**

```bash
git add Cargo.toml
git commit -m "release: bump workspace version to 0.2.0-beta.1"
```

---

## Task 3: Bump `apps/desktop/package.json` version

**Files:**
- Modify: `apps/desktop/package.json` (the `"version"` field)

- [ ] **Step 1: Edit**

Change:
```diff
-  "version": "0.1.0",
+  "version": "0.2.0-beta.1",
```

- [ ] **Step 2: Verify**

Run: `jq -r .version apps/desktop/package.json`
Expected: `0.2.0-beta.1`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json
git commit -m "release: bump desktop app version to 0.2.0-beta.1"
```

---

## Task 4: Rewrite `.github/workflows/release.yml`

**Files:**
- Rewrite: `.github/workflows/release.yml`

This replaces Solo's `tauri-action`-based workflow with a VoiceFlow-style custom pipeline matching the 9 repo secrets you already have.

- [ ] **Step 1: Replace the file contents**

Write the following, verbatim, to `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build-and-release:
    runs-on: macos-14
    timeout-minutes: 45
    permissions:
      contents: write
    env:
      APPLE_ID: ${{ secrets.APPLE_ID }}
      APPLE_APP_PASSWORD: ${{ secrets.APPLE_APP_PASSWORD }}
      APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      APPLE_SIGN_IDENTITY: ${{ secrets.APPLE_SIGN_IDENTITY }}
      APPLE_CERTIFICATE_P12: ${{ secrets.APPLE_CERTIFICATE_P12 }}
      APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
      RELEASE_PAT: ${{ secrets.RELEASE_PAT }}
      SOLO_SUPABASE_URL: ${{ vars.SOLO_SUPABASE_URL }}
      SOLO_SUPABASE_ANON_KEY: ${{ vars.SOLO_SUPABASE_ANON_KEY }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin

      - name: Install bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: . -> target

      - name: Install frontend dependencies
        run: bun install

      - name: Generate TypeScript bindings
        run: bun run gen:bindings

      - name: Typecheck frontend
        run: cd apps/desktop && bunx tsc --noEmit

      - name: Validate desktop auth config
        run: |
          test -n "$SOLO_SUPABASE_URL" || { echo "Missing SOLO_SUPABASE_URL" >&2; exit 1; }
          test -n "$SOLO_SUPABASE_ANON_KEY" || { echo "Missing SOLO_SUPABASE_ANON_KEY" >&2; exit 1; }

      - name: Import Apple certificate
        run: |
          CERTIFICATE_PATH=$RUNNER_TEMP/certificate.p12
          KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
          KEYCHAIN_PASSWORD=$(openssl rand -base64 32)

          echo -n "$APPLE_CERTIFICATE_P12" | base64 --decode -o $CERTIFICATE_PATH

          security create-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
          security set-keychain-settings -lut 21600 $KEYCHAIN_PATH
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH

          security import "$CERTIFICATE_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" \
            -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
          security set-key-partition-list -S apple-tool:,apple: \
            -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security list-keychain -d user -s "$KEYCHAIN_PATH"

      - name: Build Tauri app (unsigned .app only)
        run: |
          cd apps/desktop
          bunx tauri build --target aarch64-apple-darwin --bundles app

      - name: Code-sign app (inside-out)
        run: |
          APP_PATH="target/aarch64-apple-darwin/release/bundle/macos/Solo.app"
          test -d "$APP_PATH" || { echo "App bundle not found at $APP_PATH" >&2; exit 1; }

          FRAMEWORKS="$APP_PATH/Contents/Frameworks"
          if [ -d "$FRAMEWORKS" ]; then
            find "$FRAMEWORKS" -type f \( -name "*.dylib" -o -name "*.so" \) -print0 | \
              xargs -0 -r -I {} codesign --force --sign "$APPLE_SIGN_IDENTITY" \
                --options runtime --timestamp "{}"
            find "$FRAMEWORKS" -type d -name "*.framework" -print0 | \
              xargs -0 -r -I {} codesign --force --sign "$APPLE_SIGN_IDENTITY" \
                --options runtime --timestamp "{}"
          fi

          codesign --force --deep --sign "$APPLE_SIGN_IDENTITY" \
            --options runtime --timestamp \
            --entitlements apps/desktop/src-tauri/Entitlements.plist \
            "$APP_PATH"

          codesign --verify --deep --strict --verbose=2 "$APP_PATH"

      - name: Notarize and staple
        run: |
          APP_PATH="target/aarch64-apple-darwin/release/bundle/macos/Solo.app"
          ZIP_PATH="$RUNNER_TEMP/Solo.zip"

          ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

          xcrun notarytool submit "$ZIP_PATH" \
            --apple-id "$APPLE_ID" \
            --password "$APPLE_APP_PASSWORD" \
            --team-id "$APPLE_TEAM_ID" \
            --wait

          xcrun stapler staple "$APP_PATH"
          spctl --assess --type execute --verbose=4 "$APP_PATH" || {
            echo "Gatekeeper assessment failed" >&2
            exit 1
          }

      - name: Create DMG
        run: |
          VERSION=$(jq -r .version apps/desktop/src-tauri/tauri.conf.json)
          echo "VERSION=$VERSION" >> $GITHUB_ENV

          APP_PATH="target/aarch64-apple-darwin/release/bundle/macos/Solo.app"
          STAGING="$RUNNER_TEMP/dmg-staging"
          DMG_NAME="Solo_${VERSION}_aarch64.dmg"
          DMG_PATH="$RUNNER_TEMP/$DMG_NAME"

          mkdir -p "$STAGING"
          cp -R "$APP_PATH" "$STAGING/Solo.app"
          ln -s /Applications "$STAGING/Applications"

          for attempt in 1 2 3; do
            if hdiutil create -volname "Solo" -srcfolder "$STAGING" \
                -ov -format UDZO -imagekey zlib-level=9 "$DMG_PATH"; then
              break
            fi
            if [ "$attempt" -eq 3 ]; then
              echo "hdiutil failed after 3 attempts" >&2
              exit 1
            fi
            rm -f "$DMG_PATH"
            sleep 5
          done

          codesign --force --sign "$APPLE_SIGN_IDENTITY" --timestamp "$DMG_PATH"

          mkdir -p dist
          mv "$DMG_PATH" "dist/$DMG_NAME"
          echo "DMG_NAME=$DMG_NAME" >> $GITHUB_ENV

      - name: Create updater archive and sign
        run: |
          APP_PATH="target/aarch64-apple-darwin/release/bundle/macos/Solo.app"
          TAR_PATH="dist/Solo.app.tar.gz"

          tar -czf "$TAR_PATH" -C "$(dirname "$APP_PATH")" "$(basename "$APP_PATH")"

          cd apps/desktop
          bunx tauri signer sign \
            --private-key "$TAURI_SIGNING_PRIVATE_KEY" \
            --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
            "../../$TAR_PATH"

          test -f "../../${TAR_PATH}.sig" || {
            echo "Expected ../../${TAR_PATH}.sig to exist" >&2
            exit 1
          }

      - name: Generate latest.json
        run: |
          TAG_NAME="v${VERSION}"
          SIGNATURE=$(cat dist/Solo.app.tar.gz.sig)
          PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

          NOTES=$(git tag -l --format='%(contents)' "$TAG_NAME")
          if [ -z "$NOTES" ]; then
            NOTES="Solo $VERSION"
          fi

          jq -n \
            --arg version "$VERSION" \
            --arg notes "$NOTES" \
            --arg pub_date "$PUB_DATE" \
            --arg signature "$SIGNATURE" \
            --arg url "https://github.com/Solo-UDE/solo-releases/releases/download/${TAG_NAME}/Solo.app.tar.gz" \
            '{
              version: $version,
              notes: $notes,
              pub_date: $pub_date,
              platforms: {
                "darwin-aarch64": {
                  signature: $signature,
                  url: $url
                }
              }
            }' > dist/latest.json

          cat dist/latest.json

      - name: Publish release to solo-releases
        run: |
          TAG_NAME="v${VERSION}"
          NOTES=$(git tag -l --format='%(contents)' "$TAG_NAME")
          if [ -z "$NOTES" ]; then
            NOTES="Solo $VERSION"
          fi

          GH_TOKEN="$RELEASE_PAT" gh release create "$TAG_NAME" \
            --repo Solo-UDE/solo-releases \
            --title "Solo v$VERSION" \
            --notes "$NOTES" \
            "dist/$DMG_NAME" \
            dist/Solo.app.tar.gz \
            dist/Solo.app.tar.gz.sig \
            dist/latest.json

      - name: Cleanup keychain
        if: always()
        run: |
          security delete-keychain "$RUNNER_TEMP/app-signing.keychain-db" 2>/dev/null || true
```

- [ ] **Step 2: YAML syntax check**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Verify secret names are consistent with what's set**

Run:
```bash
grep -oE '\$\{\{ secrets\.[A-Z_]+ \}\}' .github/workflows/release.yml | sort -u
```
Expected output (9 unique secret references):
```
${{ secrets.APPLE_APP_PASSWORD }}
${{ secrets.APPLE_CERTIFICATE_P12 }}
${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
${{ secrets.APPLE_ID }}
${{ secrets.APPLE_SIGN_IDENTITY }}
${{ secrets.APPLE_TEAM_ID }}
${{ secrets.RELEASE_PAT }}
${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

Cross-check against GitHub:
```bash
gh secret list --repo Solo-UDE/solo | awk '{print $1}' | sort
```
The set of names must match exactly.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): voiceflow-style build/sign/notarize pipeline"
```

---

## Task 5: Update `docs/RELEASES.md`

**Files:**
- Modify: `docs/RELEASES.md`

Align the operator docs with the new pipeline so a future you (or teammate) knows what the actual secret names, release URL, and steps are.

- [ ] **Step 1: Replace `docs/RELEASES.md` with the following**

```markdown
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

Back up `~/.tauri/solo-ide.key` to a password manager / encrypted archive.

---

## How to release

```bash
# 1. Bump version across Cargo.toml, tauri.conf.json, apps/desktop/package.json
bun run version:bump 0.3.0           # or 0.3.0-beta.1 for a beta

# 2. Commit the 3-file bump
git add Cargo.toml apps/desktop/src-tauri/tauri.conf.json apps/desktop/package.json
git commit -m "release: bump to 0.3.0"

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

If you want a gated beta channel where only opted-in users see betas, that's a larger design change — a dual-channel `latest-stable.json` / `latest-beta.json` split with channel-selector UI. Not implemented.

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

**Never re-tag a public release.** Bump the patch (e.g., `v0.X.Y+1`), cut a new release. Delete the broken GitHub Release from solo-releases so the updater doesn't see it:

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
```

- [ ] **Step 2: Commit**

```bash
git add docs/RELEASES.md
git commit -m "docs(releases): document voiceflow-style pipeline and new secret names"
```

---

## Task 6: Local verification gate before pushing master

**No file changes.** Sanity-check that the code compiles, types check, and generated bindings are in sync.

- [ ] **Step 1: Regenerate bindings and verify diff is empty**

Run:
```bash
cd /Users/sachin/Developer/Orbit_Main/solo
bun run gen:bindings
git diff --stat apps/desktop/src/bindings/
```
Expected: empty (no output). If non-empty, someone forgot to regenerate — commit the diff as its own commit, then continue.

- [ ] **Step 2: Cargo check**

Run: `cargo check --workspace`
Expected: 0 errors, warnings permitted.

- [ ] **Step 3: TypeScript typecheck**

Run: `cd apps/desktop && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Clippy (same lints as CI would enforce)**

Run: `cargo clippy --workspace --all-targets`
Expected: 0 errors. Existing warnings are acceptable; any NEW warnings introduced by your commits should be fixed.

- [ ] **Step 5: Confirm the 5 new commits are queued on master**

Run: `git log origin/master..HEAD --oneline`
Expected: 5 commits (one per file) — Tasks 1, 2, 3, 4, 5. Example:
```
<sha> docs(releases): document voiceflow-style pipeline and new secret names
<sha> ci(release): voiceflow-style build/sign/notarize pipeline
<sha> release: bump desktop app version to 0.2.0-beta.1
<sha> release: bump workspace version to 0.2.0-beta.1
<sha> release: bump version and point updater at solo-releases
```

(The design-doc commit `408bb255` is already on master, so it will not appear here.)

---

## Task 7: Push the 5 code commits to master

**No file changes.**

- [ ] **Step 1: Confirm nothing else is staged**

Run: `git status`
Expected: "nothing to commit, working tree clean" — any other edits should be set aside first.

- [ ] **Step 2: Push master (no tag yet)**

Run: `git push origin master`
Expected: 5 new commits pushed. This triggers `.github/workflows/build-master-dmg.yml` which builds an internal DMG artifact — that's expected and OK; it does not publish a release.

- [ ] **Step 3: Verify the build-master-dmg workflow starts**

Run: `gh run list --workflow=build-master-dmg.yml --repo Solo-UDE/solo --limit 1`
Expected: one run in `in_progress` status tied to the latest master commit.

This step is informational; it does not block Task 8.

---

## Task 8: Draft the v0.2.0-beta.1 changelog

**No file changes.** This task produces the tag annotation body.

- [ ] **Step 1: Generate a commit summary since v0.1.2**

Run:
```bash
git log v0.1.2..HEAD --oneline --no-merges | wc -l
git log v0.1.2..HEAD --oneline --no-merges | awk '{$1=""; print}' | sort -u > /tmp/solo-commits.txt
wc -l /tmp/solo-commits.txt
head -20 /tmp/solo-commits.txt
```

- [ ] **Step 2: Categorize into a changelog**

Group commits into four buckets: **Features**, **UI/design**, **Fixes**, **Internal**. Ignore: merge commits, WIP commits, reverts.

Write the changelog to `/tmp/solo-v0.2.0-beta.1-changelog.txt` in this exact format:

```
Solo v0.2.0-beta.1 — Desktop beta

First code-signed and notarized macOS release. Existing v0.1.x installs will auto-update on next launch.

Highlights since v0.1.2:

Features
- <bullet>
- <bullet>

UI
- <bullet>
- <bullet>

Fixes
- <bullet>

Internal
- <bullet>
```

- [ ] **Step 3: Pause — show the changelog to the user for approval**

Print the drafted file and ask for sign-off before proceeding to tag.

```bash
cat /tmp/solo-v0.2.0-beta.1-changelog.txt
```

**DO NOT proceed to Task 9 until the user explicitly approves the changelog wording.**

---

## Task 9: Create annotated tag and push

**No file changes.**

- [ ] **Step 1: Create the annotated tag with the approved changelog as the message**

Run:
```bash
git tag -a v0.2.0-beta.1 -F /tmp/solo-v0.2.0-beta.1-changelog.txt
git tag -l --format='%(contents)' v0.2.0-beta.1 | head -20
```
Expected: first 20 lines of your changelog echoed back (sanity check that the annotation stuck).

- [ ] **Step 2: Push the tag**

Run: `git push origin v0.2.0-beta.1`
Expected: `* [new tag] v0.2.0-beta.1 -> v0.2.0-beta.1`. This triggers `.github/workflows/release.yml`.

- [ ] **Step 3: Confirm the release workflow started**

Run: `gh run list --workflow=release.yml --repo Solo-UDE/solo --limit 1`
Expected: one run in `in_progress` with `head_branch=v0.2.0-beta.1`.

---

## Task 10: Monitor the release workflow and triage failures

**No file changes.** This task can take 20–40 min.

- [ ] **Step 1: Stream the run**

Run:
```bash
RUN_ID=$(gh run list --workflow=release.yml --repo Solo-UDE/solo --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --repo Solo-UDE/solo --exit-status
```
Expected: exits 0 on success. If it fails, `gh run watch` prints the failed step name.

- [ ] **Step 2: If failure, fetch logs for the failing step**

Run:
```bash
gh run view "$RUN_ID" --repo Solo-UDE/solo --log-failed | tail -200
```

Common failure recipes:

| Failure signal | Likely cause | Fix |
|---|---|---|
| `notarytool submit ... status: Invalid` | Unsigned `.dylib` inside app bundle | Check `codesign --verify --deep --strict` output; extend inside-out find to cover the offending file type |
| `hdiutil: could not access` | Runner disk flake | Workflow retries 3×. If still fails, re-run the job (`gh run rerun $RUN_ID`) |
| `gh: HTTP 403: Resource not accessible by personal access token` on publish step | RELEASE_PAT missing `Contents: write` on solo-releases, or token expired | Regenerate PAT with correct scope, update secret, re-run |
| `security: SecKeychainSetKeychainListDomain` | Keychain partition list step failed | Very rarely this; re-run usually fixes |
| `bunx tauri signer sign: error: unknown option '--password'` | CLI flag name changed | Fall back to `--private-key-password` or run `bunx tauri signer sign --help` to discover the current flag |

- [ ] **Step 3: If the failure is in the code or workflow, recover by fixing and re-tagging**

Only if **no release has been published yet** on solo-releases (check with `gh release list --repo Solo-UDE/solo-releases`):

```bash
git tag -d v0.2.0-beta.1
git push origin :refs/tags/v0.2.0-beta.1
# fix the bug, commit (one file per commit)
git tag -a v0.2.0-beta.1 -F /tmp/solo-v0.2.0-beta.1-changelog.txt
git push origin v0.2.0-beta.1
```

If a release WAS published but has bad artifacts, bump to `v0.2.0-beta.2` instead:

```bash
# Edit the 3 version files to 0.2.0-beta.2 (3 commits, one per file)
# Then tag + push as normal
```

- [ ] **Step 4: On success, verify run duration and artifacts**

Run: `gh run view "$RUN_ID" --repo Solo-UDE/solo`
Expected: all steps green, total duration 15–40 min.

---

## Task 11: Verify the release artifacts on solo-releases

**No file changes.**

- [ ] **Step 1: Confirm the release exists with all 4 assets**

Run:
```bash
gh release view v0.2.0-beta.1 --repo Solo-UDE/solo-releases
```
Expected: release named `Solo v0.2.0-beta.1`, `isPrerelease: false`, 4 assets:
- `Solo_0.2.0-beta.1_aarch64.dmg`
- `Solo.app.tar.gz`
- `Solo.app.tar.gz.sig`
- `latest.json`

- [ ] **Step 2: Verify latest.json is accessible anonymously**

Run in a clean shell (unset auth env vars just to be safe):
```bash
env -i PATH=/usr/bin:/bin curl -sSfL \
  "https://github.com/Solo-UDE/solo-releases/releases/latest/download/latest.json" | jq .
```
Expected: pretty-printed JSON with `version: "0.2.0-beta.1"`, correct signature/url fields. This is the exact request path Tauri's updater will make.

- [ ] **Step 3: Verify the .tar.gz URL in latest.json is reachable anonymously**

Run:
```bash
URL=$(curl -sSfL https://github.com/Solo-UDE/solo-releases/releases/latest/download/latest.json | jq -r '.platforms."darwin-aarch64".url')
curl -sSfLI "$URL" | head -5
```
Expected: `HTTP/2 200` (after redirect) and a `content-length` matching the actual `.tar.gz` size.

---

## Task 12: Smoke-test the DMG locally and the auto-update path

**No file changes.** Manual verification.

- [ ] **Step 1: Download the DMG and validate Gatekeeper does not warn**

Run:
```bash
DMG_URL=$(gh release view v0.2.0-beta.1 --repo Solo-UDE/solo-releases --json assets \
  --jq '.assets[] | select(.name | endswith(".dmg")) | .url')
curl -sSfLo /tmp/Solo-test.dmg "$DMG_URL"
spctl --assess --type open --context context:primary-signature --verbose=2 /tmp/Solo-test.dmg
```
Expected: `/tmp/Solo-test.dmg: accepted` and `source=Notarized Developer ID`. If it prints `rejected`, notarization did not staple or signing was broken — re-run Task 10.

- [ ] **Step 2: Double-click the DMG and drag Solo.app to /Applications**

Manual step. Launch Solo from /Applications. Expected: app opens without any "damaged / cannot be opened" dialog — this confirms the end-user install experience.

- [ ] **Step 3: (Optional) Test the auto-update path from v0.1.2**

Only possible if you still have a v0.1.2 install on disk (or can install one from a prior local build). Launch that older Solo; within 10 seconds the in-app toast should show "New update available" with version `0.2.0-beta.1`. Click "Restart". The app should download, verify signature, swap, and relaunch into v0.2.0-beta.1. Verify the new version string in About / Settings.

If no v0.1.2 install is available, skip this step — the Task 11 Step 2 verification already proves `latest.json` is reachable, which is the one surface Tauri's updater hits.

---

## Self-Review (completed)

- **Spec coverage:** every spec section (architecture, secrets, version strategy, workflow structure, tauri.conf changes, kept workflows, rollout, risks) maps to a concrete task above.
- **Placeholders:** none — every step has concrete commands, expected output, and file content.
- **Type consistency:** secret names, file paths, tag name, URL, env-var names are spelled identically across tasks (cross-checked `APPLE_SIGN_IDENTITY`, `solo-releases`, `v0.2.0-beta.1`, `Solo.app.tar.gz`).
- **One task skipped by design:** spec referenced "patch bump-version.mjs if needed" — verified during planning that the script already supports semver pre-release (`/^\d+\.\d+\.\d+(-[\w.]+)?$/`), so no task was created. Documented here for traceability.
