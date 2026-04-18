//! End-to-end pipeline test using MockStt + a fake ChatClient.
//! Exercises begin → feed audio → end → formatted output.

use solo_voice::{
    audio::AudioRing,
    formatter::{ChatClient, CloudFormatter, DictationOptions, AppContext, FormatterProvider},
    mode::{PipelineTarget, VoiceMode},
    pipeline::{PipelineState, VoicePipeline},
    stt::{MockStt, SttProvider},
};
use std::sync::{Arc, Mutex};
use async_trait::async_trait;

struct CannedChat(&'static str);
#[async_trait]
impl ChatClient for CannedChat {
    async fn simple_completion(&self, _m: &str, _s: &str, _u: &str)
        -> solo_voice::error::Result<String>
    {
        Ok(self.0.to_string())
    }
}

#[tokio::test]
async fn end_to_end_dictation() {
    let stt: Arc<dyn SttProvider> = Arc::new(MockStt { canned: "hello world".into() });
    let formatter: Arc<dyn FormatterProvider> = Arc::new(CloudFormatter {
        model: "x".into(),
        client: CannedChat("Hello, world."),
    });
    let ring = AudioRing::new();

    let states = Arc::new(Mutex::new(Vec::<PipelineState>::new()));
    let states_c = states.clone();
    let on_state = Arc::new(move |s: &PipelineState| states_c.lock().unwrap().push(s.clone()));

    let on_level = Arc::new(|_: f32| {});
    let pipeline = VoicePipeline::new(stt, formatter, ring.clone(), on_state, on_level);

    pipeline.begin().await.unwrap();

    // Simulate audio AFTER begin (begin() clears the ring; AudioRing is Clone
    // with internal Arc, so pushes on our handle land in the pipeline's ring).
    ring.push(&vec![0.1f32; 16_000]); // 1 s

    let out = pipeline
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
    let seen = states.lock().unwrap().clone();
    let names: Vec<&'static str> = seen
        .iter()
        .map(|s| match s {
            PipelineState::Idle => "Idle",
            PipelineState::Arming => "Arming",
            PipelineState::Recording => "Recording",
            PipelineState::Transcribing => "Transcribing",
            PipelineState::Formatting => "Formatting",
            PipelineState::Emitting => "Emitting",
            PipelineState::Error(_) => "Error",
        })
        .collect();
    assert_eq!(names, vec![
        "Arming", "Recording", "Transcribing", "Formatting", "Emitting", "Idle"
    ]);
}
