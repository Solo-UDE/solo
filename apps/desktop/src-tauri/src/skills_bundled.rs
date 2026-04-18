//! Bundled skills — markdown content compiled into the app binary.
//!
//! Solo ships with the `ui` skill by default, extracted to `~/.solo/skills/ui/`
//! on first launch. The normal marketplace update path can later replace the
//! extracted copy with a newer registry version, so users aren't locked to
//! whatever shipped with the app.

use crate::skills_origin::{self, origin_path};
use include_dir::{include_dir, Dir};
use std::path::Path;
use tokio::fs;

static BUNDLED_UI: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/bundled-skills/ui");
const BUNDLED_UI_VERSION: &str = "1.0.0";
const BUNDLED_UI_ID: &str = "ui";

/// Extract the bundled UI skill if it's not already present on disk.
/// Idempotent: subsequent launches are a no-op unless the skill dir was deleted.
///
/// Returns `Ok(true)` if extraction ran, `Ok(false)` if the skill was already present.
pub async fn extract_bundled_if_missing(user_skills_dir: &Path) -> std::io::Result<bool> {
    let dest = user_skills_dir.join(BUNDLED_UI_ID);
    if origin_path(&dest).exists() {
        return Ok(false);
    }
    fs::create_dir_all(&dest).await?;
    extract_dir(&BUNDLED_UI, &dest).await?;
    let meta = skills_origin::bundled_meta(BUNDLED_UI_ID, BUNDLED_UI_VERSION);
    skills_origin::write_origin(&dest, &meta).await?;
    Ok(true)
}

fn extract_dir<'a>(
    dir: &'a Dir<'a>,
    dest: &'a Path,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = std::io::Result<()>> + Send + 'a>> {
    Box::pin(async move {
        for file in dir.files() {
            let rel = file.path().file_name().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "missing filename")
            })?;
            let out = dest.join(rel);
            fs::write(out, file.contents()).await?;
        }
        for sub in dir.dirs() {
            let rel = sub.path().file_name().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "missing dirname")
            })?;
            let out = dest.join(rel);
            fs::create_dir_all(&out).await?;
            extract_dir(sub, &out).await?;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn extract_on_first_run_creates_origin_and_files() {
        let tmp = tempfile::tempdir().unwrap();
        let ran = extract_bundled_if_missing(tmp.path()).await.unwrap();
        assert!(ran);
        assert!(tmp.path().join("ui").join("AGENTS.md").exists());
        assert!(tmp.path().join("ui").join(".solo-origin.json").exists());
        assert!(tmp.path().join("ui").join("ui-picker.md").exists());
        assert!(tmp.path().join("ui").join("design-guidelines").is_dir());
    }

    #[tokio::test]
    async fn second_run_is_noop() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(extract_bundled_if_missing(tmp.path()).await.unwrap());
        assert!(!extract_bundled_if_missing(tmp.path()).await.unwrap());
    }

    #[tokio::test]
    async fn origin_records_bundled_source() {
        let tmp = tempfile::tempdir().unwrap();
        extract_bundled_if_missing(tmp.path()).await.unwrap();
        let meta = skills_origin::read_origin(&tmp.path().join("ui"))
            .await
            .expect("origin must be present after extraction");
        assert_eq!(meta.id, BUNDLED_UI_ID);
        assert_eq!(meta.version, BUNDLED_UI_VERSION);
        assert_eq!(meta.source, solo_protocol::OriginSource::Bundled);
        assert!(!meta.modified);
    }
}
