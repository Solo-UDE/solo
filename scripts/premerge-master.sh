#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "premerge:master requires macOS because it validates the DMG build." >&2
  exit 1
fi

: "${SOLO_COGNITO_DOMAIN:?Missing SOLO_COGNITO_DOMAIN}"
: "${SOLO_COGNITO_CLIENT_ID:?Missing SOLO_COGNITO_CLIENT_ID}"
: "${SOLO_AWS_REGION:?Missing SOLO_AWS_REGION}"
: "${SOLO_API_ENDPOINT:?Missing SOLO_API_ENDPOINT}"
: "${SOLO_VAULT_API_ENDPOINT:?Missing SOLO_VAULT_API_ENDPOINT}"

if [[ "${CI:-}" == "true" ]]; then
  cargo clean -p ort-sys -p sherpa-rs-sys
fi

# Tauri's config loader requires the desktop dist directory to exist even for cargo check.
bun run --filter @solo/desktop build:vite
bun run check
bun run test

cd apps/desktop
bunx tauri build \
  --target aarch64-apple-darwin \
  --bundles dmg \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
