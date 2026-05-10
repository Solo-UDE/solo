//! Tauri command surface for the plugin system.
//!
//! 5 commands: plugins_list, plugins_get_detail, plugins_set_enabled,
//! plugins_install_local, plugins_uninstall.

use solo_core::settings as settings_io;
use solo_plugins::{
    get_plugin_detail, list_plugins, load_plugin_apps, load_plugin_manifest, load_plugin_mcp,
    LoaderConfig, PluginId as CoreId, PluginSource as CoreSource, PluginStore, PluginStoreError,
    PluginToggles,
};
use solo_protocol::{
    PluginAppDeclaration, PluginDetail, PluginId, PluginInstallResult, PluginInterface,
    PluginListOutcome, PluginLoadError, PluginSource, PluginSummary,
};
use std::path::{Path, PathBuf};
use tauri::State;

use crate::connectors_commands::infer_connector_provider;

pub struct PluginsState {
    home_dir: PathBuf,
}

impl PluginsState {
    pub fn new() -> Self {
        let home_dir = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"));
        Self { home_dir }
    }

    pub(crate) fn solo_home(&self) -> PathBuf {
        self.home_dir.join(".solo")
    }

    pub(crate) fn claude_plugins_dir(&self) -> PathBuf {
        self.home_dir.join(".claude").join("plugins")
    }

    pub(crate) fn codex_cache_dir(&self) -> PathBuf {
        self.home_dir.join(".codex").join("plugins").join("cache")
    }
}

impl Default for PluginsState {
    fn default() -> Self {
        Self::new()
    }
}

// Conversion helpers between solo-plugins core types and solo-protocol wire types.

fn wire_id(core: CoreId) -> PluginId {
    PluginId {
        marketplace: core.marketplace,
        name: core.name,
    }
}

fn core_id(wire: PluginId) -> Result<CoreId, String> {
    CoreId::new(wire.marketplace, wire.name).map_err(|e| e.to_string())
}

fn wire_source(core: CoreSource) -> PluginSource {
    match core {
        CoreSource::Local => PluginSource::Local,
        CoreSource::Marketplace => PluginSource::Marketplace,
        CoreSource::ClaudeAdapter => PluginSource::ClaudeAdapter,
        CoreSource::CodexAdapter => PluginSource::CodexAdapter,
    }
}

#[derive(Debug, Clone, Default)]
struct PluginCapabilitySnapshot {
    skill_count: u32,
    mcp_servers: Vec<String>,
    apps: Vec<PluginAppDeclaration>,
    compatibility_warnings: Vec<String>,
}

fn count_skill_files(skills_path: Option<&Path>) -> u32 {
    let Some(skills_path) = skills_path else {
        return 0;
    };
    let Ok(entries) = std::fs::read_dir(skills_path) else {
        return 0;
    };

    entries
        .flatten()
        .filter(|entry| {
            let path = entry.path();
            if path.is_file() {
                return path.extension().is_some_and(|ext| ext == "md");
            }
            if path.is_dir() {
                return path.join("AGENTS.md").is_file() || path.join("SKILL.md").is_file();
            }
            false
        })
        .count() as u32
}

fn snapshot_capabilities(record: &solo_plugins::PluginRecord) -> PluginCapabilitySnapshot {
    let mut snapshot = PluginCapabilitySnapshot::default();
    let Some(manifest) = record.manifest.as_ref() else {
        snapshot
            .compatibility_warnings
            .push("Plugin manifest could not be loaded.".to_string());
        return snapshot;
    };

    snapshot.skill_count = count_skill_files(manifest.paths.skills.as_ref().map(|p| p.as_path()));

    if let Some(mcp_path) = manifest.paths.mcp_servers.as_ref() {
        let loaded = load_plugin_mcp(mcp_path.as_path());
        snapshot.mcp_servers = loaded.server_names;
        if let Some(error) = loaded.error {
            snapshot
                .compatibility_warnings
                .push(format!("MCP config is not usable: {error}"));
        }
    }

    if let Some(apps_path) = manifest.paths.apps.as_ref() {
        let loaded = load_plugin_apps(apps_path.as_path());
        snapshot.apps = loaded
            .apps
            .into_iter()
            .map(|app| {
                let provider = infer_connector_provider(
                    &app.app_id,
                    app.provider.as_deref(),
                    app.connector_id.as_deref(),
                );
                let supported = provider.is_some();
                PluginAppDeclaration {
                    app_id: app.app_id,
                    connector_id: app.connector_id,
                    provider,
                    scopes: app.scopes,
                    supported,
                    status: if supported {
                        "needs_connection".to_string()
                    } else {
                        "unsupported_connector_runtime".to_string()
                    },
                }
            })
            .collect();

        if let Some(error) = loaded.error {
            snapshot
                .compatibility_warnings
                .push(format!("App connector config is not usable: {error}"));
        }

        if !snapshot.apps.is_empty() {
            snapshot.compatibility_warnings.push(
                "This plugin declares app connectors. Solo can inject Solo-owned connector tokens for supported providers once the account is connected."
                    .to_string(),
            );
        }
    }

    for (surface, message) in [
        (
            record.root.join("agents"),
            "Plugin agents are present but Solo does not load plugin-defined agents yet.",
        ),
        (
            record.root.join("commands"),
            "Plugin slash commands are present but Solo does not load plugin-defined commands yet.",
        ),
        (
            record.root.join("hooks.json"),
            "Plugin hooks are present but Solo does not run plugin lifecycle hooks yet.",
        ),
    ] {
        if surface.exists() {
            snapshot.compatibility_warnings.push(message.to_string());
        }
    }

    snapshot
}

fn record_to_summary(record: solo_plugins::PluginRecord) -> PluginSummary {
    let interface = record.manifest.as_ref().and_then(|m| m.interface.as_ref());
    let display_name = interface
        .and_then(|i| i.display_name.clone())
        .unwrap_or_else(|| record.id.name.clone());
    let short_description = interface.and_then(|i| i.short_description.clone());
    let logo = interface.and_then(|i| {
        i.logo
            .as_ref()
            .map(|p| p.as_path().to_string_lossy().into_owned())
    });
    let brand_color = interface.and_then(|i| i.brand_color.clone());
    let snapshot = snapshot_capabilities(&record);
    let app_count = snapshot.apps.len() as u32;
    let unsupported_connector_count =
        snapshot.apps.iter().filter(|app| !app.supported).count() as u32;

    PluginSummary {
        id: wire_id(record.id),
        version: record.version,
        display_name,
        short_description,
        logo,
        brand_color,
        enabled: record.enabled,
        source: wire_source(record.source),
        skill_count: snapshot.skill_count,
        mcp_server_count: snapshot.mcp_servers.len() as u32,
        app_count,
        unsupported_connector_count,
        compatibility_warnings: snapshot.compatibility_warnings,
    }
}

fn record_to_detail(record: solo_plugins::PluginRecord) -> PluginDetail {
    let manifest = record.manifest.clone();
    let interface = manifest
        .as_ref()
        .and_then(|m| m.interface.as_ref())
        .map(|i| PluginInterface {
            display_name: i.display_name.clone(),
            short_description: i.short_description.clone(),
            long_description: i.long_description.clone(),
            developer_name: i.developer_name.clone(),
            category: i.category.clone(),
            capabilities: i.capabilities.clone(),
            website_url: i.website_url.clone(),
            privacy_policy_url: i.privacy_policy_url.clone(),
            terms_of_service_url: i.terms_of_service_url.clone(),
            default_prompts: i.default_prompts.clone(),
            brand_color: i.brand_color.clone(),
            composer_icon: i
                .composer_icon
                .as_ref()
                .map(|p| p.as_path().to_string_lossy().into_owned()),
            logo: i
                .logo
                .as_ref()
                .map(|p| p.as_path().to_string_lossy().into_owned()),
            screenshots: i
                .screenshots
                .iter()
                .map(|p| p.as_path().to_string_lossy().into_owned())
                .collect(),
        });
    let snapshot = snapshot_capabilities(&record);
    let skills_path = manifest
        .as_ref()
        .and_then(|m| m.paths.skills.as_ref())
        .map(|p| p.as_path().to_string_lossy().into_owned());
    let mcp_servers_path = manifest
        .as_ref()
        .and_then(|m| m.paths.mcp_servers.as_ref())
        .map(|p| p.as_path().to_string_lossy().into_owned());
    let apps_path = manifest
        .as_ref()
        .and_then(|m| m.paths.apps.as_ref())
        .map(|p| p.as_path().to_string_lossy().into_owned());

    PluginDetail {
        id: wire_id(record.id),
        version: record.version,
        source: wire_source(record.source),
        enabled: record.enabled,
        root_path: record.root.to_string_lossy().into_owned(),
        description: manifest.and_then(|m| m.description),
        interface,
        skills_path,
        mcp_servers_path,
        apps_path,
        skill_count: snapshot.skill_count,
        mcp_servers: snapshot.mcp_servers,
        apps: snapshot.apps,
        compatibility_warnings: snapshot.compatibility_warnings,
    }
}

#[tauri::command]
pub async fn plugins_list(
    cwd: String,
    state: State<'_, PluginsState>,
) -> Result<PluginListOutcome, String> {
    let workspace = PathBuf::from(&cwd);
    let config = settings_io::load_plugins_config(&workspace).unwrap_or_default();
    let solo_home = state.solo_home();
    let claude_plugins_dir = {
        let d = state.claude_plugins_dir();
        d.exists().then_some(d)
    };
    let codex_cache_dir = {
        let d = state.codex_cache_dir();
        d.exists().then_some(d)
    };

    let outcome = list_plugins(LoaderConfig {
        solo_home: &solo_home,
        claude_plugins_dir,
        codex_cache_dir,
        adapter_claude_plugins: config.adapter_claude_plugins,
        adapter_codex_user: config.adapter_codex_user,
    });

    Ok(PluginListOutcome {
        plugins: outcome.plugins.into_iter().map(record_to_summary).collect(),
        errors: outcome
            .errors
            .into_iter()
            .map(|e| PluginLoadError {
                path: e.path.to_string_lossy().into_owned(),
                message: e.message,
            })
            .collect(),
    })
}

#[tauri::command]
pub async fn plugins_get_detail(
    cwd: String,
    id: PluginId,
    state: State<'_, PluginsState>,
) -> Result<PluginDetail, String> {
    let workspace = PathBuf::from(&cwd);
    let config = settings_io::load_plugins_config(&workspace).unwrap_or_default();
    let solo_home = state.solo_home();
    let claude_plugins_dir = {
        let d = state.claude_plugins_dir();
        d.exists().then_some(d)
    };
    let codex_cache_dir = {
        let d = state.codex_cache_dir();
        d.exists().then_some(d)
    };
    let core_id = core_id(id)?;

    let record = get_plugin_detail(
        LoaderConfig {
            solo_home: &solo_home,
            claude_plugins_dir,
            codex_cache_dir,
            adapter_claude_plugins: config.adapter_claude_plugins,
            adapter_codex_user: config.adapter_codex_user,
        },
        &core_id,
    )
    .ok_or_else(|| format!("plugin not found: {}/{}", core_id.marketplace, core_id.name))?;

    Ok(record_to_detail(record))
}

#[tauri::command]
pub async fn plugins_set_enabled(
    cwd: String,
    id: PluginId,
    enabled: bool,
    state: State<'_, PluginsState>,
) -> Result<PluginSummary, String> {
    let core_id = core_id(id.clone())?;
    let solo_plugins_dir = state.solo_home().join("plugins");

    let mut toggles = PluginToggles::load(&solo_plugins_dir);
    toggles.set_enabled(&core_id, enabled);
    toggles
        .save(&solo_plugins_dir)
        .map_err(|e| format!("failed to save toggles: {e}"))?;

    // Re-list to return the updated summary.
    let workspace = PathBuf::from(&cwd);
    let config = settings_io::load_plugins_config(&workspace).unwrap_or_default();
    let solo_home = state.solo_home();
    let claude_plugins_dir = state.claude_plugins_dir();
    let codex_cache_dir = state.codex_cache_dir();
    let record = get_plugin_detail(
        LoaderConfig {
            solo_home: &solo_home,
            claude_plugins_dir: claude_plugins_dir.exists().then_some(claude_plugins_dir),
            codex_cache_dir: codex_cache_dir.exists().then_some(codex_cache_dir),
            adapter_claude_plugins: config.adapter_claude_plugins,
            adapter_codex_user: config.adapter_codex_user,
        },
        &core_id,
    )
    .ok_or_else(|| format!("plugin not found after toggle: {}", core_id.name))?;

    Ok(record_to_summary(record))
}

#[tauri::command]
pub async fn plugins_install_local(
    source_path: String,
    state: State<'_, PluginsState>,
) -> Result<PluginInstallResult, String> {
    let source = PathBuf::from(&source_path);
    let manifest = load_plugin_manifest(&source)
        .ok_or_else(|| "missing or invalid plugin.json in source directory".to_string())?;

    let name = if manifest.name.is_empty() {
        source
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "could not derive plugin name from source path".to_string())?
            .to_string()
    } else {
        manifest.name
    };

    let core_id =
        solo_plugins::PluginId::new("local".to_string(), name).map_err(|e| e.to_string())?;
    let solo_plugins_dir = state.solo_home().join("plugins");
    let store = PluginStore::new(solo_plugins_dir);
    let result = store
        .install_local(&source, core_id, "local")
        .map_err(|e: PluginStoreError| e.to_string())?;

    Ok(PluginInstallResult {
        id: wire_id(result.id),
        version: result.version,
        root_path: result
            .installed_path
            .as_path()
            .to_string_lossy()
            .into_owned(),
    })
}

#[tauri::command]
pub async fn plugins_uninstall(id: PluginId, state: State<'_, PluginsState>) -> Result<(), String> {
    let core_id = core_id(id.clone())?;
    // Only Local/Marketplace plugins live in our cache; adapters are read-only.
    if core_id.marketplace != "local" && !core_id.marketplace.starts_with("marketplace-") {
        return Err(format!(
            "cannot uninstall adapter-discovered plugin: {}/{}",
            core_id.marketplace, core_id.name
        ));
    }
    let solo_plugins_dir = state.solo_home().join("plugins");
    let store = PluginStore::new(solo_plugins_dir);
    store.uninstall(&core_id).map_err(|e| e.to_string())
}
