use serde::{Deserialize, Serialize};

// =============================================================================
// Client → Server messages (sent over WebSocket)
// =============================================================================

/// Audio data message sent to the STT WebSocket
#[derive(Debug, Serialize)]
pub struct SttAudioMessage {
    pub message_type: &'static str, // "input_audio_chunk"
    pub audio_base_64: String,
    pub commit: bool,
    pub sample_rate: u32,
}

// =============================================================================
// Server → Client messages (received over WebSocket)
// =============================================================================

/// Raw server message — we deserialize based on `message_type` field.
/// Uses `#[serde(other)]` catch-all so unknown error types (auth_error,
/// quota_exceeded, rate_limited, etc.) don't silently fail deserialization.
#[derive(Debug, Deserialize)]
#[serde(tag = "message_type")]
pub enum SttServerMessage {
    /// Session has started
    #[serde(rename = "session_started")]
    SessionStarted {
        session_id: Option<String>,
    },

    /// Partial transcript (interim, may change)
    #[serde(rename = "partial_transcript")]
    PartialTranscript {
        text: Option<String>,
    },

    /// Committed (final) transcript
    #[serde(rename = "committed_transcript")]
    CommittedTranscript {
        text: Option<String>,
    },

    /// Committed transcript with timestamps
    #[serde(rename = "committed_transcript_with_timestamps")]
    CommittedTranscriptWithTimestamps {
        #[serde(default)]
        text: String,
        words: Option<Vec<TimestampedWord>>,
    },

    /// Error from the server (input_error)
    #[serde(rename = "input_error")]
    InputError {
        #[serde(default)]
        error: String,
    },

    /// Auth error
    #[serde(rename = "auth_error")]
    AuthError {
        #[serde(default)]
        error: String,
    },

    /// Quota exceeded
    #[serde(rename = "quota_exceeded")]
    QuotaExceeded {
        #[serde(default)]
        error: String,
    },

    /// Generic server error
    #[serde(rename = "error")]
    ServerError {
        #[serde(default)]
        error: String,
    },

    /// Any other message_type we don't explicitly handle
    #[serde(other)]
    Unknown,
}

/// A word with timing info
#[derive(Debug, Deserialize)]
pub struct TimestampedWord {
    pub word: Option<String>,
    pub start: Option<f64>,
    pub end: Option<f64>,
}

// =============================================================================
// Public event type emitted to callers
// =============================================================================

/// High-level transcript event emitted by the STT client
#[derive(Debug, Clone)]
pub enum SttTranscriptEvent {
    /// Connection established
    Connected,
    /// Interim (partial) transcript — may change as more audio arrives
    Partial { text: String },
    /// Final committed transcript
    Committed { text: String },
    /// Session ended
    Ended,
    /// Error occurred
    Error { message: String },
}
