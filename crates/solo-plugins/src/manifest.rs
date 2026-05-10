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

fn process_interface(
    plugin_root: &Path,
    raw: Option<RawPluginManifestInterface>,
) -> Option<PluginManifestInterface> {
    let raw = raw?;
    let RawPluginManifestInterface {
        display_name,
        short_description,
        long_description,
        developer_name,
        category,
        capabilities,
        website_url,
        privacy_policy_url,
        terms_of_service_url,
        default_prompt,
        brand_color,
        composer_icon,
        logo,
        screenshots,
    } = raw;

    let interface = PluginManifestInterface {
        display_name,
        short_description,
        long_description,
        developer_name,
        category,
        capabilities,
        website_url,
        privacy_policy_url,
        terms_of_service_url,
        default_prompts: resolve_default_prompts(default_prompt).unwrap_or_default(),
        brand_color,
        composer_icon: resolve_manifest_path(
            plugin_root,
            "interface.composerIcon",
            composer_icon.as_deref(),
        ),
        logo: resolve_manifest_path(plugin_root, "interface.logo", logo.as_deref()),
        screenshots: screenshots
            .iter()
            .filter_map(|s| resolve_manifest_path(plugin_root, "interface.screenshots", Some(s)))
            .collect(),
    };

    let has_any = interface.display_name.is_some()
        || interface.short_description.is_some()
        || interface.long_description.is_some()
        || interface.developer_name.is_some()
        || interface.category.is_some()
        || !interface.capabilities.is_empty()
        || interface.website_url.is_some()
        || interface.privacy_policy_url.is_some()
        || interface.terms_of_service_url.is_some()
        || !interface.default_prompts.is_empty()
        || interface.brand_color.is_some()
        || interface.composer_icon.is_some()
        || interface.logo.is_some()
        || !interface.screenshots.is_empty();

    has_any.then_some(interface)
}

fn resolve_default_prompts(raw: Option<RawPluginManifestDefaultPrompt>) -> Option<Vec<String>> {
    let raw = raw?;
    let mut prompts = Vec::new();

    match raw {
        RawPluginManifestDefaultPrompt::String(s) => {
            if let Some(p) = normalize_prompt(&s) {
                prompts.push(p);
            }
        }
        RawPluginManifestDefaultPrompt::List(entries) => {
            for entry in entries {
                if prompts.len() >= MAX_DEFAULT_PROMPT_COUNT {
                    tracing::warn!(
                        "ignoring additional defaultPrompt entries: max {MAX_DEFAULT_PROMPT_COUNT}"
                    );
                    break;
                }
                match entry {
                    RawPluginManifestDefaultPromptEntry::String(s) => {
                        if let Some(p) = normalize_prompt(&s) {
                            prompts.push(p);
                        }
                    }
                    RawPluginManifestDefaultPromptEntry::Invalid(value) => {
                        tracing::warn!(
                            "ignoring defaultPrompt entry: expected string, got {}",
                            value_type(&value)
                        );
                    }
                }
            }
        }
        RawPluginManifestDefaultPrompt::Invalid(value) => {
            tracing::warn!(
                "ignoring defaultPrompt: expected string or array, got {}",
                value_type(&value)
            );
        }
    }

    if prompts.is_empty() {
        None
    } else {
        Some(prompts)
    }
}

fn normalize_prompt(raw: &str) -> Option<String> {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    if collapsed.chars().count() > MAX_DEFAULT_PROMPT_LEN {
        tracing::warn!("ignoring defaultPrompt: max {MAX_DEFAULT_PROMPT_LEN} characters");
        return None;
    }
    Some(collapsed)
}

fn value_type(v: &JsonValue) -> &'static str {
    match v {
        JsonValue::Null => "null",
        JsonValue::Bool(_) => "boolean",
        JsonValue::Number(_) => "number",
        JsonValue::String(_) => "string",
        JsonValue::Array(_) => "array",
        JsonValue::Object(_) => "object",
    }
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
        write_manifest(
            &root,
            ".claude-plugin/plugin.json",
            r#"{"name":"from-claude"}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        assert_eq!(manifest.name, "from-solo");
    }

    #[test]
    fn claude_plugin_path_accepted_as_fallback() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".claude-plugin/plugin.json",
            r#"{"name":"from-claude"}"#,
        );
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
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","version":"  "}"#,
        );
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

    #[test]
    fn interface_display_name_parses() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r##"{"name":"x","interface":{"displayName":"My Plugin","shortDescription":"short","brandColor":"#336699"}}"##,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(interface.display_name.as_deref(), Some("My Plugin"));
        assert_eq!(interface.short_description.as_deref(), Some("short"));
        assert_eq!(interface.brand_color.as_deref(), Some("#336699"));
    }

    #[test]
    fn interface_asset_paths_resolve_under_root() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"logo":"./assets/logo.png","screenshots":["./s1.png","./s2.png"]}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(
            interface.logo.unwrap().as_path(),
            root.join("assets/logo.png")
        );
        assert_eq!(interface.screenshots.len(), 2);
    }

    #[test]
    fn interface_rejects_unsafe_asset_paths() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"displayName":"ok","logo":"../evil.png"}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert!(interface.logo.is_none());
    }

    #[test]
    fn empty_interface_object_returns_none() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        assert!(manifest.interface.is_none());
    }

    #[test]
    fn no_interface_block_returns_none() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(&root, ".solo-plugin/plugin.json", r#"{"name":"x"}"#);
        let manifest = load_plugin_manifest(&root).unwrap();
        assert!(manifest.interface.is_none());
    }

    #[test]
    fn default_prompt_legacy_string() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"defaultPrompt":"  Summarize   my inbox  "}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(
            interface.default_prompts,
            vec!["Summarize my inbox".to_string()]
        );
    }

    #[test]
    fn default_prompt_array_caps_at_three() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"defaultPrompt":["one","two","three","four","five"]}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(interface.default_prompts, vec!["one", "two", "three"]);
    }

    #[test]
    fn default_prompt_drops_entries_over_128_chars() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        let too_long = "x".repeat(129);
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            &format!(r#"{{"name":"x","interface":{{"defaultPrompt":["short","{too_long}"]}}}}"#),
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(interface.default_prompts, vec!["short".to_string()]);
    }

    #[test]
    fn default_prompt_drops_empty_entries() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"defaultPrompt":["one","   ","two"]}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        let interface = manifest.interface.unwrap();
        assert_eq!(interface.default_prompts, vec!["one", "two"]);
    }

    #[test]
    fn default_prompt_invalid_shape_returns_empty() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("sample");
        write_manifest(
            &root,
            ".solo-plugin/plugin.json",
            r#"{"name":"x","interface":{"defaultPrompt":{"text":"nope"}}}"#,
        );
        let manifest = load_plugin_manifest(&root).unwrap();
        // With only a mistyped defaultPrompt, the interface should be None
        // (has_any is false because default_prompts is empty).
        assert!(manifest.interface.is_none());
    }
}
