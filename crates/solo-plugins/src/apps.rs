//! App connector declarations loaded from a plugin's `.app.json`.
//!
//! Codex/OpenAI curated plugins currently use a compact connector-id shape:
//! `{ "apps": { "gmail": { "id": "connector_..." } } }`.
//! Solo can surface that declaration and mark it unsupported until a native
//! connector/OAuth runtime is wired in.

use serde::Deserialize;
use serde_json::Value as JsonValue;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginAppDeclaration {
    pub app_id: String,
    pub connector_id: Option<String>,
    pub provider: Option<String>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginAppsLoadResult {
    pub apps: Vec<PluginAppDeclaration>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawAppsFile {
    #[serde(default)]
    apps: std::collections::BTreeMap<String, RawAppDeclaration>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAppDeclaration {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    scopes: Vec<String>,
    #[serde(flatten)]
    _extra: std::collections::BTreeMap<String, JsonValue>,
}

pub fn load_plugin_apps(path: &Path) -> PluginAppsLoadResult {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) => {
            return PluginAppsLoadResult {
                apps: Vec::new(),
                error: Some(format!("failed to read app connector config: {err}")),
            };
        }
    };

    let parsed: RawAppsFile = match serde_json::from_str(&raw) {
        Ok(parsed) => parsed,
        Err(err) => {
            return PluginAppsLoadResult {
                apps: Vec::new(),
                error: Some(format!("failed to parse app connector config: {err}")),
            };
        }
    };

    PluginAppsLoadResult {
        apps: parsed
            .apps
            .into_iter()
            .map(|(app_id, raw)| PluginAppDeclaration {
                app_id,
                connector_id: raw.id.filter(|id| !id.trim().is_empty()),
                provider: raw.provider.filter(|provider| !provider.trim().is_empty()),
                scopes: raw.scopes,
            })
            .collect(),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn loads_codex_connector_ids() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join(".app.json");
        fs::write(
            &path,
            r#"{"apps":{"gmail":{"id":"connector_123"},"drive":{"provider":"google","scopes":["drive.readonly"]}}}"#,
        )
        .unwrap();

        let out = load_plugin_apps(&path);
        assert_eq!(out.error, None);
        assert_eq!(out.apps.len(), 2);
        assert_eq!(out.apps[0].app_id, "drive");
        assert_eq!(out.apps[1].connector_id.as_deref(), Some("connector_123"));
    }
}
