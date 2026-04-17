//! Read-only discovery of Claude and codex plugin directories.
//!
//! Solo never writes to these roots. Output is fed into loader.rs which
//! merges with the Solo-native PluginStore and applies toggles.

use crate::id::PluginId;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct AdapterPlugin {
    pub id: PluginId,
    pub root: PathBuf,
    pub source: AdapterSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterSource {
    Claude,
    Codex,
}

// ─── Claude adapter ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct ClaudeInstalledFile {
    #[serde(default)]
    plugins: std::collections::HashMap<String, Vec<ClaudeInstallEntry>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeInstallEntry {
    install_path: String,
    #[serde(default)]
    marketplace_name: Option<String>,
}

/// Discover plugins via `~/.claude/plugins/installed_plugins.json`.
/// Returns an empty vec if the file is missing or malformed.
pub fn discover_claude_adapter(claude_plugins_dir: &Path) -> Vec<AdapterPlugin> {
    let manifest = claude_plugins_dir.join("installed_plugins.json");
    let Ok(raw) = std::fs::read_to_string(&manifest) else {
        return Vec::new();
    };
    let parsed: ClaudeInstalledFile = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                path = %manifest.display(),
                "failed to parse installed_plugins.json: {err}"
            );
            return Vec::new();
        }
    };

    let mut out = Vec::new();
    for (scope, entries) in parsed.plugins {
        for entry in entries {
            let root = PathBuf::from(&entry.install_path);
            if !root.is_dir() {
                continue;
            }
            let name = match root.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let marketplace = entry
                .marketplace_name
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    if scope == "user" {
                        "claude-user".to_string()
                    } else {
                        "claude-plugins".to_string()
                    }
                });
            let Ok(id) = PluginId::new(sanitize(&marketplace), sanitize(&name)) else {
                continue;
            };
            out.push(AdapterPlugin {
                id,
                root,
                source: AdapterSource::Claude,
            });
        }
    }
    out
}

/// Replace characters that aren't valid in a PluginId segment with '-'.
fn sanitize(raw: &str) -> String {
    raw.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

// ─── Codex adapter ──────────────────────────────────────────────────

/// Walk codex's `~/.codex/plugins/cache/<mk>/<name>/<ver>/` layout.
/// For each (marketplace, name) pair, pick the active version using the same
/// local-wins-then-lexicographic rule as PluginStore::active_plugin_version.
pub fn discover_codex_adapter(codex_cache_dir: &Path) -> Vec<AdapterPlugin> {
    let mut out = Vec::new();
    let Ok(marketplaces) = std::fs::read_dir(codex_cache_dir) else {
        return out;
    };

    for mk in marketplaces.flatten() {
        if !mk.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let marketplace_name = match mk.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue,
        };

        let Ok(plugins) = std::fs::read_dir(mk.path()) else {
            continue;
        };
        for plugin in plugins.flatten() {
            if !plugin.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let plugin_name = match plugin.file_name().into_string() {
                Ok(n) => n,
                Err(_) => continue,
            };

            let active_version = pick_active_version(&plugin.path());
            let Some(version) = active_version else {
                continue;
            };
            let root = plugin.path().join(&version);
            let Ok(id) = PluginId::new(sanitize(&marketplace_name), sanitize(&plugin_name)) else {
                continue;
            };
            out.push(AdapterPlugin {
                id,
                root,
                source: AdapterSource::Codex,
            });
        }
    }
    out
}

fn pick_active_version(plugin_dir: &Path) -> Option<String> {
    let mut versions: Vec<String> = std::fs::read_dir(plugin_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.file_type().ok().is_some_and(|t| t.is_dir()))
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    versions.sort_unstable();
    if versions.is_empty() {
        None
    } else if versions.iter().any(|v| v == "local") {
        Some("local".to_string())
    } else {
        versions.pop()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_claude_fixture(root: &Path, json: &str, plugin_dirs: &[&str]) {
        fs::create_dir_all(root).unwrap();
        fs::write(root.join("installed_plugins.json"), json).unwrap();
        for dir in plugin_dirs {
            fs::create_dir_all(PathBuf::from(*dir)).unwrap();
        }
    }

    #[test]
    fn missing_manifest_returns_empty() {
        let tmp = tempdir().unwrap();
        let out = discover_claude_adapter(tmp.path());
        assert!(out.is_empty());
    }

    #[test]
    fn malformed_manifest_returns_empty() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("installed_plugins.json"), "not json").unwrap();
        assert!(discover_claude_adapter(tmp.path()).is_empty());
    }

    #[test]
    fn user_scope_maps_to_claude_user() {
        let tmp = tempdir().unwrap();
        let plugin_dir = tmp.path().join("sample");
        let json = format!(
            r#"{{"plugins":{{"user":[{{"installPath":"{}"}}]}}}}"#,
            plugin_dir.display()
        );
        write_claude_fixture(tmp.path(), &json, &[plugin_dir.to_str().unwrap()]);

        let out = discover_claude_adapter(tmp.path());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id.marketplace, "claude-user");
        assert_eq!(out[0].id.name, "sample");
    }

    #[test]
    fn marketplace_name_used_when_present() {
        let tmp = tempdir().unwrap();
        let plugin_dir = tmp.path().join("foo");
        let json = format!(
            r#"{{"plugins":{{"project":[{{"installPath":"{}","marketplaceName":"my-mk"}}]}}}}"#,
            plugin_dir.display()
        );
        write_claude_fixture(tmp.path(), &json, &[plugin_dir.to_str().unwrap()]);

        let out = discover_claude_adapter(tmp.path());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id.marketplace, "my-mk");
    }

    #[test]
    fn non_user_scope_falls_back_to_claude_plugins() {
        let tmp = tempdir().unwrap();
        let plugin_dir = tmp.path().join("foo");
        let json = format!(
            r#"{{"plugins":{{"workspace":[{{"installPath":"{}"}}]}}}}"#,
            plugin_dir.display()
        );
        write_claude_fixture(tmp.path(), &json, &[plugin_dir.to_str().unwrap()]);

        let out = discover_claude_adapter(tmp.path());
        assert_eq!(out[0].id.marketplace, "claude-plugins");
    }

    #[test]
    fn missing_install_path_skipped() {
        let tmp = tempdir().unwrap();
        let json = r#"{"plugins":{"user":[{"installPath":"/nonexistent/path"}]}}"#;
        fs::write(tmp.path().join("installed_plugins.json"), json).unwrap();
        assert!(discover_claude_adapter(tmp.path()).is_empty());
    }

    #[test]
    fn sanitize_handles_dots_and_slashes() {
        assert_eq!(sanitize("foo.bar"), "foo-bar");
        assert_eq!(sanitize("a/b"), "a-b");
        assert_eq!(sanitize("keep_1-2"), "keep_1-2");
    }

    fn make_codex_plugin(cache: &Path, marketplace: &str, name: &str, version: &str) -> PathBuf {
        let p = cache.join(marketplace).join(name).join(version);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn codex_adapter_missing_root_returns_empty() {
        let tmp = tempdir().unwrap();
        let missing = tmp.path().join("not-there");
        assert!(discover_codex_adapter(&missing).is_empty());
    }

    #[test]
    fn codex_adapter_discovers_plugins() {
        let tmp = tempdir().unwrap();
        let cache = tmp.path().join("cache");
        make_codex_plugin(&cache, "openai", "github", "1-0-0");
        make_codex_plugin(&cache, "community", "linear", "local");

        let mut out = discover_codex_adapter(&cache);
        out.sort_by(|a, b| a.id.name.cmp(&b.id.name));
        assert_eq!(out.len(), 2);
        // sorted by name: "github" < "linear"
        assert_eq!(out[0].id.marketplace, "openai");
        assert_eq!(out[0].id.name, "github");
        assert_eq!(out[1].id.marketplace, "community");
        assert_eq!(out[1].id.name, "linear");
    }

    #[test]
    fn codex_adapter_uses_latest_version_directory() {
        let tmp = tempdir().unwrap();
        let cache = tmp.path().join("cache");
        make_codex_plugin(&cache, "openai", "github", "1-0-0");
        make_codex_plugin(&cache, "openai", "github", "2-0-0");
        let out = discover_codex_adapter(&cache);
        assert_eq!(out.len(), 1);
        assert!(out[0].root.ends_with("2-0-0"));
    }

    #[test]
    fn codex_adapter_local_sentinel_wins() {
        let tmp = tempdir().unwrap();
        let cache = tmp.path().join("cache");
        make_codex_plugin(&cache, "openai", "github", "1-0-0");
        make_codex_plugin(&cache, "openai", "github", "local");
        let out = discover_codex_adapter(&cache);
        assert_eq!(out.len(), 1);
        assert!(out[0].root.ends_with("local"));
    }
}
