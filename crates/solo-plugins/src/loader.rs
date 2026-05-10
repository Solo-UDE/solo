//! Plugin discovery orchestrator.
//!
//! Merges Solo's PluginStore with read-only adapters, applies toggles, and
//! returns a list suitable for the Tauri command layer.

use crate::adapters::{discover_claude_adapter, discover_codex_adapter, AdapterSource};
use crate::id::PluginId;
use crate::manifest::{load_plugin_manifest, PluginManifest};
use crate::store::PluginStore;
use crate::toggles::PluginToggles;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub struct LoaderConfig<'a> {
    pub solo_home: &'a Path,
    pub claude_plugins_dir: Option<PathBuf>,
    pub codex_cache_dir: Option<PathBuf>,
    pub adapter_claude_plugins: bool,
    pub adapter_codex_user: bool,
}

#[derive(Debug, Clone)]
pub struct PluginRecord {
    pub id: PluginId,
    pub version: String,
    pub root: PathBuf,
    pub manifest: Option<PluginManifest>,
    pub source: PluginSource,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginSource {
    Local,
    Marketplace,
    ClaudeAdapter,
    CodexAdapter,
}

#[derive(Debug, Clone)]
pub struct PluginLoadError {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Debug, Clone, Default)]
pub struct PluginListOutcome {
    pub plugins: Vec<PluginRecord>,
    pub errors: Vec<PluginLoadError>,
}

pub fn list_plugins(config: LoaderConfig<'_>) -> PluginListOutcome {
    let solo_plugins_dir = config.solo_home.join("plugins");
    let store = PluginStore::new(solo_plugins_dir.clone());
    let toggles = PluginToggles::load(&solo_plugins_dir);
    let mut seen: HashSet<String> = HashSet::new();
    let mut outcome = PluginListOutcome::default();

    // 1. Solo-native cache first (first-wins).
    for (id, version, root, source) in collect_store(&store, &mut outcome.errors) {
        let key = id.as_key();
        if !seen.insert(key) {
            continue;
        }
        push_record(&mut outcome, id, version, root, source, &toggles);
    }

    // 2. Claude adapter.
    if config.adapter_claude_plugins {
        if let Some(dir) = config.claude_plugins_dir {
            for adapter in discover_claude_adapter(&dir) {
                let key = adapter.id.as_key();
                if !seen.insert(key) {
                    continue;
                }
                let version = adapter_version(&adapter.root);
                let source = match adapter.source {
                    AdapterSource::Claude => PluginSource::ClaudeAdapter,
                    AdapterSource::Codex => PluginSource::CodexAdapter, // not reachable here
                };
                push_record(
                    &mut outcome,
                    adapter.id,
                    version,
                    adapter.root,
                    source,
                    &toggles,
                );
            }
        }
    }

    // 3. Codex adapter.
    if config.adapter_codex_user {
        if let Some(dir) = config.codex_cache_dir {
            for adapter in discover_codex_adapter(&dir) {
                let key = adapter.id.as_key();
                if !seen.insert(key) {
                    continue;
                }
                let version = adapter
                    .root
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("local")
                    .to_string();
                push_record(
                    &mut outcome,
                    adapter.id,
                    version,
                    adapter.root,
                    PluginSource::CodexAdapter,
                    &toggles,
                );
            }
        }
    }

    // Sort: enabled first, then alphabetical by name.
    outcome.plugins.sort_by(|a, b| {
        b.enabled
            .cmp(&a.enabled)
            .then_with(|| a.id.name.cmp(&b.id.name))
    });

    outcome
}

fn collect_store(
    store: &PluginStore,
    errors: &mut Vec<PluginLoadError>,
) -> Vec<(PluginId, String, PathBuf, PluginSource)> {
    let mut out = Vec::new();
    let Ok(marketplaces) = std::fs::read_dir(store.root()) else {
        return out;
    };
    for mk_entry in marketplaces.flatten() {
        if !mk_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(marketplace) = mk_entry.file_name().to_str().map(ToString::to_string) else {
            continue;
        };
        let Ok(plugins) = std::fs::read_dir(mk_entry.path()) else {
            continue;
        };
        for plugin_entry in plugins.flatten() {
            if !plugin_entry
                .file_type()
                .map(|t| t.is_dir())
                .unwrap_or(false)
            {
                continue;
            }
            let Some(name) = plugin_entry.file_name().to_str().map(ToString::to_string) else {
                continue;
            };
            let Ok(id) = PluginId::new(marketplace.clone(), name) else {
                errors.push(PluginLoadError {
                    path: plugin_entry.path(),
                    message: "plugin directory name violates PluginId segment rules".to_string(),
                });
                continue;
            };
            let Some(version) = store.active_plugin_version(&id) else {
                continue;
            };
            let root = store.plugin_root(&id, &version);
            let source = if id.marketplace == "local" {
                PluginSource::Local
            } else {
                PluginSource::Marketplace
            };
            out.push((id, version, root, source));
        }
    }
    out
}

fn adapter_version(root: &Path) -> String {
    load_plugin_manifest(root)
        .and_then(|m| m.version)
        .unwrap_or_else(|| "local".to_string())
}

fn push_record(
    outcome: &mut PluginListOutcome,
    id: PluginId,
    version: String,
    root: PathBuf,
    source: PluginSource,
    toggles: &PluginToggles,
) {
    let manifest = load_plugin_manifest(&root);
    if manifest.is_none() {
        outcome.errors.push(PluginLoadError {
            path: root.clone(),
            message: "missing or invalid plugin manifest".to_string(),
        });
    }
    let enabled = toggles.enabled_for(&id, true);
    outcome.plugins.push(PluginRecord {
        id,
        version,
        root,
        manifest,
        source,
        enabled,
    });
}

pub fn get_plugin_detail(config: LoaderConfig<'_>, id: &PluginId) -> Option<PluginRecord> {
    list_plugins(config)
        .plugins
        .into_iter()
        .find(|r| &r.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_plugin(root: &Path, manifest_name: &str) {
        fs::create_dir_all(root.join(".solo-plugin")).unwrap();
        fs::write(
            root.join(".solo-plugin/plugin.json"),
            format!(r#"{{"name":"{manifest_name}"}}"#),
        )
        .unwrap();
    }

    fn make_config<'a>(solo_home: &'a Path) -> LoaderConfig<'a> {
        LoaderConfig {
            solo_home,
            claude_plugins_dir: None,
            codex_cache_dir: None,
            adapter_claude_plugins: false,
            adapter_codex_user: false,
        }
    }

    #[test]
    fn empty_everything_returns_empty() {
        let tmp = tempdir().unwrap();
        let out = list_plugins(make_config(tmp.path()));
        assert!(out.plugins.is_empty());
        assert!(out.errors.is_empty());
    }

    #[test]
    fn solo_cache_plugins_discovered() {
        let tmp = tempdir().unwrap();
        let plugin_root = tmp.path().join("plugins/cache/local/alpha/local");
        write_plugin(&plugin_root, "alpha");

        let out = list_plugins(make_config(tmp.path()));
        assert_eq!(out.plugins.len(), 1);
        assert_eq!(out.plugins[0].id.name, "alpha");
        assert_eq!(out.plugins[0].source, PluginSource::Local);
    }

    #[test]
    fn adapter_gated_by_config() {
        let tmp = tempdir().unwrap();
        let claude_dir = tmp.path().join("claude");
        let plugin_dir = tmp.path().join("claude-plugin");
        write_plugin(&plugin_dir, "from-claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("installed_plugins.json"),
            format!(
                r#"{{"plugins":{{"user":[{{"installPath":"{}"}}]}}}}"#,
                plugin_dir.display()
            ),
        )
        .unwrap();

        // Claude adapter OFF → empty.
        let cfg_off = LoaderConfig {
            solo_home: tmp.path(),
            claude_plugins_dir: Some(claude_dir.clone()),
            codex_cache_dir: None,
            adapter_claude_plugins: false,
            adapter_codex_user: false,
        };
        assert!(list_plugins(cfg_off).plugins.is_empty());

        // Claude adapter ON → one plugin.
        let cfg_on = LoaderConfig {
            solo_home: tmp.path(),
            claude_plugins_dir: Some(claude_dir),
            codex_cache_dir: None,
            adapter_claude_plugins: true,
            adapter_codex_user: false,
        };
        let out = list_plugins(cfg_on);
        assert_eq!(out.plugins.len(), 1);
        assert_eq!(out.plugins[0].source, PluginSource::ClaudeAdapter);
    }

    #[test]
    fn solo_wins_on_id_collision() {
        let tmp = tempdir().unwrap();
        // Solo-native plugin with marketplace "claude-user" name "dup".
        let solo_plugin = tmp.path().join("plugins/cache/claude-user/dup/local");
        write_plugin(&solo_plugin, "dup");
        // Claude adapter fixture with same id.
        let claude_dir = tmp.path().join("claude");
        let ext_dup = tmp.path().join("dup");
        write_plugin(&ext_dup, "dup");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("installed_plugins.json"),
            format!(
                r#"{{"plugins":{{"user":[{{"installPath":"{}"}}]}}}}"#,
                ext_dup.display()
            ),
        )
        .unwrap();

        let cfg = LoaderConfig {
            solo_home: tmp.path(),
            claude_plugins_dir: Some(claude_dir),
            codex_cache_dir: None,
            adapter_claude_plugins: true,
            adapter_codex_user: false,
        };
        let out = list_plugins(cfg);
        assert_eq!(out.plugins.len(), 1);
        // Solo wins: marketplace is "claude-user" (a synthetic name in the solo cache),
        // but since it's from the Solo cache its source is Marketplace (not Local, since
        // marketplace != "local").
        assert_eq!(out.plugins[0].source, PluginSource::Marketplace);
    }

    #[test]
    fn malformed_plugin_surfaces_as_error_not_failure() {
        let tmp = tempdir().unwrap();
        // good plugin
        let good = tmp.path().join("plugins/cache/local/good/local");
        write_plugin(&good, "good");
        // bad plugin: no manifest at all
        let bad = tmp.path().join("plugins/cache/local/bad/local");
        fs::create_dir_all(&bad).unwrap();

        let out = list_plugins(make_config(tmp.path()));
        assert_eq!(out.plugins.len(), 2); // both surface as records
        assert_eq!(out.errors.len(), 1);
        assert!(out.errors[0].path.ends_with("bad/local"));
    }

    #[test]
    fn toggles_applied_in_records() {
        let tmp = tempdir().unwrap();
        let plugin_root = tmp.path().join("plugins/cache/local/alpha/local");
        write_plugin(&plugin_root, "alpha");
        // Flip alpha to disabled.
        let mut toggles = PluginToggles::default();
        toggles.set_enabled(
            &PluginId::new("local".into(), "alpha".into()).unwrap(),
            false,
        );
        toggles.save(&tmp.path().join("plugins")).unwrap();

        let out = list_plugins(make_config(tmp.path()));
        assert_eq!(out.plugins.len(), 1);
        assert!(!out.plugins[0].enabled);
    }

    #[test]
    fn sort_puts_enabled_first_then_alphabetical() {
        let tmp = tempdir().unwrap();
        for name in ["zebra", "alpha", "beta"] {
            let root = tmp.path().join(format!("plugins/cache/local/{name}/local"));
            write_plugin(&root, name);
        }
        // Disable alpha.
        let mut toggles = PluginToggles::default();
        toggles.set_enabled(
            &PluginId::new("local".into(), "alpha".into()).unwrap(),
            false,
        );
        toggles.save(&tmp.path().join("plugins")).unwrap();

        let out = list_plugins(make_config(tmp.path()));
        assert_eq!(
            out.plugins
                .iter()
                .map(|r| r.id.name.as_str())
                .collect::<Vec<_>>(),
            vec!["beta", "zebra", "alpha"],
        );
    }
}
