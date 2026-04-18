use crate::audio::AudioRing;
use crate::error::{Result, VoiceError};
use crate::formatter::{AppContext, DictationOptions, FormatterProvider};
use crate::mode::{PipelineTarget, VoiceMode};
use crate::stt::SttProvider;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Mirrors `solo_protocol::VoicePipelineState`. Serde representation matches
/// the protocol's tagged union (`{ "kind": "...", "data": ... }`), so values
/// can be emitted to the frontend directly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum PipelineState {
    Idle,
    Arming,
    Recording,
    Transcribing,
    Formatting,
    Emitting,
    Error(String),
}

#[derive(Debug, Clone)]
pub struct PipelineOutput {
    pub id: String,
    pub mode: VoiceMode,
    pub raw_transcript: String,
    pub formatted: String,
    pub duration_ms: u32,
}

pub struct VoicePipeline {
    stt: Arc<dyn SttProvider>,
    formatter: Arc<dyn FormatterProvider>,
    pub ring: AudioRing,
    state: Arc<Mutex<PipelineState>>,
    on_state: Arc<dyn Fn(&PipelineState) + Send + Sync>,
}

impl VoicePipeline {
    pub fn new(
        stt: Arc<dyn SttProvider>,
        formatter: Arc<dyn FormatterProvider>,
        ring: AudioRing,
        on_state: Arc<dyn Fn(&PipelineState) + Send + Sync>,
    ) -> Self {
        Self {
            stt,
            formatter,
            ring,
            state: Arc::new(Mutex::new(PipelineState::Idle)),
            on_state,
        }
    }

    pub async fn state(&self) -> PipelineState {
        self.state.lock().await.clone()
    }

    async fn set(&self, s: PipelineState) {
        {
            let mut g = self.state.lock().await;
            *g = s.clone();
        }
        (self.on_state)(&s);
    }

    /// Drives the happy path: transition Idle→Arming→Recording.
    /// The caller must feed `ring` externally (cpal stream does this).
    pub async fn begin(&self) -> Result<()> {
        let cur = self.state().await;
        if cur != PipelineState::Idle {
            return Err(VoiceError::BadState(format!("{cur:?}")));
        }
        self.set(PipelineState::Arming).await;
        self.ring.clear();
        self.set(PipelineState::Recording).await;
        Ok(())
    }

    /// Called on end-of-speech. Drains the ring, transcribes, formats,
    /// returns output. Caller handles the mode-specific tail (paste,
    /// dispatch, or chat-input emit).
    pub async fn end(
        &self,
        mode: VoiceMode,
        _target: PipelineTarget,
        context: AppContext,
        options: DictationOptions,
    ) -> Result<PipelineOutput> {
        let cur = self.state().await;
        if cur != PipelineState::Recording {
            return Err(VoiceError::BadState(format!("{cur:?}")));
        }
        let started = std::time::Instant::now();
        let samples = self.ring.drain_all();
        if samples.is_empty() {
            self.set(PipelineState::Idle).await;
            return Err(VoiceError::Audio("no audio captured".into()));
        }

        self.set(PipelineState::Transcribing).await;
        let raw = self.stt.transcribe(&samples).await?;

        self.set(PipelineState::Formatting).await;
        let formatted = match mode {
            VoiceMode::Dictation => {
                self.formatter
                    .format_dictation(&raw, context.clone(), options.clone())
                    .await?
            }
            VoiceMode::Dispatch => {
                // Phase 1 does not drive dispatch; returning structured JSON
                // is handled in Phase 3. Kept here so the state machine is
                // correct when that phase ships.
                let task = self
                    .formatter
                    .format_dispatch(&raw, context.clone())
                    .await?;
                format!("{}\n\n{}", task.title, task.prompt)
            }
        };

        self.set(PipelineState::Emitting).await;
        let output = PipelineOutput {
            id: uuid::Uuid::new_v4().to_string(),
            mode,
            raw_transcript: raw,
            formatted,
            duration_ms: started.elapsed().as_millis() as u32,
        };
        self.set(PipelineState::Idle).await;
        Ok(output)
    }

    pub async fn cancel(&self) {
        self.ring.clear();
        self.set(PipelineState::Idle).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formatter::{CloudFormatter, ChatClient};
    use crate::stt::MockStt;
    use async_trait::async_trait;

    struct CannedChat(&'static str);
    #[async_trait]
    impl ChatClient for CannedChat {
        async fn simple_completion(&self, _m: &str, _s: &str, _u: &str) -> Result<String> {
            Ok(self.0.to_string())
        }
    }

    fn build() -> VoicePipeline {
        let stt: Arc<dyn SttProvider> = Arc::new(MockStt {
            canned: "hello world".into(),
        });
        let formatter: Arc<dyn FormatterProvider> = Arc::new(CloudFormatter {
            model: "x".into(),
            client: CannedChat("Hello, world."),
        });
        let ring = AudioRing::new();
        let on_state = Arc::new(|_: &PipelineState| {});
        VoicePipeline::new(stt, formatter, ring, on_state)
    }

    #[tokio::test]
    async fn happy_path_dictation() {
        let p = build();
        p.begin().await.unwrap();
        // Push 1 second of dummy audio AFTER begin() clears the ring.
        p.ring.push(&vec![0.1f32; 16_000]);
        let out = p
            .end(
                VoiceMode::Dictation,
                PipelineTarget::ChatInput,
                AppContext::default(),
                DictationOptions::default(),
            )
            .await
            .unwrap();
        assert_eq!(out.raw_transcript, "hello world");
        assert_eq!(out.formatted, "Hello, world.");
        assert_eq!(p.state().await, PipelineState::Idle);
    }

    #[tokio::test]
    async fn end_without_begin_errors() {
        let p = build();
        let err = p
            .end(
                VoiceMode::Dictation,
                PipelineTarget::ChatInput,
                AppContext::default(),
                DictationOptions::default(),
            )
            .await
            .unwrap_err();
        assert!(matches!(err, VoiceError::BadState(_)));
    }

    #[tokio::test]
    async fn cancel_returns_to_idle() {
        let p = build();
        p.begin().await.unwrap();
        p.cancel().await;
        assert_eq!(p.state().await, PipelineState::Idle);
    }
}
