use thiserror::Error;

#[derive(Debug, Error)]
pub enum VoiceError {
    #[error("audio device error: {0}")]
    Audio(String),

    #[error("VAD error: {0}")]
    Vad(String),

    #[error("STT error: {0}")]
    Stt(String),

    #[error("formatter error: {0}")]
    Formatter(String),

    #[error("model not downloaded: {0}")]
    ModelMissing(String),

    #[error("model download failed: {0}")]
    ModelDownload(String),

    #[error("model integrity check failed: expected {expected}, got {actual}")]
    ModelIntegrity { expected: String, actual: String },

    #[error("history db error: {0}")]
    History(String),

    #[error("pipeline is in state {0}, cannot proceed")]
    BadState(String),

    #[error("user cancelled")]
    Cancelled,

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Http(#[from] reqwest::Error),

    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, VoiceError>;
