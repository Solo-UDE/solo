//! Atomic persistence for `~/.solo/stats.json`.
//!
//! Writes use the classic temp-file-then-rename dance: even if the process is
//! killed mid-write, the old file remains intact and reads return the previous
//! snapshot. On POSIX the rename is atomic within the same filesystem; on
//! Windows `std::fs::rename` replaces atomically on NTFS as of Windows 10.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tokio::fs;
use tokio::sync::Mutex;

use crate::StatsSnapshot;

pub struct StatsStore {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl StatsStore {
    pub async fn new(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .await
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        Ok(Self {
            path,
            write_lock: Mutex::new(()),
        })
    }

    pub async fn load(&self) -> Result<StatsSnapshot> {
        load_from(&self.path).await
    }

    pub async fn save(&self, snapshot: &StatsSnapshot) -> Result<()> {
        let _guard = self.write_lock.lock().await;
        save_to(&self.path, snapshot).await
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

async fn load_from(path: &Path) -> Result<StatsSnapshot> {
    match fs::read(path).await {
        Ok(bytes) => {
            if bytes.is_empty() {
                return Ok(StatsSnapshot::default());
            }
            serde_json::from_slice(&bytes)
                .with_context(|| format!("parsing {}", path.display()))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(StatsSnapshot::default()),
        Err(err) => Err(err).with_context(|| format!("reading {}", path.display())),
    }
}

async fn save_to(path: &Path, snapshot: &StatsSnapshot) -> Result<()> {
    let serialized = serde_json::to_vec_pretty(snapshot)?;
    let tmp = tmp_sibling(path);
    fs::write(&tmp, &serialized)
        .await
        .with_context(|| format!("writing {}", tmp.display()))?;
    fs::rename(&tmp, path)
        .await
        .with_context(|| format!("renaming {} -> {}", tmp.display(), path.display()))?;
    Ok(())
}

fn tmp_sibling(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|s| s.to_os_string())
        .unwrap_or_else(|| std::ffi::OsString::from("stats.json"));
    name.push(".tmp");
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{StatsDelta, StatsSnapshot};

    #[tokio::test]
    async fn load_returns_default_when_file_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let store = StatsStore::new(tmp.path().join("stats.json")).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert!(loaded.pending.commits == 0);
    }

    #[tokio::test]
    async fn roundtrip_preserves_counters() {
        let tmp = tempfile::tempdir().unwrap();
        let store = StatsStore::new(tmp.path().join("stats.json")).await.unwrap();
        let snap = StatsSnapshot {
            pending: StatsDelta {
                commits: 7,
                tokens: 12345,
                worktrees: 2,
                sessions: 3,
                messages: 8,
            },
            ..StatsSnapshot::default()
        };
        store.save(&snap).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded.pending.commits, 7);
        assert_eq!(loaded.pending.tokens, 12345);
    }

    #[tokio::test]
    async fn save_is_atomic_leaves_no_tmp_file() {
        let tmp = tempfile::tempdir().unwrap();
        let store = StatsStore::new(tmp.path().join("stats.json")).await.unwrap();
        store.save(&StatsSnapshot::default()).await.unwrap();
        let tmp_path = tmp.path().join("stats.json.tmp");
        assert!(!tmp_path.exists(), "tmp file should be renamed away");
    }
}
