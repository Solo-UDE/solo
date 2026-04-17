# Solo DMG Distribution & In-App Auto-Update — v0.2.0-beta.1

**Status:** Design approved 2026-04-17
**Release target:** `v0.2.0-beta.1`
**Reference implementation:** `Sachin1801/voiceflow` (VoiceFlow desktop)

## 1. Goal

Ship Solo IDE as a code-signed, notarized macOS DMG, with Tauri's built-in auto-updater so that existing installs upgrade silently on next launch. First release tagged `v0.2.0-beta.1`. The pipeline must run cleanly from a `git push --tags` with no manual intervention between tag-push and a published GitHub Release.

Nothing currently blocks an end user from installing v0.1.x, but:
- Solo's source repo is **private**, so anonymous download of release assets fails.
- The existing `release.yml` references the wrong Apple-secret names and has never run green.
- No GitHub Release has ever been published (despite local `v0.1.0`, `v0.1.1`, `v0.1.2` tags).

## 2. Architecture — two-repo split

```
Solo-UDE/solo (PRIVATE, source)                Solo-UDE/solo-releases (PUBLIC, downloads)
────────────────────────────────                ──────────────────────────────────────────
master branch                                   Release v0.2.0-beta.1
  └─ .github/workflows/release.yml                ├─ Solo_0.2.0-beta.1_aarch64.dmg
       on: push tags: v*                          ├─ Solo.app.tar.gz
       build → sign → notarize → stage            ├─ Solo.app.tar.gz.sig
       publish via RELEASE_PAT ─────────────►    └─ latest.json   ◄── anonymous HTTPS GET
                                                                       (Tauri updater)
```

**Why the split:** Tauri's updater does an anonymous `GET` of `latest.json`. Private repos require auth for release-asset downloads; public repos serve anonymously. Keeping source private while making releases public requires two repos. VoiceFlow uses the same pattern.

## 3. Secrets (all on `Solo-UDE/solo`, repo-level)

| Secret | Source | Scope |
|---|---|---|
| `APPLE_CERTIFICATE_P12` | base64-encoded Developer ID Application `.p12` | Apple signing |
| `APPLE_CERTIFICATE_PASSWORD` | password set when exporting `.p12` | Apple signing |
| `APPLE_ID` | Apple ID email | Notarization |
| `APPLE_APP_PASSWORD` | app-specific password (appleid.apple.com) | Notarization |
| `APPLE_TEAM_ID` | Apple team ID | Notarization |
| `APPLE_SIGN_IDENTITY` | e.g. `"Developer ID Application: Name (TEAM)"` | `codesign` `--sign` value |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/solo-ide.key` | Tauri updater artifact signing |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | empty string | Tauri updater artifact signing |
| `RELEASE_PAT` | fine-grained PAT, `Contents: write` on `Solo-UDE/solo-releases` | Cross-repo publish |

The Apple cert is wildcard per Apple team, so the same `.p12` that signs other apps also signs Solo. `TAURI_SIGNING_PRIVATE_KEY` is app-specific — must be the exact Solo key whose public half is baked into `tauri.conf.json`; using any other key will cause every auto-update to fail signature verification with no in-app recovery path.

Org-level secrets are not used. Solo-UDE is on the GitHub free plan, which does not share org-level secrets with private repos.

## 4. Version strategy

- **Version string:** `0.2.0-beta.1` (semver pre-release; `0.1.2 < 0.2.0-beta.1 < 0.2.0`).
- **Synced across:** root `Cargo.toml`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/package.json`. Script `scripts/bump-version.mjs` writes all three.
- **Git tag:** `v0.2.0-beta.1`, annotated (`git tag -a`) with release notes in the message body.
- **GitHub Release name:** `Solo v0.2.0-beta.1`.
- **GitHub prerelease flag:** **unchecked** (Option A). Tauri's `/releases/latest/` endpoint only serves non-prerelease releases; checking the box would prevent existing v0.1.x installs from auto-updating. The beta status is conveyed by the version string, not the GitHub flag.
- **Release notes:** extracted from the git tag annotation by the workflow (`git tag -l --format='%(contents)' $TAG`) and injected into both `latest.json` and the GitHub Release body.

## 5. Workflow structure

**File:** `.github/workflows/release.yml` (full rewrite, replacing current `tauri-action`-based version).

**Trigger:** `on: push: tags: [v*]` + `workflow_dispatch`.
**Runner:** `macos-14` (pinned, not `latest` — avoids surprise runner-image rolls).
**Timeout:** 45 min.

**Step sequence:**

1. Checkout with `fetch-depth: 0` (needed for tag annotation read).
2. Install Rust stable + `aarch64-apple-darwin` target.
3. Install Bun latest.
4. Cache `~/.cargo` + `target/` via `swatinem/rust-cache`.
5. `bun install`.
6. `bun run gen:bindings`.
7. `cd apps/desktop && bunx tsc --noEmit` — typecheck gate.
8. Validate `SOLO_SUPABASE_URL` / `SOLO_SUPABASE_ANON_KEY` are present (existing guard).
9. Import Apple cert into temp keychain:
   - base64-decode `APPLE_CERTIFICATE_P12` → temp `.p12`
   - `security create-keychain` → random password
   - `security import` with `APPLE_CERTIFICATE_PASSWORD`
   - `security set-key-partition-list` (required for non-interactive signing)
10. `bun tauri build --target aarch64-apple-darwin --bundles app` with `TAURI_SIGNING_*` env vars. Produces just `Solo.app` — DMG and `.tar.gz` are generated in later steps so we control signing order.
11. Code-sign inside-out:
    - Every `.dylib`/`.framework` inside `Solo.app/Contents/Frameworks` first
    - Main `Solo.app` bundle last
    - `--options runtime`, `--entitlements Entitlements.plist`, `--timestamp`
    - `codesign --verify --deep --strict` → fail hard on error
12. Notarize:
    - `ditto -c -k --sequesterRsrc --keepParent Solo.app Solo.zip`
    - `xcrun notarytool submit Solo.zip --apple-id $APPLE_ID --password $APPLE_APP_PASSWORD --team-id $APPLE_TEAM_ID --wait`
    - `xcrun stapler staple Solo.app`
    - `spctl --assess` → fail hard if Gatekeeper would reject
13. Create DMG:
    - Read version from `tauri.conf.json` (jq).
    - Staging folder with `/Applications` symlink for drag-to-install.
    - `hdiutil create -format UDZO -imagekey zlib-level=9 Solo_${VERSION}_aarch64.dmg`
    - Retry up to 3× (runner disk flakiness is a known GitHub-runner issue).
    - `codesign` the DMG itself.
14. Create updater archive:
    - `tar -czf Solo.app.tar.gz Solo.app`
    - `npx @tauri-apps/cli signer sign --private-key $TAURI_SIGNING_PRIVATE_KEY --password $TAURI_SIGNING_PRIVATE_KEY_PASSWORD Solo.app.tar.gz`
    - Produces `Solo.app.tar.gz.sig`
15. Generate `latest.json`:
    ```json
    {
      "version": "0.2.0-beta.1",
      "notes":   "<git tag annotation>",
      "pub_date": "2026-04-17T21:00:00Z",
      "platforms": {
        "darwin-aarch64": {
          "signature": "<contents of Solo.app.tar.gz.sig>",
          "url": "https://github.com/Solo-UDE/solo-releases/releases/download/v0.2.0-beta.1/Solo.app.tar.gz"
        }
      }
    }
    ```
16. Publish to `Solo-UDE/solo-releases`:
    ```bash
    GH_TOKEN=$RELEASE_PAT gh release create "v$VERSION" \
      --repo Solo-UDE/solo-releases \
      --title "Solo v$VERSION" \
      --notes "$(git tag -l --format='%(contents)' v$VERSION)" \
      Solo_${VERSION}_aarch64.dmg Solo.app.tar.gz Solo.app.tar.gz.sig latest.json
    ```
    `RELEASE_PAT` is required because the built-in `GITHUB_TOKEN` only has write access to the workflow's own repo (`Solo-UDE/solo`), not the sibling `solo-releases`.
17. Cleanup keychain (`if: always()`).

**Targets:** `aarch64-apple-darwin` only for v0.2.0-beta.1. Intel (`x86_64-apple-darwin`) and Universal2 can be added as a second matrix entry later if needed.

## 6. Tauri config changes

**File:** `apps/desktop/src-tauri/tauri.conf.json`

- `version` → `"0.2.0-beta.1"`
- `plugins.updater.endpoints[0]` → `"https://github.com/Solo-UDE/solo-releases/releases/latest/download/latest.json"` (was pointing at `Solo-UDE/solo`)
- `plugins.updater.pubkey` → **unchanged** (the embedded pubkey already matches `~/.tauri/solo-ide.key`; changing it would strand v0.1.x installs)
- `bundle.macOS.signingIdentity` → **leave `null`** (actual identity comes from `APPLE_SIGN_IDENTITY` env var used by `codesign` step; we do our own signing, not `tauri-action`'s)

## 7. Workflows kept as-is

- `.github/workflows/premerge-master.yml` — PR gate to master, builds unsigned DMG as an artifact.
- `.github/workflows/build-master-dmg.yml` — post-merge DMG build for internal testing from `master` HEAD.

Neither is part of the release pipeline; they continue to guard day-to-day work.

## 8. Rollout order

```
Phase 0 — Setup (user)
  ✅ 9 secrets on Solo-UDE/solo
  ⬜ Create Solo-UDE/solo-releases (public, empty)

Phase 1 — Code changes (one commit per file, no Claude attribution)
  1. Rewrite .github/workflows/release.yml
  2. Update apps/desktop/src-tauri/tauri.conf.json (endpoint + version)
  3. Bump root Cargo.toml version
  4. Bump apps/desktop/package.json version
  5. Update docs/RELEASES.md (new secret names, new flow)
  6. (Conditional) Patch scripts/bump-version.mjs if it rejects pre-release suffix

Phase 2 — Local verification
  - bun run check
  - bun run gen:bindings (diff must be empty)
  - cargo clippy --workspace

Phase 3 — Ship
  A. Push code commits to master → triggers build-master-dmg.yml (benign)
  B. Draft changelog from `git log v0.1.2..HEAD`; user reviews & approves
  C. git tag -a v0.2.0-beta.1 -m "<changelog>"
  D. git push origin v0.2.0-beta.1 → triggers release.yml

Phase 4 — Monitor & verify
  - gh run watch
  - Verify 4 artifacts on solo-releases (.dmg, .tar.gz, .sig, latest.json)
  - Download DMG, open — Gatekeeper should NOT warn
  - If a v0.1.2 install exists, launch it, confirm auto-update toast + restart flow
```

### User checkpoints

Implementation pauses for the user at:
1. Before `git push master` — diff summary of the 6 commits.
2. Before `git tag` — drafted changelog for review.
3. On workflow failure — specific log lines and proposed fix.

### Failure recovery

If `v0.2.0-beta.1` workflow fails before a release is published (no user has downloaded anything yet), the clean path is:

```bash
git tag -d v0.2.0-beta.1
git push origin :refs/tags/v0.2.0-beta.1
# fix, commit, re-tag, re-push
```

Once a release is public and downloaded, never re-tag — bump to `v0.2.0-beta.2` instead.

## 9. What this design explicitly does NOT include

- Windows / Linux builds (macOS-only for now; Solo is a Mac-first app).
- Intel (x86_64) macOS builds (Apple-Silicon-only; add later if needed).
- Dual stable/beta update channels (single channel; all installs follow `/latest/`).
- Auto-generated changelog from Conventional Commits (hand-written, reviewed).
- Slack / Discord release announcements.
- Download analytics.
- A marketing-site release page.

Each is easy to add once the base pipeline is green.

## 10. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `RELEASE_PAT` lacks cross-repo scope | Medium | Verify with `gh api` before tag push; documented in rollout §8 |
| Notarization fails on entitlements mismatch | Low | Current Entitlements.plist is permissive (network client, JIT); `spctl --assess` gate catches this before publish |
| hdiutil flake | Medium | Built-in 3× retry |
| Wrong minisign key uploaded | Low but catastrophic | Design doc explicitly flags; user already set secret correctly from `~/.tauri/solo-ide.key` |
| Tag-push triggers workflow before secrets are final | Low | All 9 secrets already verified present via `gh secret list` |
| `solo-releases` repo doesn't exist at publish time | Medium (currently true) | Rollout §8 Phase 0 explicitly blocks on this; verified with `gh repo view` before pushing tag |

## 11. File reference

| File | Role |
|---|---|
| `.github/workflows/release.yml` | Tag-triggered build/sign/notarize/publish pipeline |
| `.github/workflows/premerge-master.yml` | PR gate — unchanged |
| `.github/workflows/build-master-dmg.yml` | Post-merge internal DMG — unchanged |
| `apps/desktop/src-tauri/tauri.conf.json` | Updater endpoint, pubkey, version |
| `apps/desktop/src-tauri/Cargo.toml` | Version (inherits from workspace) |
| `apps/desktop/src-tauri/src/update_commands.rs` | Rust updater commands — unchanged |
| `apps/desktop/src-tauri/Entitlements.plist` | macOS entitlements — unchanged |
| `apps/desktop/src/hooks/useUpdateStream.ts` | Frontend update toast — unchanged |
| `Cargo.toml` (workspace) | Version source of truth |
| `apps/desktop/package.json` | Version string (synced) |
| `scripts/bump-version.mjs` | Three-way version sync |
| `docs/RELEASES.md` | Operator-facing release procedure |
| `~/.tauri/solo-ide.key` | Tauri minisign private key (local-only, never committed) |
