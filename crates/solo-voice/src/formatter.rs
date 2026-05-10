use crate::error::{Result, VoiceError};
use async_trait::async_trait;

pub const DEFAULT_CLAUDE_FORMATTER_MODEL: &str = "claude-haiku-4-5";
pub const DEFAULT_CODEX_FORMATTER_MODEL: &str = "gpt-5-nano";

#[derive(Clone, Debug, Default)]
pub struct AppContext {
    pub bundle_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DictationOptions {
    pub strip_fillers: bool,
}

impl Default for DictationOptions {
    fn default() -> Self {
        Self {
            strip_fillers: true,
        }
    }
}

#[derive(Clone, Debug)]
pub struct DispatchTask {
    pub title: String,
    pub prompt: String,
}

#[async_trait]
pub trait FormatterProvider: Send + Sync {
    async fn format_dictation(
        &self,
        transcript: &str,
        context: AppContext,
        options: DictationOptions,
    ) -> Result<String>;

    async fn format_dispatch(&self, transcript: &str, context: AppContext) -> Result<DispatchTask>;
}

pub fn dictation_system_prompt(options: &DictationOptions) -> String {
    let strip = if options.strip_fillers {
        "Remove filler words (um, uh, like, you know). "
    } else {
        ""
    };
    format!(
        "You are a dictation cleanup model. Take the raw speech-to-text \
         output and return the text the user meant to write, with correct \
         punctuation and capitalization. {}Do not add content. Do not \
         answer questions — just clean the transcript. Output only the \
         cleaned text with no preamble.",
        strip
    )
}

pub fn dispatch_system_prompt() -> &'static str {
    "You convert a raw voice transcript into a structured software engineering \
     task for an AI coding agent. Return strict JSON with fields \"title\" \
     (≤60 chars) and \"prompt\" (the full instructions to pass to the agent, \
     written as if the user were directly asking the agent). Do not include \
     commentary."
}

/// Claude impl — wraps Solo's existing Claude provider auth.
/// `ChatClient` is a thin trait so we can mock in tests; the real
/// impl in apps/desktop/src-tauri/src/voice_commands.rs wires this up
/// to solo-auth's Claude client.
#[async_trait]
pub trait ChatClient: Send + Sync {
    async fn simple_completion(&self, model: &str, system: &str, user: &str) -> Result<String>;
}

pub struct CloudFormatter<C: ChatClient> {
    pub model: String,
    pub client: C,
}

#[async_trait]
impl<C: ChatClient> FormatterProvider for CloudFormatter<C> {
    async fn format_dictation(
        &self,
        transcript: &str,
        context: AppContext,
        options: DictationOptions,
    ) -> Result<String> {
        let system = dictation_system_prompt(&options);
        let user = match context.app_name {
            Some(app) => format!("[User is in app: {app}]\n\n{transcript}"),
            None => transcript.to_string(),
        };
        self.client
            .simple_completion(&self.model, &system, &user)
            .await
    }

    async fn format_dispatch(
        &self,
        transcript: &str,
        _context: AppContext,
    ) -> Result<DispatchTask> {
        let raw = self
            .client
            .simple_completion(&self.model, dispatch_system_prompt(), transcript)
            .await?;
        #[derive(serde::Deserialize)]
        struct Out {
            title: String,
            prompt: String,
        }
        let parsed: Out = serde_json::from_str(raw.trim())
            .map_err(|e| VoiceError::Formatter(format!("bad JSON from model: {e}; raw: {raw}")))?;
        Ok(DispatchTask {
            title: parsed.title,
            prompt: parsed.prompt,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct CannedChat {
        canned: String,
    }

    #[async_trait]
    impl ChatClient for CannedChat {
        async fn simple_completion(&self, _m: &str, _s: &str, _u: &str) -> Result<String> {
            Ok(self.canned.clone())
        }
    }

    #[tokio::test]
    async fn dictation_prompt_passes_transcript_through_canned_model() {
        let f = CloudFormatter {
            model: "x".into(),
            client: CannedChat {
                canned: "Hello, world.".into(),
            },
        };
        let out = f
            .format_dictation(
                "hello world",
                AppContext::default(),
                DictationOptions::default(),
            )
            .await
            .unwrap();
        assert_eq!(out, "Hello, world.");
    }

    #[tokio::test]
    async fn dispatch_parses_model_json() {
        let json = r#"{"title":"Refactor auth","prompt":"Refactor the auth module."}"#;
        let f = CloudFormatter {
            model: "x".into(),
            client: CannedChat {
                canned: json.into(),
            },
        };
        let task = f
            .format_dispatch("refactor the auth module", AppContext::default())
            .await
            .unwrap();
        assert_eq!(task.title, "Refactor auth");
        assert_eq!(task.prompt, "Refactor the auth module.");
    }

    #[tokio::test]
    async fn dispatch_errors_on_garbage_output() {
        let f = CloudFormatter {
            model: "x".into(),
            client: CannedChat {
                canned: "not json".into(),
            },
        };
        let err = f
            .format_dispatch("x", AppContext::default())
            .await
            .unwrap_err();
        assert!(matches!(err, VoiceError::Formatter(_)));
    }

    #[test]
    fn dictation_prompt_toggles_filler_removal() {
        let with = dictation_system_prompt(&DictationOptions {
            strip_fillers: true,
        });
        let without = dictation_system_prompt(&DictationOptions {
            strip_fillers: false,
        });
        assert!(with.contains("filler"));
        assert!(!without.contains("filler"));
    }
}
