//! Per-plugin enable/disable state persisted to ~/.solo/plugins/toggles.json.
//!
//! Keyed by PluginId::as_key() — "marketplace/name". Missing entries default
//! to "enabled"; callers pass their own default via `enabled_for`.

use crate::id::PluginId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const TOGGLES_FILE: &str = "toggles.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginToggles {
    #[serde(default)]
    entries: HashMap<String, PluginToggleEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginToggleEntry {
    pub enabled: bool,
}

impl PluginToggles {
    /// Load toggles.json from `~/.solo/plugins/`. Missing file → empty state.
    /// Malformed file → empty state + warning log.
    pub fn load(solo_plugins_dir: &Path) -> Self {
        let path = solo_plugins_dir.join(TOGGLES_FILE);
        let Ok(raw) = std::fs::read_to_string(&path) else {
            return Self::default();
        };
        if raw.trim().is_empty() {
            return Self::default();
        }
        match serde_json::from_str(&raw) {
            Ok(parsed) => parsed,
            Err(err) => {
                tracing::warn!(
                    path = %path.display(),
                    "failed to parse toggles.json, using empty state: {err}"
                );
                Self::default()
            }
        }
    }

    /// Persist to `~/.solo/plugins/toggles.json`, creating the directory if needed.
    pub fn save(&self, solo_plugins_dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(solo_plugins_dir)?;
        let path: PathBuf = solo_plugins_dir.join(TOGGLES_FILE);
        let serialized = serde_json::to_string_pretty(self)?;
        std::fs::write(path, serialized)
    }

    pub fn enabled_for(&self, id: &PluginId, default: bool) -> bool {
        self.entries
            .get(&id.as_key())
            .map(|entry| entry.enabled)
            .unwrap_or(default)
    }

    pub fn set_enabled(&mut self, id: &PluginId, enabled: bool) {
        self.entries.insert(id.as_key(), PluginToggleEntry { enabled });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn id(marketplace: &str, name: &str) -> PluginId {
        PluginId::new(marketplace.into(), name.into()).unwrap()
    }

    #[test]
    fn missing_file_returns_empty() {
        let tmp = tempdir().unwrap();
        let toggles = PluginToggles::load(tmp.path());
        assert!(toggles.entries.is_empty());
    }

    #[test]
    fn default_for_unknown_plugin() {
        let tmp = tempdir().unwrap();
        let toggles = PluginToggles::load(tmp.path());
        assert!(toggles.enabled_for(&id("local", "x"), true));
        assert!(!toggles.enabled_for(&id("local", "x"), false));
    }

    #[test]
    fn round_trip_persists_state() {
        let tmp = tempdir().unwrap();
        let mut toggles = PluginToggles::default();
        toggles.set_enabled(&id("local", "a"), true);
        toggles.set_enabled(&id("local", "b"), false);
        toggles.save(tmp.path()).unwrap();

        let reloaded = PluginToggles::load(tmp.path());
        assert!(reloaded.enabled_for(&id("local", "a"), false));
        assert!(!reloaded.enabled_for(&id("local", "b"), true));
    }

    #[test]
    fn malformed_file_returns_empty_without_panic() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join("toggles.json"), "not valid json").unwrap();
        let toggles = PluginToggles::load(tmp.path());
        assert!(toggles.entries.is_empty());
    }

    #[test]
    fn empty_file_returns_empty() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join("toggles.json"), "").unwrap();
        let toggles = PluginToggles::load(tmp.path());
        assert!(toggles.entries.is_empty());
    }
}
