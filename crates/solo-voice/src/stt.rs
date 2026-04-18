use crate::error::{Result, VoiceError};
use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Abstracts the STT backend so tests (and future MLX path) can swap impls.
#[async_trait]
pub trait SttProvider: Send + Sync {
    /// Transcribe a mono f32 16-kHz PCM buffer.
    async fn transcribe(&self, samples: &[f32]) -> Result<String>;
}

/// Sherpa-ONNX + NVIDIA Parakeet TDT 0.6B offline.
///
/// Uses `sherpa_rs::transducer::TransducerRecognizer` which is `Send + Sync`
/// but not `Clone`, so we wrap it in `Arc<Mutex<...>>` and clone the Arc into
/// `spawn_blocking` for non-blocking async execution.
pub struct SherpaParakeet {
    recognizer: Arc<Mutex<sherpa_rs::transducer::TransducerRecognizer>>,
}

pub struct SherpaConfig {
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    pub joiner: PathBuf,
    pub tokens: PathBuf,
    pub num_threads: usize,
}

impl SherpaParakeet {
    pub fn new(cfg: SherpaConfig) -> Result<Self> {
        let config = sherpa_rs::transducer::TransducerConfig {
            encoder: cfg.encoder.to_string_lossy().to_string(),
            decoder: cfg.decoder.to_string_lossy().to_string(),
            joiner: cfg.joiner.to_string_lossy().to_string(),
            tokens: cfg.tokens.to_string_lossy().to_string(),
            num_threads: cfg.num_threads as i32,
            ..Default::default()
        };
        let recognizer = sherpa_rs::transducer::TransducerRecognizer::new(config)
            .map_err(|e| VoiceError::Stt(e.to_string()))?;
        Ok(Self {
            recognizer: Arc::new(Mutex::new(recognizer)),
        })
    }
}

#[async_trait]
impl SttProvider for SherpaParakeet {
    async fn transcribe(&self, samples: &[f32]) -> Result<String> {
        // sherpa is blocking; run on blocking pool.
        let samples = samples.to_vec();
        let recognizer = Arc::clone(&self.recognizer);
        tokio::task::spawn_blocking(move || {
            let mut guard = recognizer.lock().unwrap();
            guard.transcribe(16_000, &samples).trim().to_string()
        })
        .await
        .map_err(|e| VoiceError::Stt(e.to_string()))
    }
}

/// Mock used by pipeline tests.
pub struct MockStt {
    pub canned: String,
}

#[async_trait]
impl SttProvider for MockStt {
    async fn transcribe(&self, _samples: &[f32]) -> Result<String> {
        Ok(self.canned.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_returns_canned() {
        let s = MockStt {
            canned: "hello world".into(),
        };
        let out = s.transcribe(&[]).await.unwrap();
        assert_eq!(out, "hello world");
    }
}
