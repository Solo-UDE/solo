//! Plugin discovery, cache, and toggle management for Solo IDE.
//!
//! See `docs/superpowers/specs/2026-04-17-solo-plugins-foundation-design.md`
//! for the full design. Module provenance is documented per-module.

pub mod adapters;
pub mod id;
pub mod loader;
pub mod manifest;
pub mod path;
pub mod store;
pub mod toggles;

pub use id::{PluginId, PluginIdError, validate_plugin_segment};
