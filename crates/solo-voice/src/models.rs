use crate::error::{Result, VoiceError};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Serialize)]
pub struct ModelManifest {
    pub id: &'static str,
    pub display_name: &'static str,
    pub files: &'static [ModelFile],
    pub install_dir: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelFile {
    pub url: &'static str,
    pub relative_path: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
}

pub const PARAKEET: ModelManifest = ModelManifest {
    id: "parakeet-tdt-0.6b-v2",
    display_name: "Parakeet TDT 0.6B (int8)",
    install_dir: "parakeet-tdt-0.6b-v2",
    files: &[
        ModelFile {
            url: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/encoder.int8.onnx",
            relative_path: "encoder.int8.onnx",
            sha256: "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD",
            size_bytes: 0,
        },
        ModelFile {
            url: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/decoder.int8.onnx",
            relative_path: "decoder.int8.onnx",
            sha256: "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD",
            size_bytes: 0,
        },
        ModelFile {
            url: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/joiner.int8.onnx",
            relative_path: "joiner.int8.onnx",
            sha256: "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD",
            size_bytes: 0,
        },
        ModelFile {
            url: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/tokens.txt",
            relative_path: "tokens.txt",
            sha256: "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD",
            size_bytes: 0,
        },
    ],
};

/// Verify a file's SHA-256 against an expected hex string.
/// If `expected == "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD"`, returns Ok
/// (first-run capture mode — developer pins the hash after first successful download).
pub fn verify_sha256(path: &Path, expected: &str) -> Result<()> {
    if expected == "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD" {
        tracing::warn!(
            "SHA-256 not pinned for {}; capture and pin it.",
            path.display()
        );
        return Ok(());
    }
    let mut hasher = Sha256::new();
    let bytes = std::fs::read(path)?;
    hasher.update(&bytes);
    let actual = format!("{:x}", hasher.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(VoiceError::ModelIntegrity {
            expected: expected.into(),
            actual,
        })
    }
}

pub fn install_dir(models_root: &Path, manifest: &ModelManifest) -> PathBuf {
    models_root.join(manifest.install_dir)
}

pub fn is_installed(models_root: &Path, manifest: &ModelManifest) -> bool {
    let dir = install_dir(models_root, manifest);
    if !dir.is_dir() {
        return false;
    }
    manifest
        .files
        .iter()
        .all(|f| dir.join(f.relative_path).is_file())
}

/// Download a single ModelFile with resume via HTTP Range.
/// Calls `progress(bytes_so_far, total_bytes)` for UI reporting.
pub async fn download_file<F: Fn(u64, u64) + Send>(
    file: &ModelFile,
    dest_dir: &Path,
    progress: F,
) -> Result<()> {
    let dest_final = dest_dir.join(file.relative_path);
    let dest_tmp = dest_dir.join(format!("{}.tmp", file.relative_path));
    if let Some(parent) = dest_final.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let client = reqwest::Client::builder()
        .user_agent("solo-voice/0.1")
        .build()
        .map_err(|e| VoiceError::ModelDownload(e.to_string()))?;

    let mut req = client.get(file.url);
    let existing_bytes = std::fs::metadata(&dest_tmp).map(|m| m.len()).unwrap_or(0);
    if existing_bytes > 0 {
        req = req.header("Range", format!("bytes={}-", existing_bytes));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| VoiceError::ModelDownload(e.to_string()))?
        .error_for_status()
        .map_err(|e| VoiceError::ModelDownload(e.to_string()))?;

    let total = resp
        .content_length()
        .map(|c| c + existing_bytes)
        .unwrap_or(file.size_bytes.max(existing_bytes));

    let mut f = tokio::fs::OpenOptions::new()
        .create(true)
        .append(existing_bytes > 0)
        .write(true)
        .truncate(existing_bytes == 0)
        .open(&dest_tmp)
        .await?;

    let mut downloaded = existing_bytes;
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| VoiceError::ModelDownload(e.to_string()))?;
        f.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;
        progress(downloaded, total);
    }
    f.flush().await?;
    drop(f);

    verify_sha256(&dest_tmp, file.sha256)?;
    std::fs::rename(&dest_tmp, &dest_final)?;
    Ok(())
}

/// Download every file in a manifest. Idempotent — already-installed files are skipped.
pub async fn download_manifest<F: Fn(u64, u64) + Send + Clone>(
    manifest: &ModelManifest,
    models_root: &Path,
    progress: F,
) -> Result<()> {
    let dir = install_dir(models_root, manifest);
    std::fs::create_dir_all(&dir)?;
    for f in manifest.files {
        if dir.join(f.relative_path).is_file() {
            continue;
        }
        download_file(f, &dir, progress.clone()).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn verify_sha256_accepts_placeholder() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("f");
        std::fs::write(&p, b"hello").unwrap();
        verify_sha256(&p, "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD").unwrap();
    }

    #[test]
    fn verify_sha256_matches_real_hash() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("f");
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(b"hello").unwrap();
        let expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        verify_sha256(&p, expected).unwrap();
    }

    #[test]
    fn verify_sha256_rejects_mismatch() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("f");
        std::fs::write(&p, b"hello").unwrap();
        let err = verify_sha256(&p, "deadbeef").unwrap_err();
        assert!(matches!(err, VoiceError::ModelIntegrity { .. }));
    }

    #[test]
    fn is_installed_detects_missing_dir() {
        let dir = tempdir().unwrap();
        assert!(!is_installed(dir.path(), &PARAKEET));
    }
}
