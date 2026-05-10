//! Plugin discovery, cache, and toggle management for Solo IDE.
//!
//! See `docs/superpowers/specs/2026-04-17-solo-plugins-foundation-design.md`
//! for the full design. Module provenance is documented per-module.

pub mod adapters;
pub mod apps;
pub mod id;
pub mod loader;
pub mod manifest;
pub mod mcp;
pub mod path;
pub mod store;
pub mod toggles;

pub use adapters::{discover_claude_adapter, discover_codex_adapter, AdapterPlugin, AdapterSource};
pub use apps::{load_plugin_apps, PluginAppDeclaration, PluginAppsLoadResult};
pub use id::{validate_plugin_segment, PluginId, PluginIdError};
pub use loader::{
    get_plugin_detail, list_plugins, LoaderConfig, PluginListOutcome, PluginLoadError,
    PluginRecord, PluginSource,
};
pub use manifest::{
    find_plugin_manifest_path, load_plugin_manifest, PluginManifest, PluginManifestInterface,
    PluginManifestPaths,
};
pub use mcp::{
    expand_mcp_server_config, load_plugin_mcp, normalize_mcp_servers, PluginMcpLoadResult,
};
pub use path::AbsolutePathBuf;
pub use store::{PluginInstallResult, PluginStore, PluginStoreError};
pub use toggles::{PluginToggleEntry, PluginToggles};
