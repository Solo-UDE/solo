use base64::{engine::general_purpose::STANDARD, Engine};

use crate::error::ElevenLabsError;

/// Decode base64-encoded audio data into raw bytes
pub fn decode_base64_audio(b64: &str) -> Result<Vec<u8>, ElevenLabsError> {
    STANDARD
        .decode(b64)
        .map_err(|e| ElevenLabsError::InvalidAudio(format!("base64 decode: {e}")))
}

/// Encode raw audio bytes to base64
pub fn encode_base64_audio(data: &[u8]) -> String {
    STANDARD.encode(data)
}
