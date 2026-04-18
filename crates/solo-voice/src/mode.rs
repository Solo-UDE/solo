use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoiceMode {
    Dictation,
    Dispatch,
}

/// Where the pipeline's output goes when it reaches Emitting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PipelineTarget {
    /// Emit `voice:transcript` only — frontend handles insertion.
    /// Used for chat-mic in Phase 1.
    ChatInput,
    /// Dictation paste into focused app (Phase 2).
    FocusedApp,
    /// Create a new agent session (Phase 3).
    NewAgentSession,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_mode_is_serde_tagged() {
        let json = serde_json::to_string(&VoiceMode::Dictation).unwrap();
        assert_eq!(json, "\"Dictation\"");
    }

    #[test]
    fn pipeline_target_roundtrips() {
        let t = PipelineTarget::ChatInput;
        let json = serde_json::to_string(&t).unwrap();
        let back: PipelineTarget = serde_json::from_str(&json).unwrap();
        assert_eq!(back, t);
    }
}
