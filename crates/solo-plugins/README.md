# solo-plugins

Plugin manifest parsing, local store, toggles, and multi-root adapter discovery
for Solo IDE.

## Provenance

Portions of this crate (`manifest.rs`, `store.rs`, `id.rs`, `path.rs`) are
hard-forked from [codex-rs](https://github.com/openai/codex) `core-plugins`
and related utility crates, which are licensed under Apache-2.0. See the
module-level doc comments for the specific upstream source file each module
originated from. The fork drops all `codex-*` crate dependencies by inlining
the minimal subset Solo actually needs.
