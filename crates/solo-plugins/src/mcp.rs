//! Helpers for MCP server configs declared by plugins.

use serde_json::{Map as JsonMap, Value as JsonValue};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginMcpLoadResult {
    pub server_names: Vec<String>,
    pub error: Option<String>,
}

pub fn normalize_mcp_servers(
    value: JsonValue,
    source: &str,
) -> Result<JsonMap<String, JsonValue>, String> {
    if let Some(servers) = value.get("mcpServers").and_then(JsonValue::as_object) {
        return Ok(servers.clone());
    }

    if let Some(servers) = value.as_object() {
        return Ok(servers.clone());
    }

    Err(format!(
        "{source} must be a JSON object or contain a top-level mcpServers object"
    ))
}

pub fn load_plugin_mcp(path: &Path) -> PluginMcpLoadResult {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) => {
            return PluginMcpLoadResult {
                server_names: Vec::new(),
                error: Some(format!("failed to read MCP config: {err}")),
            };
        }
    };

    let value: JsonValue = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(err) => {
            return PluginMcpLoadResult {
                server_names: Vec::new(),
                error: Some(format!("failed to parse MCP config: {err}")),
            };
        }
    };

    match normalize_mcp_servers(value, &path.display().to_string()) {
        Ok(servers) => PluginMcpLoadResult {
            server_names: servers.keys().cloned().collect(),
            error: None,
        },
        Err(err) => PluginMcpLoadResult {
            server_names: Vec::new(),
            error: Some(err),
        },
    }
}

pub fn expand_mcp_server_config(
    value: JsonValue,
    plugin_root: &Path,
    workspace: &Path,
) -> JsonValue {
    match value {
        JsonValue::String(raw) => {
            JsonValue::String(expand_mcp_string(&raw, plugin_root, workspace))
        }
        JsonValue::Array(items) => JsonValue::Array(
            items
                .into_iter()
                .map(|item| expand_mcp_server_config(item, plugin_root, workspace))
                .collect(),
        ),
        JsonValue::Object(map) => JsonValue::Object(
            map.into_iter()
                .map(|(key, item)| (key, expand_mcp_server_config(item, plugin_root, workspace)))
                .collect(),
        ),
        other => other,
    }
}

fn expand_mcp_string(raw: &str, plugin_root: &Path, workspace: &Path) -> String {
    let mut out = raw
        .replace("${PLUGIN_ROOT}", &path_string(plugin_root))
        .replace("${pluginRoot}", &path_string(plugin_root))
        .replace("${workspaceFolder}", &path_string(workspace))
        .replace("${workspace}", &path_string(workspace));

    while let Some(start) = out.find("${env:") {
        let name_start = start + "${env:".len();
        let Some(rel_end) = out[name_start..].find('}') else {
            break;
        };
        let end = name_start + rel_end;
        let name = &out[name_start..end];
        let replacement = std::env::var(name).unwrap_or_default();
        out.replace_range(start..=end, &replacement);
    }

    out
}

fn path_string(path: &Path) -> String {
    absolutize(path).to_string_lossy().into_owned()
}

fn absolutize(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_wrapped_and_raw_servers() {
        assert_eq!(
            normalize_mcp_servers(json!({"mcpServers":{"a":{}}}), "wrapped")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            normalize_mcp_servers(json!({"a":{}}), "raw").unwrap().len(),
            1
        );
    }

    #[test]
    fn expands_plugin_and_workspace_variables_recursively() {
        let value = json!({
            "command": "${PLUGIN_ROOT}/bin/server",
            "args": ["--cwd", "${workspaceFolder}"],
            "env": { "PLUGIN": "${pluginRoot}" }
        });
        let expanded =
            expand_mcp_server_config(value, Path::new("/tmp/plugin"), Path::new("/tmp/workspace"));
        assert_eq!(expanded["command"], "/tmp/plugin/bin/server");
        assert_eq!(expanded["args"][1], "/tmp/workspace");
        assert_eq!(expanded["env"]["PLUGIN"], "/tmp/plugin");
    }
}
