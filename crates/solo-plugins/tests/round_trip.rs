//! End-to-end round-trip: install → list → toggle → detail → uninstall.
//!
//! Uses a tempdir as `solo_home` so it never touches the real ~/.solo/.

use solo_plugins::{
    get_plugin_detail, list_plugins, LoaderConfig, PluginId, PluginStore, PluginToggles,
};
use std::fs;
use std::path::Path;
use tempfile::tempdir;

fn write_fixture_plugin(root: &Path, name: &str, display_name: &str) {
    fs::create_dir_all(root.join(".solo-plugin")).unwrap();
    fs::write(
        root.join(".solo-plugin/plugin.json"),
        format!(
            r#"{{"name":"{name}","interface":{{"displayName":"{display_name}","shortDescription":"fixture"}}}}"#
        ),
    )
    .unwrap();
}

#[test]
fn install_list_toggle_detail_uninstall() {
    let solo_home = tempdir().unwrap();
    let fixture_src = tempdir().unwrap();
    let source = fixture_src.path().join("fixture");
    write_fixture_plugin(&source, "fixture", "Fixture Plugin");

    // 1. Install.
    let store = PluginStore::new(solo_home.path().join("plugins"));
    let id = PluginId::new("local".into(), "fixture".into()).unwrap();
    let install = store.install_local(&source, id.clone(), "local").unwrap();
    assert_eq!(install.version, "local");

    // 2. List — adapter flags off so we only see the Solo-native install.
    let make_cfg = || LoaderConfig {
        solo_home: solo_home.path(),
        claude_plugins_dir: None,
        codex_cache_dir: None,
        adapter_claude_plugins: false,
        adapter_codex_user: false,
    };
    let listed = list_plugins(make_cfg());
    assert_eq!(listed.plugins.len(), 1);
    assert_eq!(listed.plugins[0].id, id);
    assert!(listed.plugins[0].enabled, "default enabled");

    // 3. Toggle disabled.
    let mut toggles = PluginToggles::load(&solo_home.path().join("plugins"));
    toggles.set_enabled(&id, false);
    toggles.save(&solo_home.path().join("plugins")).unwrap();
    let listed_after = list_plugins(make_cfg());
    assert!(!listed_after.plugins[0].enabled);

    // 4. Get detail.
    let detail = get_plugin_detail(make_cfg(), &id).unwrap();
    assert_eq!(detail.id, id);
    assert_eq!(
        detail
            .manifest
            .as_ref()
            .and_then(|m| m.interface.as_ref())
            .and_then(|i| i.display_name.clone()),
        Some("Fixture Plugin".to_string())
    );

    // 5. Uninstall.
    store.uninstall(&id).unwrap();
    let listed_empty = list_plugins(make_cfg());
    assert!(listed_empty.plugins.is_empty());
    assert!(listed_empty.errors.is_empty());
}
