//! Local plugin cache under ~/.solo/plugins/cache/<marketplace>/<name>/<version>/.
//!
//! Forked from `codex-rs/core-plugins/src/store.rs` (Apache-2.0). See the
//! crate-level `README.md` for full attribution.

use crate::id::{PluginId, PluginIdError, validate_plugin_segment};
use crate::path::AbsolutePathBuf;
use std::fs;
use std::path::{Path, PathBuf};

pub const PLUGINS_CACHE_DIR: &str = "cache";
pub const DEFAULT_PLUGIN_VERSION: &str = "local";

#[derive(Debug, thiserror::Error)]
pub enum PluginStoreError {
    #[error("invalid: {0}")]
    Invalid(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Id(#[from] PluginIdError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginInstallResult {
    pub id: PluginId,
    pub version: String,
    pub installed_path: AbsolutePathBuf,
}

#[derive(Debug, Clone)]
pub struct PluginStore {
    root: PathBuf,
}

impl PluginStore {
    /// `solo_plugins_dir` should be `~/.solo/plugins/`. The cache lives at
    /// `<solo_plugins_dir>/cache/`.
    pub fn new(solo_plugins_dir: PathBuf) -> Self {
        Self {
            root: solo_plugins_dir.join(PLUGINS_CACHE_DIR),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn plugin_base_root(&self, id: &PluginId) -> PathBuf {
        self.root.join(&id.marketplace).join(&id.name)
    }

    pub fn plugin_root(&self, id: &PluginId, version: &str) -> PathBuf {
        self.plugin_base_root(id).join(version)
    }

    /// Returns the active version for a plugin. Discovery rules:
    ///   1. If a directory named `local` exists, it wins.
    ///   2. Otherwise, the lexicographically-highest version directory wins.
    ///   3. If no version directories exist, returns None.
    pub fn active_plugin_version(&self, id: &PluginId) -> Option<String> {
        let base = self.plugin_base_root(id);
        let mut versions: Vec<String> = fs::read_dir(&base)
            .ok()?
            .filter_map(Result::ok)
            .filter(|e| e.file_type().ok().is_some_and(|t| t.is_dir()))
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|v| validate_plugin_segment(v, "version").is_ok())
            .collect();
        versions.sort_unstable();

        if versions.is_empty() {
            None
        } else if versions.iter().any(|v| v == DEFAULT_PLUGIN_VERSION) {
            Some(DEFAULT_PLUGIN_VERSION.to_string())
        } else {
            versions.pop()
        }
    }

    pub fn active_plugin_root(&self, id: &PluginId) -> Option<PathBuf> {
        self.active_plugin_version(id)
            .map(|v| self.plugin_root(id, &v))
    }

    pub fn is_installed(&self, id: &PluginId) -> bool {
        self.active_plugin_version(id).is_some()
    }

    /// Copy `source_path` into `~/.solo/plugins/cache/<marketplace>/<name>/<version>/`.
    /// Fails if the destination already exists or `source_path` is not a directory.
    pub fn install_local(
        &self,
        source_path: &Path,
        id: PluginId,
        version: &str,
    ) -> Result<PluginInstallResult, PluginStoreError> {
        if !source_path.is_dir() {
            return Err(PluginStoreError::Invalid(format!(
                "source path is not a directory: {}",
                source_path.display()
            )));
        }
        validate_plugin_segment(version, "version")
            .map_err(PluginStoreError::Invalid)?;

        let destination = self.plugin_root(&id, version);
        if destination.exists() {
            return Err(PluginStoreError::Invalid(format!(
                "plugin already installed: {}",
                destination.display()
            )));
        }
        fs::create_dir_all(destination.parent().unwrap())?;
        copy_dir_recursive(source_path, &destination)?;

        let installed_path = AbsolutePathBuf::try_from_absolute(&destination)?;
        Ok(PluginInstallResult {
            id,
            version: version.to_string(),
            installed_path,
        })
    }

    /// Remove every version directory for this plugin, and the plugin's own
    /// directory when empty. No-op if the plugin is not installed — well,
    /// returns Invalid; callers generally want to check is_installed first.
    pub fn uninstall(&self, id: &PluginId) -> Result<(), PluginStoreError> {
        let base = self.plugin_base_root(id);
        if !base.exists() {
            return Err(PluginStoreError::Invalid(format!(
                "plugin not installed: {}/{}",
                id.marketplace, id.name
            )));
        }
        fs::remove_dir_all(&base)?;
        // Remove the marketplace dir if it's now empty.
        if let Some(mk_dir) = base.parent() {
            if mk_dir.exists() && fs::read_dir(mk_dir).map(|mut i| i.next().is_none()).unwrap_or(false) {
                let _ = fs::remove_dir(mk_dir);
            }
        }
        Ok(())
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if ty.is_file() {
            fs::copy(&from, &to)?;
        }
        // Silently skip symlinks and other file types. Plugin directories are
        // expected to be plain files + dirs; symlinks would introduce escape risks.
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn id(marketplace: &str, name: &str) -> PluginId {
        PluginId::new(marketplace.into(), name.into()).unwrap()
    }

    fn make_version_dir(store: &PluginStore, id: &PluginId, version: &str) {
        let p = store.plugin_root(id, version);
        fs::create_dir_all(p).unwrap();
    }

    #[test]
    fn active_version_none_for_missing_plugin() {
        let tmp = tempdir().unwrap();
        let store = PluginStore::new(tmp.path().to_path_buf());
        assert_eq!(store.active_plugin_version(&id("local", "missing")), None);
    }

    #[test]
    fn active_version_picks_highest_semver() {
        let tmp = tempdir().unwrap();
        let store = PluginStore::new(tmp.path().to_path_buf());
        let plugin = id("local", "sample");
        make_version_dir(&store, &plugin, "1-0-0");
        make_version_dir(&store, &plugin, "2-0-0");
        make_version_dir(&store, &plugin, "1-5-0");
        assert_eq!(
            store.active_plugin_version(&plugin),
            Some("2-0-0".to_string())
        );
    }

    #[test]
    fn active_version_prefers_local_sentinel() {
        let tmp = tempdir().unwrap();
        let store = PluginStore::new(tmp.path().to_path_buf());
        let plugin = id("local", "sample");
        make_version_dir(&store, &plugin, "1-0-0");
        make_version_dir(&store, &plugin, "local");
        make_version_dir(&store, &plugin, "2-0-0");
        assert_eq!(
            store.active_plugin_version(&plugin),
            Some("local".to_string())
        );
    }

    #[test]
    fn active_version_ignores_invalid_segment_dirs() {
        let tmp = tempdir().unwrap();
        let store = PluginStore::new(tmp.path().to_path_buf());
        let plugin = id("local", "sample");
        let base = store.plugin_base_root(&plugin);
        fs::create_dir_all(base.join("1-0-0")).unwrap();
        // Create an invalid dir name that must be skipped.
        fs::create_dir_all(base.join("not.a.version")).unwrap();
        assert_eq!(
            store.active_plugin_version(&plugin),
            Some("1-0-0".to_string())
        );
    }

    fn write_plugin(root: &Path, manifest_name: &str) {
        fs::create_dir_all(root.join(".solo-plugin")).unwrap();
        fs::write(
            root.join(".solo-plugin/plugin.json"),
            format!(r#"{{"name":"{manifest_name}"}}"#),
        )
        .unwrap();
    }

    #[test]
    fn install_copies_directory_into_cache() {
        let tmp_cache = tempdir().unwrap();
        let tmp_src = tempdir().unwrap();
        let store = PluginStore::new(tmp_cache.path().to_path_buf());
        let src = tmp_src.path().join("plugin-src");
        write_plugin(&src, "sample");

        let result = store
            .install_local(&src, id("local", "sample"), "local")
            .unwrap();

        assert_eq!(result.version, "local");
        assert!(result.installed_path.as_path().join(".solo-plugin/plugin.json").is_file());
    }

    #[test]
    fn install_rejects_duplicate() {
        let tmp_cache = tempdir().unwrap();
        let tmp_src = tempdir().unwrap();
        let store = PluginStore::new(tmp_cache.path().to_path_buf());
        let src = tmp_src.path().join("plugin-src");
        write_plugin(&src, "sample");

        store.install_local(&src, id("local", "sample"), "local").unwrap();
        let err = store
            .install_local(&src, id("local", "sample"), "local")
            .unwrap_err();
        assert!(matches!(err, PluginStoreError::Invalid(_)), "got: {err:?}");
    }

    #[test]
    fn install_rejects_non_directory_source() {
        let tmp_cache = tempdir().unwrap();
        let tmp_src = tempdir().unwrap();
        let store = PluginStore::new(tmp_cache.path().to_path_buf());
        let file = tmp_src.path().join("not-a-dir");
        fs::write(&file, "").unwrap();
        let err = store
            .install_local(&file, id("local", "x"), "local")
            .unwrap_err();
        assert!(matches!(err, PluginStoreError::Invalid(_)));
    }

    #[test]
    fn uninstall_removes_version_directory() {
        let tmp_cache = tempdir().unwrap();
        let tmp_src = tempdir().unwrap();
        let store = PluginStore::new(tmp_cache.path().to_path_buf());
        let src = tmp_src.path().join("plugin-src");
        write_plugin(&src, "sample");
        store.install_local(&src, id("local", "sample"), "local").unwrap();

        assert!(store.is_installed(&id("local", "sample")));
        store.uninstall(&id("local", "sample")).unwrap();
        assert!(!store.is_installed(&id("local", "sample")));
    }

    #[test]
    fn uninstall_missing_plugin_errors() {
        let tmp_cache = tempdir().unwrap();
        let store = PluginStore::new(tmp_cache.path().to_path_buf());
        let err = store.uninstall(&id("local", "missing")).unwrap_err();
        assert!(matches!(err, PluginStoreError::Invalid(_)));
    }
}
