//! Local ONNX-backed embedding provider for the vault.
//!
//! Uses [`fastembed`](https://github.com/Anush008/fastembed-rs) with the
//! `all-MiniLM-L6-v2` model (384 dimensions, ~90 MB). Runs on CPU via ONNX
//! Runtime — no network per inference, no API key, no per-user cost.
//!
//! Model weights are lazy-downloaded to `<vault_root>/models/` on first
//! call to [`LocalEmbeddingProvider::load`]. The download is a blocking
//! operation (happens inside `spawn_blocking`) and the caller is expected
//! to wrap it in a background task so the app stays responsive.
//!
//! ## Trade-off vs `OpenAI`
//! - Quality: `all-MiniLM-L6-v2` scores ~61 MTEB vs ~62 for `OpenAI-3-small`.
//!   Retrieval precision is comparable for the common "find the doc I put
//!   in here" use case.
//! - Dim: 384 vs 1536 → 4× less storage per chunk, faster cosine scans.
//! - Setup: zero. No key. Works offline after first download.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use fastembed::{Embedding as FastEmbed, EmbeddingModel, InitOptions, TextEmbedding};
use solo_embeddings::{Embedding, EmbeddingError, EmbeddingProvider, EmbeddingResult};
use tracing::{info, warn};

/// Dimensionality of `AllMiniLML6V2` — matches the V1.2.1 `EMBEDDING_DIM`
/// constant in `store.rs`. Keep these in sync; breaking changes will
/// surface as dim-mismatch errors at query time (and auto-null the rows,
/// which is actually the desired migration behavior).
pub const LOCAL_DIM: usize = 384;

const MODEL_NAME: &str = "all-MiniLM-L6-v2";

pub struct LocalEmbeddingProvider {
    // `TextEmbedding` is neither Clone nor Sync — wrap in Mutex + Arc so
    // multiple concurrent `embed` calls serialize safely through a single
    // ONNX session.
    inner: Arc<Mutex<TextEmbedding>>,
    cache_dir: PathBuf,
}

impl LocalEmbeddingProvider {
    /// Load (or download on first call) the `MiniLM` model into an on-disk
    /// cache under `<vault_root>/models/`. Runs `fastembed::TextEmbedding::try_new`
    /// inside `spawn_blocking` so we don't stall the tokio reactor.
    pub async fn load(vault_root: &Path) -> EmbeddingResult<Self> {
        let cache_dir = vault_root.join("models");
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| EmbeddingError::Other(format!("mkdir models: {e}")))?;

        info!(cache_dir = %cache_dir.display(), model = MODEL_NAME, "vault.local_embed.loading");
        let start = std::time::Instant::now();

        let cache_for_task = cache_dir.clone();
        let model = tokio::task::spawn_blocking(move || {
            let options = InitOptions::new(EmbeddingModel::AllMiniLML6V2)
                .with_cache_dir(cache_for_task)
                .with_show_download_progress(false);
            TextEmbedding::try_new(options)
        })
        .await
        .map_err(|e| EmbeddingError::Other(format!("join: {e}")))?
        .map_err(|e| EmbeddingError::Other(format!("fastembed init: {e}")))?;

        info!(
            load_ms = start.elapsed().as_millis() as u64,
            "vault.local_embed.ready"
        );

        Ok(Self {
            inner: Arc::new(Mutex::new(model)),
            cache_dir,
        })
    }

    /// Directory on disk where the ONNX weights live. Exposed for UX
    /// affordances (e.g. a "Reveal model cache" menu item).
    #[allow(dead_code)]
    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }
}

#[async_trait]
impl EmbeddingProvider for LocalEmbeddingProvider {
    async fn embed(&self, text: &str) -> EmbeddingResult<Embedding> {
        // Single-text shortcut — still goes through embed_many so we share
        // the spawn_blocking path.
        let mut vecs = self.embed_many(&[text.to_string()]).await?;
        vecs.pop().ok_or_else(|| {
            EmbeddingError::Other("fastembed returned zero vectors for single input".into())
        })
    }

    async fn embed_many(&self, texts: &[String]) -> EmbeddingResult<Vec<Embedding>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        // fastembed expects `Vec<String>`. Clone once; CPU inference will
        // dominate allocation anyway.
        let owned: Vec<String> = texts.to_vec();
        let model = self.inner.clone();

        let raw: Vec<FastEmbed> = tokio::task::spawn_blocking(move || {
            let mut guard = model
                .lock()
                .map_err(|_| EmbeddingError::Other("local embed mutex poisoned".to_string()))?;
            guard
                .embed(owned, None)
                .map_err(|e| EmbeddingError::Other(format!("fastembed embed: {e}")))
        })
        .await
        .map_err(|e| EmbeddingError::Other(format!("join: {e}")))??;

        // Shape sanity — if this ever fires, the model file is wrong and we
        // should re-download. For V1.2.1 we just surface a clear error.
        for (i, v) in raw.iter().enumerate() {
            if v.len() != LOCAL_DIM {
                warn!(
                    index = i,
                    got = v.len(),
                    expected = LOCAL_DIM,
                    "vault.local_embed.unexpected_dim"
                );
                return Err(EmbeddingError::Other(format!(
                    "local model returned {}-dim vector, expected {}",
                    v.len(),
                    LOCAL_DIM
                )));
            }
        }

        Ok(raw
            .into_iter()
            .map(|values| {
                let dimensions = values.len();
                Embedding { values, dimensions }
            })
            .collect())
    }

    fn dimensions(&self) -> usize {
        LOCAL_DIM
    }

    fn model_name(&self) -> &str {
        MODEL_NAME
    }
}
