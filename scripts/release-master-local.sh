#!/usr/bin/env bash
# Cut and publish a Solo desktop release from master without GitHub Actions.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

if [[ -d "$HOME/.bun/bin" ]]; then
  export PATH="$HOME/.bun/bin:$PATH"
fi
if [[ -d "/opt/homebrew/bin" ]]; then
  export PATH="/opt/homebrew/bin:$PATH"
fi
if [[ -d "/usr/local/bin" ]]; then
  export PATH="/usr/local/bin:$PATH"
fi

PUBLISH_REPO="Solo-UDE/solo-releases"
NOTES=""
NOTES_FILE=""

usage() {
  cat <<EOF
Usage: scripts/release-master-local.sh <version> [options]

Builds, signs, notarizes, publishes the DMG/updater assets, then pushes master
and the source tag. This does not depend on GitHub Actions.

Options:
  --notes <text>         Release notes used for the annotated tag and GitHub release.
  --notes-file <path>    Read release notes from a file.
  --publish-repo <slug>  GitHub releases repo (default: $PUBLISH_REPO).
  -h, --help             Show this help.

Example:
  scripts/release-master-local.sh 0.2.0-beta.4 --notes "Auth fixes and updater hardening"
EOF
}

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 2
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

VERSION="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes)
      [[ $# -ge 2 ]] || { echo "--notes requires a value" >&2; exit 2; }
      NOTES="${2:-}"
      shift 2
      ;;
    --notes-file)
      [[ $# -ge 2 ]] || { echo "--notes-file requires a value" >&2; exit 2; }
      NOTES_FILE="${2:-}"
      shift 2
      ;;
    --publish-repo)
      [[ $# -ge 2 ]] || { echo "--publish-repo requires a value" >&2; exit 2; }
      PUBLISH_REPO="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9_.]+)?$ ]]; then
  echo "Invalid semver version: $VERSION" >&2
  exit 2
fi

if [[ -n "$NOTES" && -n "$NOTES_FILE" ]]; then
  echo "Use either --notes or --notes-file, not both." >&2
  exit 2
fi

if [[ -n "$NOTES_FILE" && ! -f "$NOTES_FILE" ]]; then
  echo "Release notes file not found: $NOTES_FILE" >&2
  exit 2
fi

TAG="v$VERSION"
VERSION_FILES=(
  "Cargo.toml"
  "apps/desktop/package.json"
  "apps/desktop/src-tauri/tauri.conf.json"
)

require_command() {
  command -v "$1" >/dev/null || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

tracked_status() {
  git status --porcelain --untracked-files=no
}

remote_tag_exists() {
  git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1
}

public_release_exists() {
  gh release view "$TAG" --repo "$PUBLISH_REPO" >/dev/null 2>&1
}

write_notes_file() {
  local path="$1"
  if [[ -n "$NOTES_FILE" ]]; then
    cp "$NOTES_FILE" "$path"
  elif [[ -n "$NOTES" ]]; then
    printf "Solo %s\n\n%s\n" "$TAG" "$NOTES" > "$path"
  else
    printf "Solo %s\n\nRelease from master.\n" "$TAG" > "$path"
  fi
}

cleanup_notes=""
cleanup() {
  if [[ -n "$cleanup_notes" && -f "$cleanup_notes" ]]; then
    rm -f "$cleanup_notes"
  fi
}
trap cleanup EXIT

require_command git
require_command bun
require_command gh

echo "==> Switching to master and pulling latest"
git switch master
git pull --ff-only origin master

if [[ "$(git branch --show-current)" != "master" ]]; then
  echo "Release must run on master." >&2
  exit 1
fi

if [[ -n "$(tracked_status)" ]]; then
  echo "Tracked working tree changes exist. Commit or stash them before releasing:" >&2
  tracked_status >&2
  exit 1
fi

echo "==> Checking release does not already exist"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Local tag already exists: $TAG" >&2
  exit 1
fi
if remote_tag_exists; then
  echo "Remote source tag already exists: $TAG" >&2
  exit 1
fi
if public_release_exists; then
  echo "Public release already exists in $PUBLISH_REPO: $TAG" >&2
  exit 1
fi

echo "==> Bumping version to $VERSION"
bun run version:bump "$VERSION"

CHANGED_FILES="$(git diff --name-only)"
if [[ -z "$CHANGED_FILES" ]]; then
  echo "Version files already match $VERSION; no version commit will be created."
else
  while IFS= read -r file; do
    allowed=0
    for allowed_file in "${VERSION_FILES[@]}"; do
      if [[ "$file" == "$allowed_file" ]]; then
        allowed=1
        break
      fi
    done
    if [[ "$allowed" -ne 1 ]]; then
      echo "Version bump touched unexpected file: $file" >&2
      exit 1
    fi
  done <<< "$CHANGED_FILES"

  git add "${VERSION_FILES[@]}"
  git commit -m "release: $TAG"
fi

echo "==> Creating annotated tag $TAG"
cleanup_notes="$(mktemp -t solo-release-notes.XXXXXX)"
write_notes_file "$cleanup_notes"
git tag -a "$TAG" -F "$cleanup_notes"

echo "==> Building, signing, notarizing, and publishing assets"
scripts/release-local.sh \
  --version "$VERSION" \
  --tag "$TAG" \
  --publish \
  --publish-repo "$PUBLISH_REPO"

echo "==> Pushing master and $TAG"
git push origin master
git push origin "$TAG"

echo
echo "==> Release complete"
echo "    Source tag : $TAG"
echo "    Release    : https://github.com/$PUBLISH_REPO/releases/tag/$TAG"
