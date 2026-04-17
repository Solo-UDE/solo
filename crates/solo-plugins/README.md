# solo-plugins

Plugin manifest parsing, local store, toggles, and multi-root adapter discovery
for Solo IDE.

## Provenance

This crate includes code hard-forked from the [codex-rs](https://github.com/openai/codex) repository (licensed under Apache-2.0). Upstream sources, per module:

- `src/id.rs` — `codex-rs/plugin/src/plugin_id.rs` (crate `codex-plugin`)
- `src/path.rs` — `codex-rs/utils/absolute-path/src/lib.rs` (crate `codex-utils-absolute-path`)
- `src/manifest.rs` — `codex-rs/core-plugins/src/manifest.rs` (crate `codex-core-plugins`)
- `src/store.rs` — `codex-rs/core-plugins/src/store.rs` (crate `codex-core-plugins`)

The fork drops all `codex-*` crate dependencies by inlining the minimal subset Solo actually needs. Stub module files (`adapters.rs`, `toggles.rs`, `loader.rs`) are written from scratch for Solo and carry no upstream provenance.
