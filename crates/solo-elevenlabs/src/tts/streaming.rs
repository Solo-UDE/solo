use futures_util::StreamExt;
use reqwest::Client;
use serde_json::json;

use crate::audio::encode_base64_audio;
use crate::config::TtsConfig;
use crate::error::ElevenLabsError;

use super::types::TtsAudioEvent;

const TTS_API_BASE: &str = "https://api.elevenlabs.io/v1/text-to-speech";

/// Streaming TTS client using ElevenLabs HTTP streaming API
pub struct TtsStreamClient {
    http: Client,
}

impl TtsStreamClient {
    pub fn new() -> Self {
        Self {
            http: Client::new(),
        }
    }

    /// Stream text-to-speech audio for the given text.
    ///
    /// Calls the ElevenLabs streaming endpoint and emits audio chunks
    /// via the `on_audio` callback as they arrive.
    pub async fn stream_text<F>(
        &self,
        text: &str,
        config: &TtsConfig,
        api_key: &str,
        on_audio: F,
    ) -> Result<(), ElevenLabsError>
    where
        F: Fn(TtsAudioEvent) + Send + Sync + 'static,
    {
        let url = format!(
            "{}/{}/stream?output_format={}",
            TTS_API_BASE,
            config.voice_id,
            config.output_format.as_str()
        );

        let body = json!({
            "text": text,
            "model_id": config.model_id,
            "voice_settings": {
                "stability": config.stability,
                "similarity_boost": config.similarity_boost
            }
        });

        let response = self
            .http
            .post(&url)
            .header("xi-api-key", api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| ElevenLabsError::HttpError(format!("TTS request: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body_text = response.text().await.unwrap_or_default();
            return Err(ElevenLabsError::HttpError(format!(
                "TTS error {status}: {body_text}"
            )));
        }

        let sample_rate = config.output_format.sample_rate();
        let mut stream = response.bytes_stream();

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(bytes) => {
                    let b64 = encode_base64_audio(&bytes);
                    on_audio(TtsAudioEvent::AudioChunk {
                        chunk: b64,
                        sample_rate,
                    });
                }
                Err(e) => {
                    on_audio(TtsAudioEvent::Error {
                        message: format!("Stream read error: {e}"),
                    });
                    return Err(ElevenLabsError::HttpError(format!("Stream read: {e}")));
                }
            }
        }

        on_audio(TtsAudioEvent::Done);
        Ok(())
    }
}

impl Default for TtsStreamClient {
    fn default() -> Self {
        Self::new()
    }
}
