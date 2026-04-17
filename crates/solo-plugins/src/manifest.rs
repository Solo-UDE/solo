//! plugin.json parser.
//!
//! Forked from `codex-rs/core-plugins/src/manifest.rs` (Apache-2.0). Solo
//! accepts three manifest filenames (solo-plugin, codex-plugin, claude-plugin)
//! in that priority order — see `find_plugin_manifest_path`. See the
//! crate-level `README.md` for full attribution.

use crate::path::AbsolutePathBuf;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use std::path::{Path, PathBuf};

pub const MAX_DEFAULT_PROMPT_COUNT: usize = 3;
pub const MAX_DEFAULT_PROMPT_LEN: usize = 128;

pub const DISCOVERABLE_MANIFEST_PATHS: &[&str] = &[
    ".solo-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginManifest {
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub paths: PluginManifestPaths,
    pub interface: Option<PluginManifestInterface>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PluginManifestPaths {
    pub skills: Option<AbsolutePathBuf>,
    pub mcp_servers: Option<AbsolutePathBuf>,
    pub apps: Option<AbsolutePathBuf>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PluginManifestInterface {
    pub display_name: Option<String>,
    pub short_description: Option<String>,
    pub long_description: Option<String>,
    pub developer_name: Option<String>,
    pub category: Option<String>,
    pub capabilities: Vec<String>,
    pub website_url: Option<String>,
    pub privacy_policy_url: Option<String>,
    pub terms_of_service_url: Option<String>,
    pub default_prompts: Vec<String>,
    pub brand_color: Option<String>,
    pub composer_icon: Option<AbsolutePathBuf>,
    pub logo: Option<AbsolutePathBuf>,
    pub screenshots: Vec<AbsolutePathBuf>,
}

// Raw types used only for deserialization. Made private because consumers
// always get the processed `PluginManifest`.

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPluginManifest {
    #[serde(default)]
    name: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    skills: Option<String>,
    #[serde(default)]
    mcp_servers: Option<String>,
    #[serde(default)]
    apps: Option<String>,
    #[serde(default)]
    interface: Option<RawPluginManifestInterface>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPluginManifestInterface {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    short_description: Option<String>,
    #[serde(default)]
    long_description: Option<String>,
    #[serde(default)]
    developer_name: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    #[serde(alias = "websiteURL")]
    website_url: Option<String>,
    #[serde(default)]
    #[serde(alias = "privacyPolicyURL")]
    privacy_policy_url: Option<String>,
    #[serde(default)]
    #[serde(alias = "termsOfServiceURL")]
    terms_of_service_url: Option<String>,
    #[serde(default)]
    default_prompt: Option<RawPluginManifestDefaultPrompt>,
    #[serde(default)]
    brand_color: Option<String>,
    #[serde(default)]
    composer_icon: Option<String>,
    #[serde(default)]
    logo: Option<String>,
    #[serde(default)]
    screenshots: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawPluginManifestDefaultPrompt {
    String(String),
    List(Vec<RawPluginManifestDefaultPromptEntry>),
    Invalid(JsonValue),
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawPluginManifestDefaultPromptEntry {
    String(String),
    Invalid(JsonValue),
}

/// Walk the discoverable filenames in priority order, returning the first
/// that exists as a file under `plugin_root`.
pub fn find_plugin_manifest_path(plugin_root: &Path) -> Option<PathBuf> {
    DISCOVERABLE_MANIFEST_PATHS
        .iter()
        .map(|rel| plugin_root.join(rel))
        .find(|p| p.is_file())
}

pub fn load_plugin_manifest(plugin_root: &Path) -> Option<PluginManifest> {
    let manifest_path = find_plugin_manifest_path(plugin_root)?;
    let contents = match std::fs::read_to_string(&manifest_path) {
        Ok(c) => c,
        Err(err) => {
            tracing::warn!(
                path = %manifest_path.display(),
                "failed to read plugin manifest: {err}"
            );
            return None;
        }
    };
    let raw: RawPluginManifest = match serde_json::from_str(&contents) {
        Ok(r) => r,
        Err(err) => {
            tracing::warn!(
                path = %manifest_path.display(),
                "failed to parse plugin manifest: {err}"
            );
            return None;
        }
    };

    let RawPluginManifest {
        name: raw_name,
        version,
        description,
        skills,
        mcp_servers,
        apps,
        interface,
    } = raw;

    let name = if raw_name.trim().is_empty() {
        plugin_root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string()
    } else {
        raw_name
    };

    let version = version.and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    Some(PluginManifest {
        name,
        version,
        description,
        paths: PluginManifestPaths {
            skills: resolve_manifest_path(plugin_root, "skills", skills.as_deref()),
            mcp_servers: resolve_manifest_path(plugin_root, "mcpServers", mcp_servers.as_deref()),
            apps: resolve_manifest_path(plugin_root, "apps", apps.as_deref()),
        },
        interface: process_interface(plugin_root, interface),
    })
}

fn resolve_manifest_path(
    plugin_root: &Path,
    field: &'static str,
    raw: Option<&str>,
) -> Option<AbsolutePathBuf> {
    let raw = raw?;
    match crate::path::resolve_relative_inside(plugin_root, raw) {
        Ok(p) => Some(p),
        Err(err) => {
            tracing::warn!(
                plugin_root = %plugin_root.display(),
                "ignoring {field}: {err}"
            );
            None
        }
    }
}

// Stub — implemented in Task 6.
fn process_interface(
    _plugin_root: &Path,
    _raw: Option<RawPluginManifestInterface>,
) -> Option<PluginManifestInterface> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_manifest(root: &Path, relative: &str, body: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    #[test]
    fn missing_manifest_returns_none() {
        let tmp = tempdir().unwrap();
        assert!(load_plugin_manifest(&tmp.path().join("missing")).is_none());
    }

    #[test]
    fn solo_plugin_path_takes_priority() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(&root, ".solo-plugin/plugin.json", r#"{"name":"from-solo"}"#);
        write_manifest(&root, ".claude-plugin/plugin.json", r#"{"name":"from-claude"}"#);
        let manifest = load_plugin_manifest(&root).unwrap();
        assert_eq!(manifest.name, "from-solo");
    }

    #[test]
    fn claude_plugin_path_accepted_as_fallback() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(&root, ".claude-plugin/plugin.json", r#"{"name":"from-claude"}"#);
        let manifest = load_plugin_manifest(&root).unwrap();
        assert_eq!(manifest.name, "from-claude");
    }

    #[test]
    fn name_falls_back_to_dir_when_empty() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample-dir");
        write_manifest(&root, ".solo-plugin/plugin.json", r#"{"name":""}"#);
        let manifest = load_plugin_manifest(&root).unwrap();
        assert_eq!(manifest.name, "sample-dir");
    }

    #[test]
    fn version_trimmed() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","version":"  1.2.3-beta+7  "}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        assert_eq!(manifest.version.as_deref(), Some("1.2.3-beta+7"));
    }

    #[test]
    fn empty_version_becomes_none() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(&root, ".solo-plugin/plugin.json", r#"{"name":"x","version":"  "}"#);
        let manifest = load_plugin_manifest(&root).unwrap();
        assert_eq!(manifest.version, None);
    }

    #[test]
    fn malformed_json_returns_none() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(&root, ".solo-plugin/plugin.json", r#"{not json"#);
        assert!(load_plugin_manifest(&root).is_none());
    }
}
