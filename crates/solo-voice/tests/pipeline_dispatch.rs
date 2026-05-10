//! End-to-end: mode=Dispatch returns a DispatchTask on PipelineOutput.

use async_trait::async_trait;
use solo_voice::{
    audio::AudioRing,
    formatter::{AppContext, ChatClient, CloudFormatter, DictationOptions, FormatterProvider},
    mode::{PipelineTarget, VoiceMode},
    pipeline::{PipelineState, VoicePipeline},
    stt::{MockStt, SttProvider},
};
use std::sync::Arc;

struct CannedChat(&'static str);
#[async_trait]
impl ChatClient for CannedChat {
    async fn simple_completion(
        &self,
        _m: &str,
        _s: &str,
        _u: &str,
    ) -> solo_voice::error::Result<String> {
        Ok(self.0.to_string())
    }
}

#[tokio::test]
async fn dispatch_returns_task() {
    let stt: Arc<dyn SttProvider> = Arc::new(MockStt {
        canned: "refactor auth".into(),
    });
    let json = r#"{"title":"Refactor auth","prompt":"Refactor the auth module."}"#;
    let fmt: Arc<dyn FormatterProvider> = Arc::new(CloudFormatter {
        model: "x".into(),
        client: CannedChat(json),
    });
    let ring = AudioRing::new();
    let p = VoicePipeline::new(
        stt,
        fmt,
        ring.clone(),
        Arc::new(|_: &PipelineState| {}),
        Arc::new(|_: f32| {}),
    );
    p.begin().await.unwrap();
    ring.push(&vec![0.1f32; 16_000]);
    let out = p
        .end(
            VoiceMode::Dispatch,
            PipelineTarget::NewAgentSession,
            AppContext::default(),
            DictationOptions::default(),
        )
        .await
        .unwrap();
    let task = out.dispatch_task.expect("dispatch task");
    assert_eq!(task.title, "Refactor auth");
    assert_eq!(task.prompt, "Refactor the auth module.");
}
