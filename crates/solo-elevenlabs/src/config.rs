use serde::{Deserialize, Serialize};

/// Configuration for the realtime STT WebSocket connection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SttConfig {
    /// Language code (e.g., "en" for English). None = auto-detect.
    pub language: Option<String>,

    /// Sample rate of the input audio in Hz (default: 16000)
    pub sample_rate: u32,

    /// Audio encoding format
    pub encoding: AudioEncoding,

    /// Whether to enable endpoint detection (VAD).
    /// We use manual commit (push-to-talk), so this is false by default.
    pub enable_endpoint_detection: bool,
}

impl Default for SttConfig {
    fn default() -> Self {
        Self {
            language: Some("en".to_string()),
            sample_rate: 16000,
            encoding: AudioEncoding::PcmS16le,
            enable_endpoint_detection: false,
        }
    }
}

/// Audio encoding formats supported by ElevenLabs STT
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioEncoding {
    PcmS16le,
    PcmMulaw,
}

impl AudioEncoding {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PcmS16le => "pcm_s16le",
            Self::PcmMulaw => "pcm_mulaw",
        }
    }
}

/// Configuration for TTS streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtsConfig {
    /// ElevenLabs voice ID
    pub voice_id: String,

    /// Model ID (default: eleven_turbo_v2_5 for lowest latency)
    pub model_id: String,

    /// Output audio format
    pub output_format: TtsOutputFormat,

    /// Stability (0.0-1.0)
    pub stability: f32,

    /// Similarity boost (0.0-1.0)
    pub similarity_boost: f32,
}

impl Default for TtsConfig {
    fn default() -> Self {
        Self {
            voice_id: "21m00Tcm4TlvDq8ikWAM".to_string(), // Rachel (default)
            model_id: "eleven_turbo_v2_5".to_string(),
            output_format: TtsOutputFormat::PcmS16le22050,
            stability: 0.5,
            similarity_boost: 0.75,
        }
    }
}

/// TTS output audio formats
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum TtsOutputFormat {
    PcmS16le22050,
    PcmS16le44100,
    Mp3_44100_128,
}

impl TtsOutputFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PcmS16le22050 => "pcm_22050",
            Self::PcmS16le44100 => "pcm_44100",
            Self::Mp3_44100_128 => "mp3_44100_128",
        }
    }

    pub fn sample_rate(&self) -> u32 {
        match self {
            Self::PcmS16le22050 => 22050,
            Self::PcmS16le44100 => 44100,
            Self::Mp3_44100_128 => 44100,
        }
    }
}
