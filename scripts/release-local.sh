#!/usr/bin/env bash
# Local mirror of .github/workflows/release.yml.
# Builds, signs, notarizes, DMG-packages, and (optionally) publishes a Solo
# release without consuming GitHub Actions minutes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# -------- defaults --------
TARGET="aarch64-apple-darwin"
SKIP_NOTARIZE=0
SKIP_UPDATER=0
PUBLISH=0
PUBLISH_REPO="Solo-UDE/solo-releases"
EXPLICIT_VERSION=""
EXPLICIT_TAG=""
DIST_DIR="dist"

usage() {
  cat <<EOF
Usage: scripts/release-local.sh [options]

Mirrors .github/workflows/release.yml locally. Produces a signed, notarized
DMG (and optional updater artifacts) and may publish to a Releases repo.

Options:
  --skip-notarize        Skip Apple notarization + stapling. Faster, but the
                         DMG will trigger a Gatekeeper warning on first launch.
  --skip-updater         Skip Tauri updater tarball + signature + latest.json.
  --publish              Upload assets via 'gh release create' to --publish-repo.
                         Default is dry-run (no upload).
  --publish-repo <slug>  Target repo (default: $PUBLISH_REPO).
  --version <x.y.z>      Override version from tauri.conf.json.
  --tag <tag>            Override tag name (default: v<version>).
  --target <triple>      Rust target (default: $TARGET).
  -h, --help             Show this help.

Env (shell or scripts/.env.release — gitignored):
  SOLO_COGNITO_DOMAIN, SOLO_COGNITO_CLIENT_ID, SOLO_AWS_REGION, SOLO_API_ENDPOINT
  APPLE_SIGN_IDENTITY        e.g. "Developer ID Application: Foo (ABC123XYZ)"
  APPLE_ID, APPLE_APP_PASSWORD, APPLE_TEAM_ID   (unless --skip-notarize)
  TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD  (unless --skip-updater)
  GH_TOKEN                   (only if --publish and gh-cli not logged in)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-notarize) SKIP_NOTARIZE=1; shift ;;
    --skip-updater)  SKIP_UPDATER=1;  shift ;;
    --publish)       PUBLISH=1;       shift ;;
    --publish-repo)  PUBLISH_REPO="$2"; shift 2 ;;
    --version)       EXPLICIT_VERSION="$2"; shift 2 ;;
    --tag)           EXPLICIT_TAG="$2"; shift 2 ;;
    --target)        TARGET="$2"; shift 2 ;;
    -h|--help)       usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# -------- env loading --------
if [[ -f scripts/.env.release ]]; then
  echo "==> Loading scripts/.env.release"
  set -a; source scripts/.env.release; set +a
fi

# -------- preflight --------
[[ "$(uname -s)" == "Darwin" ]] || { echo "release-local.sh requires macOS" >&2; exit 1; }
command -v jq   >/dev/null || { echo "jq required (brew install jq)"   >&2; exit 1; }
command -v bun  >/dev/null || { echo "bun required"                     >&2; exit 1; }

: "${SOLO_COGNITO_DOMAIN:?missing (embedded at build time)}"
: "${SOLO_COGNITO_CLIENT_ID:?missing}"
: "${SOLO_AWS_REGION:?missing}"
: "${SOLO_API_ENDPOINT:?missing}"
: "${APPLE_SIGN_IDENTITY:?missing — 'Developer ID Application: ...' identity}"

# The cert must already be in the login keychain (no import dance like CI).
if ! security find-identity -v -p codesigning | grep -q "$APPLE_SIGN_IDENTITY"; then
  echo "Signing identity not found in login keychain:" >&2
  echo "  $APPLE_SIGN_IDENTITY" >&2
  echo "List identities with: security find-identity -v -p codesigning" >&2
  exit 1
fi

if [[ $SKIP_NOTARIZE -eq 0 ]]; then
  : "${APPLE_ID:?missing (or pass --skip-notarize)}"
  : "${APPLE_APP_PASSWORD:?missing (app-specific password, not Apple ID pw)}"
  : "${APPLE_TEAM_ID:?missing}"
fi

if [[ $SKIP_UPDATER -eq 0 ]]; then
  : "${TAURI_SIGNING_PRIVATE_KEY:?missing (or pass --skip-updater)}"
  : "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:?missing}"
fi

if [[ $PUBLISH -eq 1 ]]; then
  command -v gh >/dev/null || { echo "gh CLI required for --publish" >&2; exit 1; }
  gh auth status >/dev/null 2>&1 || [[ -n "${GH_TOKEN:-}" ]] || {
    echo "gh CLI not logged in and GH_TOKEN not set" >&2; exit 1;
  }
fi

# -------- derive version / paths --------
VERSION="${EXPLICIT_VERSION:-$(jq -r .version apps/desktop/src-tauri/tauri.conf.json)}"
TAG_NAME="${EXPLICIT_TAG:-v$VERSION}"
APP_PATH="target/$TARGET/release/bundle/macos/Solo.app"
DMG_NAME="Solo_${VERSION}_aarch64.dmg"

echo "==> Version : $VERSION"
echo "==> Tag     : $TAG_NAME"
echo "==> Target  : $TARGET"
echo "==> Publish : $([[ $PUBLISH -eq 1 ]] && echo "yes → $PUBLISH_REPO" || echo "no (dry build)")"
echo

STAGING_DIR=""
cleanup() { [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]] && rm -rf "$STAGING_DIR"; }
trap cleanup EXIT

# -------- [1/7] deps + bindings + typecheck --------
echo "==> [1/7] bun install + gen:bindings + tsc"
bun install
bun run gen:bindings
( cd apps/desktop && bunx tsc --noEmit )

# -------- [2/7] unsigned .app --------
echo "==> [2/7] Building unsigned .app"
rm -rf "$APP_PATH"
( cd apps/desktop && bunx tauri build --target "$TARGET" --bundles app \
    --config '{"bundle":{"createUpdaterArtifacts":false}}' )
[[ -d "$APP_PATH" ]] || { echo "App bundle missing at $APP_PATH" >&2; exit 1; }

# -------- [3/7] inside-out codesign --------
# Frameworks/dylibs first, then the outer .app with entitlements; signing outer
# before inner invalidates the outer bundle's resource hashes.
echo "==> [3/7] Code-signing"
FRAMEWORKS="$APP_PATH/Contents/Frameworks"
if [[ -d "$FRAMEWORKS" ]]; then
  find "$FRAMEWORKS" -type f \( -name "*.dylib" -o -name "*.so" \) -print0 | \
    xargs -0 -I {} codesign --force --sign "$APPLE_SIGN_IDENTITY" \
      --options runtime --timestamp "{}"
  find "$FRAMEWORKS" -type d -name "*.framework" -print0 | \
    xargs -0 -I {} codesign --force --sign "$APPLE_SIGN_IDENTITY" \
      --options runtime --timestamp "{}"
fi
codesign --force --deep --sign "$APPLE_SIGN_IDENTITY" \
  --options runtime --timestamp \
  --entitlements apps/desktop/src-tauri/Entitlements.plist \
  "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

# -------- [4/7] notarize + staple --------
if [[ $SKIP_NOTARIZE -eq 0 ]]; then
  echo "==> [4/7] Notarizing (Apple round-trip, 2-10 min)"
  NOTARIZE_ZIP="$(mktemp -t solo-notarize).zip"
  ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$NOTARIZE_ZIP"
  xcrun notarytool submit "$NOTARIZE_ZIP" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
  rm -f "$NOTARIZE_ZIP"
  xcrun stapler staple "$APP_PATH"
  spctl --assess --type execute --verbose=4 "$APP_PATH" || {
    echo "Gatekeeper rejected the notarized app" >&2; exit 1;
  }
else
  echo "==> [4/7] Skipping notarization (--skip-notarize)"
fi

# -------- [5/7] DMG --------
echo "==> [5/7] Creating DMG"
STAGING_DIR="$(mktemp -d -t solo-dmg-staging)"
cp -R "$APP_PATH" "$STAGING_DIR/Solo.app"
ln -s /Applications "$STAGING_DIR/Applications"
mkdir -p "$DIST_DIR"
DMG_PATH="$DIST_DIR/$DMG_NAME"
rm -f "$DMG_PATH"

# hdiutil occasionally flakes with "Resource busy" on CI; retry locally too.
for attempt in 1 2 3; do
  if hdiutil create -volname "Solo" -srcfolder "$STAGING_DIR" \
      -ov -format UDZO -imagekey zlib-level=9 "$DMG_PATH"; then
    break
  fi
  [[ $attempt -eq 3 ]] && { echo "hdiutil failed 3x" >&2; exit 1; }
  rm -f "$DMG_PATH"; sleep 5
done
codesign --force --sign "$APPLE_SIGN_IDENTITY" --timestamp "$DMG_PATH"

# -------- [6/7] updater tarball + latest.json --------
if [[ $SKIP_UPDATER -eq 0 ]]; then
  echo "==> [6/7] Building updater tarball + latest.json"
  TAR_PATH="$DIST_DIR/Solo.app.tar.gz"
  rm -f "$TAR_PATH" "$TAR_PATH.sig"
  tar -czf "$TAR_PATH" -C "$(dirname "$APP_PATH")" "$(basename "$APP_PATH")"
  ( cd apps/desktop && bunx tauri signer sign \
      --private-key "$TAURI_SIGNING_PRIVATE_KEY" \
      --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
      "../../$TAR_PATH" )
  [[ -f "$TAR_PATH.sig" ]] || { echo "Missing $TAR_PATH.sig" >&2; exit 1; }

  SIGNATURE="$(cat "$TAR_PATH.sig")"
  PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  NOTES="$(git tag -l --format='%(contents)' "$TAG_NAME" 2>/dev/null || true)"
  [[ -n "$NOTES" ]] || NOTES="Solo $VERSION"
  URL="https://github.com/$PUBLISH_REPO/releases/download/$TAG_NAME/Solo.app.tar.gz"

  jq -n \
    --arg version   "$VERSION" \
    --arg notes     "$NOTES" \
    --arg pub_date  "$PUB_DATE" \
    --arg signature "$SIGNATURE" \
    --arg url       "$URL" \
    '{
      version: $version,
      notes: $notes,
      pub_date: $pub_date,
      platforms: { "darwin-aarch64": { signature: $signature, url: $url } }
    }' > "$DIST_DIR/latest.json"
else
  echo "==> [6/7] Skipping updater artifacts (--skip-updater)"
fi

# -------- [7/7] publish --------
if [[ $PUBLISH -eq 1 ]]; then
  echo "==> [7/7] Publishing $TAG_NAME to $PUBLISH_REPO"
  NOTES="$(git tag -l --format='%(contents)' "$TAG_NAME" 2>/dev/null || true)"
  [[ -n "$NOTES" ]] || NOTES="Solo $VERSION"

  ASSETS=( "$DIST_DIR/$DMG_NAME" )
  if [[ $SKIP_UPDATER -eq 0 ]]; then
    ASSETS+=( "$DIST_DIR/Solo.app.tar.gz" "$DIST_DIR/Solo.app.tar.gz.sig" "$DIST_DIR/latest.json" )
  fi

  gh release create "$TAG_NAME" \
    --repo "$PUBLISH_REPO" \
    --title "Solo v$VERSION" \
    --notes "$NOTES" \
    "${ASSETS[@]}"
else
  echo "==> [7/7] Skipping publish (pass --publish to upload)"
fi

echo
echo "==> Done"
echo "    DMG      : $DIST_DIR/$DMG_NAME"
if [[ $SKIP_UPDATER -eq 0 ]]; then
  echo "    Updater  : $DIST_DIR/Solo.app.tar.gz (+ .sig)"
  echo "    Manifest : $DIST_DIR/latest.json"
fi
[[ $PUBLISH -eq 0 ]] && echo "    (dry build — nothing uploaded)"
