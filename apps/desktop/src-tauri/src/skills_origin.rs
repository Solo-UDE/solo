//! `.solo-origin.json` — per-skill provenance tracking.
//!
//! Every skill installed by Solo gets a sibling `.solo-origin.json` recording
//! where it came from (registry / bundled / user) and whether the user has
//! locally tweaked it. Absence of the file means "user-authored" — we never
//! touch hand-crafted skills.

use solo_protocol::{InstalledSkillMeta, OriginSource};
use std::path::{Path, PathBuf};
use tokio::fs;

const ORIGIN_FILENAME: &str = ".solo-origin.json";

pub fn origin_path(skill_dir: &Path) -> PathBuf {
    skill_dir.join(ORIGIN_FILENAME)
}

/// Read the origin record for an installed skill. Returns `None` if the file
/// is absent or malformed — a user-authored skill looks identical to this.
pub async fn read_origin(skill_dir: &Path) -> Option<InstalledSkillMeta> {
    let path = origin_path(skill_dir);
    let raw = fs::read_to_string(&path).await.ok()?;
    serde_json::from_str::<InstalledSkillMeta>(&raw).ok()
}

pub async fn write_origin(skill_dir: &Path, meta: &InstalledSkillMeta) -> std::io::Result<()> {
    let path = origin_path(skill_dir);
    let json = serde_json::to_string_pretty(meta).map_err(std::io::Error::other)?;
    fs::write(&path, json).await
}

/// Flip `modified` to `true` on an installed-from-registry skill the user edited.
/// No-op if the skill has no origin record (i.e. it was user-authored to begin with).
#[allow(dead_code)] // Wired by Phase 5 (agent tweak flow).
pub async fn mark_modified(skill_dir: &Path) -> std::io::Result<()> {
    if let Some(mut meta) = read_origin(skill_dir).await {
        if !meta.modified {
            meta.modified = true;
            return write_origin(skill_dir, &meta).await;
        }
    }
    Ok(())
}

/// Convenience: build a `registry`-source meta for a fresh install.
#[allow(dead_code)] // Wired by Phase 3 (skills_install command).
pub fn registry_meta(
    id: &str,
    version: &str,
    upstream_sha256: Option<String>,
) -> InstalledSkillMeta {
    InstalledSkillMeta {
        source: OriginSource::Registry,
        id: id.to_string(),
        version: version.to_string(),
        installed_at: chrono::Utc::now().to_rfc3339(),
        modified: false,
        upstream_sha256,
    }
}

/// Convenience: build a `bundled`-source meta for first-launch extraction.
pub fn bundled_meta(id: &str, version: &str) -> InstalledSkillMeta {
    InstalledSkillMeta {
        source: OriginSource::Bundled,
        id: id.to_string(),
        version: version.to_string(),
        installed_at: chrono::Utc::now().to_rfc3339(),
        modified: false,
        upstream_sha256: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn round_trips_origin() {
        let tmp = tempfile::tempdir().unwrap();
        let meta = registry_meta("ui", "1.0.0", Some("abc".into()));
        write_origin(tmp.path(), &meta).await.unwrap();
        let back = read_origin(tmp.path()).await.unwrap();
        assert_eq!(back.id, "ui");
        assert_eq!(back.source, OriginSource::Registry);
        assert!(!back.modified);
        assert_eq!(back.upstream_sha256, Some("abc".into()));
    }

    #[tokio::test]
    async fn mark_modified_flips_flag() {
        let tmp = tempfile::tempdir().unwrap();
        let meta = registry_meta("ui", "1.0.0", None);
        write_origin(tmp.path(), &meta).await.unwrap();
        mark_modified(tmp.path()).await.unwrap();
        let back = read_origin(tmp.path()).await.unwrap();
        assert!(back.modified);
    }

    #[tokio::test]
    async fn mark_modified_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let meta = registry_meta("ui", "1.0.0", None);
        write_origin(tmp.path(), &meta).await.unwrap();
        mark_modified(tmp.path()).await.unwrap();
        mark_modified(tmp.path()).await.unwrap();
        let back = read_origin(tmp.path()).await.unwrap();
        assert!(back.modified);
    }

    #[tokio::test]
    async fn missing_origin_returns_none() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(read_origin(tmp.path()).await.is_none());
    }

    #[tokio::test]
    async fn mark_modified_noop_on_missing_origin() {
        let tmp = tempfile::tempdir().unwrap();
        // Should not error even though there's no origin file.
        mark_modified(tmp.path()).await.unwrap();
        assert!(read_origin(tmp.path()).await.is_none());
    }

    #[test]
    fn bundled_meta_uses_bundled_source() {
        let m = bundled_meta("ui", "1.0.0");
        assert_eq!(m.source, OriginSource::Bundled);
        assert_eq!(m.id, "ui");
        assert!(!m.modified);
        assert!(m.upstream_sha256.is_none());
    }
}
