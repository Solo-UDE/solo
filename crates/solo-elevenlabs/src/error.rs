use thiserror::Error;

#[derive(Debug, Error)]
pub enum ElevenLabsError {
    #[error("WebSocket connection failed: {0}")]
    ConnectionFailed(String),

    #[error("WebSocket send failed: {0}")]
    SendFailed(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Session already exists: {0}")]
    SessionAlreadyExists(String),

    #[error("API key not configured")]
    NoApiKey,

    #[error("Authentication failed: {0}")]
    AuthFailed(String),

    #[error("Invalid audio data: {0}")]
    InvalidAudio(String),

    #[error("HTTP request failed: {0}")]
    HttpError(String),

    #[error("Deserialization failed: {0}")]
    DeserializationError(String),

    #[error("Session closed")]
    SessionClosed,
}

impl From<ElevenLabsError> for String {
    fn from(err: ElevenLabsError) -> Self {
        err.to_string()
    }
}
