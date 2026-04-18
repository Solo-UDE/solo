//! Integration test: voice:level emission during Recording.
//!
//! Asserts that `on_level` is called at least 2 times when recording
//! ~80ms of audio. The sampling interval is 20ms (50 Hz), so we expect
//! approximately 4 ticks in an 80ms window.

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
async fn rms_level_emits_during_recording() {
    let stt: Arc<dyn SttProvider> = Arc::new(MockStt { canned: "x".into() });
    let fmt: Arc<dyn FormatterProvider> = Arc::new(CloudFormatter {
        model: "x".into(),
        client: CannedChat("x"),
    });
    let ring = AudioRing::new();
    let on_state = Arc::new(|_: &PipelineState| {});
    let levels = Arc::new(Mutex::new(Vec::<f32>::new()));
    let levels_c = levels.clone();
    let on_level = Arc::new(move |r: f32| levels_c.lock().unwrap().push(r));

    let p = VoicePipeline::new(stt, fmt, ring.clone(), on_state, on_level);
    p.begin().await.unwrap();
    ring.push(&vec![0.25f32; 16_000]);

    // Give the sampler a few ticks (20ms each, expecting ~4 in 80ms)
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;

    p.end(
        VoiceMode::Dictation, PipelineTarget::ChatInput,
        AppContext::default(), DictationOptions::default(),
    ).await.unwrap();

    let count = levels.lock().unwrap().len();
    assert!(count >= 2, "expected >=2 level emissions, got {count}");
}
