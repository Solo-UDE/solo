use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite};
use url::Url;

use crate::config::SttConfig;
use crate::error::ElevenLabsError;

use super::types::*;

const STT_WS_BASE: &str = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

/// A realtime STT client that communicates with ElevenLabs via WebSocket.
///
/// Audio is sent as base64-encoded PCM chunks using `input_audio_chunk` messages.
/// Transcripts are received as `partial_transcript` and `committed_transcript` messages.
pub struct RealtimeSttClient {
    /// Channel to send commands to the WebSocket writer task
    cmd_tx: mpsc::Sender<ClientCommand>,
    /// Handle to the reader task (for cleanup)
    _reader_handle: tokio::task::JoinHandle<()>,
    /// Handle to the writer task (for cleanup)
    _writer_handle: tokio::task::JoinHandle<()>,
    /// Whether the client has been closed
    closed: Arc<Mutex<bool>>,
    /// Sample rate for audio messages
    sample_rate: u32,
}

/// Internal commands sent from the public API to the WebSocket writer task
enum ClientCommand {
    SendAudio(String),
    Commit,
    Close,
}

impl RealtimeSttClient {
    /// Open a WebSocket connection to ElevenLabs STT.
    ///
    /// The `on_event` callback is invoked for every transcript event.
    /// It runs on the tokio runtime, so avoid blocking inside it.
    pub async fn connect<F>(
        config: &SttConfig,
        api_key: &str,
        on_event: F,
    ) -> Result<Self, ElevenLabsError>
    where
        F: Fn(SttTranscriptEvent) + Send + Sync + 'static,
    {
        // Build WebSocket URL with query params (ElevenLabs format)
        let mut url = Url::parse(STT_WS_BASE)
            .map_err(|e| ElevenLabsError::ConnectionFailed(format!("URL parse: {e}")))?;

        // model_id is required for realtime STT
        url.query_pairs_mut()
            .append_pair("model_id", "scribe_v2_realtime");

        // Audio format maps from sample rate (e.g. pcm_16000)
        let audio_format = format!("pcm_{}", config.sample_rate);
        url.query_pairs_mut()
            .append_pair("audio_format", &audio_format);

        if let Some(lang) = &config.language {
            url.query_pairs_mut().append_pair("language_code", lang);
        }

        // Build WebSocket request with auth header
        let request = tungstenite::http::Request::builder()
            .uri(url.as_str())
            .header("xi-api-key", api_key)
            .header("Host", url.host_str().unwrap_or("api.elevenlabs.io"))
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header(
                "Sec-WebSocket-Key",
                tungstenite::handshake::client::generate_key(),
            )
            .body(())
            .map_err(|e| ElevenLabsError::ConnectionFailed(format!("Request build: {e}")))?;

        tracing::info!("Connecting to ElevenLabs STT: {}", url);

        let (ws_stream, _response) = connect_async(request)
            .await
            .map_err(|e| ElevenLabsError::ConnectionFailed(format!("WebSocket connect: {e}")))?;

        tracing::info!("ElevenLabs STT WebSocket connected");

        let (ws_write, ws_read) = ws_stream.split();
        let ws_write = Arc::new(Mutex::new(ws_write));

        let (cmd_tx, mut cmd_rx) = mpsc::channel::<ClientCommand>(256);
        let closed = Arc::new(Mutex::new(false));
        let sample_rate = config.sample_rate;

        let on_event: Arc<dyn Fn(SttTranscriptEvent) + Send + Sync> = Arc::new(on_event);

        // Emit connected event
        on_event(SttTranscriptEvent::Connected);

        // Writer task: forwards commands from cmd_tx to the WebSocket
        let ws_write_clone = Arc::clone(&ws_write);
        let closed_clone = Arc::clone(&closed);
        let writer_handle = tokio::spawn(async move {
            while let Some(cmd) = cmd_rx.recv().await {
                let msg = match &cmd {
                    ClientCommand::SendAudio(audio) => {
                        // ElevenLabs format: input_audio_chunk with audio_base_64
                        let msg = SttAudioMessage {
                            message_type: "input_audio_chunk",
                            audio_base_64: audio.clone(),
                            commit: false,
                            sample_rate,
                        };
                        serde_json::to_string(&msg).ok()
                    }
                    ClientCommand::Commit => {
                        // ElevenLabs commit: send input_audio_chunk with empty audio and commit=true
                        let msg = SttAudioMessage {
                            message_type: "input_audio_chunk",
                            audio_base_64: String::new(),
                            commit: true,
                            sample_rate,
                        };
                        serde_json::to_string(&msg).ok()
                    }
                    ClientCommand::Close => None,
                };

                if let Some(text) = msg {
                    let mut writer = ws_write_clone.lock().await;
                    if let Err(e) = writer.send(tungstenite::Message::Text(text.into())).await {
                        tracing::error!("WebSocket send error: {e}");
                        break;
                    }
                }

                if matches!(cmd, ClientCommand::Close) {
                    *closed_clone.lock().await = true;
                    // Close the WebSocket gracefully
                    let mut writer = ws_write_clone.lock().await;
                    let _ = writer.close().await;
                    break;
                }
            }
        });

        // Reader task: receives messages from the WebSocket, parses, and emits events
        let on_event_clone = Arc::clone(&on_event);
        let closed_reader = Arc::clone(&closed);
        let reader_handle = tokio::spawn(async move {
            let mut read_stream = ws_read;

            while let Some(result) = read_stream.next().await {
                if *closed_reader.lock().await {
                    break;
                }

                match result {
                    Ok(tungstenite::Message::Text(text)) => {
                        tracing::info!("STT WS recv: {}", &text[..text.len().min(300)]);
                        Self::handle_server_message(&text, &on_event_clone);
                    }
                    Ok(tungstenite::Message::Close(_)) => {
                        tracing::info!("ElevenLabs STT WebSocket closed by server");
                        on_event_clone(SttTranscriptEvent::Ended);
                        break;
                    }
                    Err(e) => {
                        tracing::error!("WebSocket read error: {e}");
                        on_event_clone(SttTranscriptEvent::Error {
                            message: format!("WebSocket error: {e}"),
                        });
                        break;
                    }
                    _ => {} // Ignore binary, ping, pong
                }
            }
        });

        Ok(Self {
            cmd_tx,
            _reader_handle: reader_handle,
            _writer_handle: writer_handle,
            closed,
            sample_rate,
        })
    }

    /// Send a base64-encoded PCM audio chunk to the STT service
    pub async fn send_audio(&self, base64_audio: &str) -> Result<(), ElevenLabsError> {
        if *self.closed.lock().await {
            return Err(ElevenLabsError::SessionClosed);
        }
        self.cmd_tx
            .send(ClientCommand::SendAudio(base64_audio.to_string()))
            .await
            .map_err(|_| ElevenLabsError::SendFailed("command channel closed".to_string()))
    }

    /// Send a manual commit signal (push-to-talk: finalize current audio)
    pub async fn commit(&self) -> Result<(), ElevenLabsError> {
        if *self.closed.lock().await {
            return Err(ElevenLabsError::SessionClosed);
        }
        self.cmd_tx
            .send(ClientCommand::Commit)
            .await
            .map_err(|_| ElevenLabsError::SendFailed("command channel closed".to_string()))
    }

    /// Close the WebSocket connection gracefully
    pub async fn close(&self) -> Result<(), ElevenLabsError> {
        if *self.closed.lock().await {
            return Ok(()); // Already closed
        }
        self.cmd_tx
            .send(ClientCommand::Close)
            .await
            .map_err(|_| ElevenLabsError::SendFailed("command channel closed".to_string()))
    }

    /// Parse a server message and emit the appropriate event
    fn handle_server_message(
        text: &str,
        on_event: &Arc<dyn Fn(SttTranscriptEvent) + Send + Sync>,
    ) {
        match serde_json::from_str::<SttServerMessage>(text) {
            Ok(SttServerMessage::SessionStarted { session_id }) => {
                tracing::info!("STT session started: {:?}", session_id);
            }
            Ok(SttServerMessage::PartialTranscript { text: transcript }) => {
                let t = transcript.unwrap_or_default();
                tracing::debug!("STT partial: {t}");
                if !t.is_empty() {
                    on_event(SttTranscriptEvent::Partial { text: t });
                }
            }
            Ok(SttServerMessage::CommittedTranscript { text: transcript }) => {
                let t = transcript.unwrap_or_default();
                tracing::info!("STT committed: {t}");
                if !t.is_empty() {
                    on_event(SttTranscriptEvent::Committed { text: t });
                }
            }
            Ok(SttServerMessage::CommittedTranscriptWithTimestamps { text, words }) => {
                // Prefer the top-level `text` field; fall back to joining timestamped words
                let t = if !text.is_empty() {
                    text
                } else {
                    words
                        .unwrap_or_default()
                        .iter()
                        .filter_map(|w| w.word.as_deref())
                        .collect::<Vec<_>>()
                        .join(" ")
                };
                tracing::info!("STT committed (timestamped): {t}");
                if !t.is_empty() {
                    on_event(SttTranscriptEvent::Committed { text: t });
                }
            }
            Ok(SttServerMessage::InputError { error }) => {
                let msg = if error.is_empty() {
                    "STT input_error: unknown".to_string()
                } else {
                    format!("STT input_error: {error}")
                };
                tracing::error!("{msg}");
                on_event(SttTranscriptEvent::Error { message: msg });
            }
            Ok(SttServerMessage::AuthError { error }) => {
                let msg = if error.is_empty() {
                    "STT auth_error: authentication failed".to_string()
                } else {
                    format!("STT auth_error: {error}")
                };
                tracing::error!("{msg}");
                on_event(SttTranscriptEvent::Error { message: msg });
            }
            Ok(SttServerMessage::QuotaExceeded { error }) => {
                let msg = if error.is_empty() {
                    "STT quota_exceeded: quota exceeded".to_string()
                } else {
                    format!("STT quota_exceeded: {error}")
                };
                tracing::error!("{msg}");
                on_event(SttTranscriptEvent::Error { message: msg });
            }
            Ok(SttServerMessage::ServerError { error }) => {
                let msg = if error.is_empty() {
                    "STT server error: unknown server error".to_string()
                } else {
                    format!("STT server error: {error}")
                };
                tracing::error!("{msg}");
                on_event(SttTranscriptEvent::Error { message: msg });
            }
            Ok(SttServerMessage::Unknown) => {
                tracing::warn!("Unknown STT message_type, raw: {text}");
            }
            Err(e) => {
                tracing::error!("Failed to parse STT message: {e}, raw: {text}");
            }
        }
    }
}
