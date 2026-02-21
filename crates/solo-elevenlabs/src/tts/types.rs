/// High-level TTS event emitted by the streaming client
#[derive(Debug, Clone)]
pub enum TtsAudioEvent {
    /// Audio chunk ready for playback (base64-encoded PCM)
    AudioChunk {
        chunk: String,
        sample_rate: u32,
    },
    /// Streaming has completed
    Done,
    /// Error occurred during TTS
    Error {
        message: String,
    },
}
