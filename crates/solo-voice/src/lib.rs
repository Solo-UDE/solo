//! Voice pipeline for Solo IDE.
//!
//! Exposes audio capture, VAD, STT, and formatter primitives. The
//! orchestrator is `pipeline::VoicePipeline`.

pub mod audio;
pub mod error;
pub mod formatter;
pub mod history;
pub mod mode;
pub mod models;
pub mod pipeline;
pub mod stt;
pub mod vad;

// Re-exports (added as types land in later tasks):
// pub use error::VoiceError;
// pub use mode::{PipelineTarget, VoiceMode};
// pub use pipeline::VoicePipeline;
