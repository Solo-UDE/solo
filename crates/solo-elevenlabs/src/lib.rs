#![warn(clippy::all)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc
)]

//! Solo ElevenLabs Integration
//!
//! Provides realtime Speech-to-Text (STT) via WebSocket and streaming
//! Text-to-Speech (TTS) via HTTP for the Solo IDE voice interface.
//!
//! This crate is Tauri-independent and can be reused in any Rust context.

pub mod audio;
pub mod config;
pub mod error;
pub mod stt;
pub mod tts;

pub use config::{SttConfig, TtsConfig};
pub use error::ElevenLabsError;
pub use stt::{RealtimeSttClient, SttTranscriptEvent};
pub use tts::{TtsAudioEvent, TtsStreamClient};
