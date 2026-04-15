#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "premerge:master requires macOS because it validates the DMG build." >&2
  exit 1
fi

: "${SOLO_SUPABASE_URL:?Missing SOLO_SUPABASE_URL}"
: "${SOLO_SUPABASE_ANON_KEY:?Missing SOLO_SUPABASE_ANON_KEY}"

# Tauri's config loader requires the desktop dist directory to exist even for cargo check.
bun run --filter @solo/desktop build:vite
bun run check
bun run test

cd apps/desktop
bunx tauri build \
  --target aarch64-apple-darwin \
  --bundles dmg \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
