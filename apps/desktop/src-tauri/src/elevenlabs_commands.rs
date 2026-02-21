use std::collections::HashMap;
use std::sync::Arc;

use solo_elevenlabs::{
    ElevenLabsError, RealtimeSttClient, SttConfig, SttTranscriptEvent, TtsConfig, TtsStreamClient,
};
use solo_protocol::{
    ElevenLabsSttCommittedEvent, ElevenLabsSttPartialEvent, ElevenLabsSttStatusEvent,
    ElevenLabsTtsAudioEvent, ElevenLabsTtsStatusEvent,
};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use tokio::task::JoinHandle;

// =============================================================================
// State
// =============================================================================

pub struct ElevenLabsState {
    api_key: RwLock<Option<String>>,
    stt_sessions: RwLock<HashMap<String, Arc<RealtimeSttClient>>>,
    tts_handles: RwLock<HashMap<String, JoinHandle<()>>>,
}

impl ElevenLabsState {
    pub fn new() -> Self {
        Self {
            api_key: RwLock::new(None),
            stt_sessions: RwLock::new(HashMap::new()),
            tts_handles: RwLock::new(HashMap::new()),
        }
    }
}

// =============================================================================
// API Key Commands
// =============================================================================

#[tauri::command]
pub async fn elevenlabs_set_api_key(
    api_key: String,
    state: State<'_, ElevenLabsState>,
) -> Result<(), String> {
    let trimmed = api_key.trim().to_string();
    tracing::info!("ElevenLabs API key set, length={}", trimmed.len());
    *state.api_key.write().await = Some(trimmed);
    Ok(())
}

#[tauri::command]
pub async fn elevenlabs_has_api_key(
    state: State<'_, ElevenLabsState>,
) -> Result<bool, String> {
    let key = state.api_key.read().await;
    Ok(key.as_ref().map_or(false, |k| !k.is_empty()))
}

// =============================================================================
// STT Commands
// =============================================================================

#[tauri::command]
pub async fn elevenlabs_stt_start(
    app: AppHandle,
    session_id: String,
    language: Option<String>,
    sample_rate: Option<u32>,
    state: State<'_, ElevenLabsState>,
) -> Result<(), String> {
    tracing::info!("[elevenlabs] stt_start called, session_id={session_id}, sample_rate={sample_rate:?}");

    let api_key = state
        .api_key
        .read()
        .await
        .clone()
        .ok_or_else(|| {
            tracing::error!("[elevenlabs] No API key set!");
            ElevenLabsError::NoApiKey.to_string()
        })?;

    tracing::info!("[elevenlabs] API key present, length={}", api_key.len());

    // Check session doesn't already exist
    if state.stt_sessions.read().await.contains_key(&session_id) {
        return Err(ElevenLabsError::SessionAlreadyExists(session_id).to_string());
    }

    let config = SttConfig {
        language,
        sample_rate: sample_rate.unwrap_or(16000),
        ..SttConfig::default()
    };

    let sid = session_id.clone();
    let app_handle = app.clone();

    // Emit connecting status
    tracing::info!("[elevenlabs] Emitting connecting status");
    let _ = app.emit(
        "elevenlabs:stt_status",
        ElevenLabsSttStatusEvent {
            session_id: session_id.clone(),
            status: "connecting".to_string(),
            error: None,
        },
    );

    tracing::info!("[elevenlabs] Calling RealtimeSttClient::connect...");
    let client = RealtimeSttClient::connect(&config, &api_key, move |event| {
        match event {
            SttTranscriptEvent::Connected => {
                tracing::info!("[elevenlabs] STT connected event received");
                let _ = app_handle.emit(
                    "elevenlabs:stt_status",
                    ElevenLabsSttStatusEvent {
                        session_id: sid.clone(),
                        status: "connected".to_string(),
                        error: None,
                    },
                );
            }
            SttTranscriptEvent::Partial { text } => {
                tracing::info!("[elevenlabs] STT partial: {text}");
                let _ = app_handle.emit(
                    "elevenlabs:stt_partial",
                    ElevenLabsSttPartialEvent {
                        session_id: sid.clone(),
                        text,
                    },
                );
            }
            SttTranscriptEvent::Committed { text } => {
                tracing::info!("[elevenlabs] STT committed: {text}");
                let _ = app_handle.emit(
                    "elevenlabs:stt_committed",
                    ElevenLabsSttCommittedEvent {
                        session_id: sid.clone(),
                        text,
                    },
                );
            }
            SttTranscriptEvent::Ended => {
                tracing::info!("[elevenlabs] STT session ended");
                let _ = app_handle.emit(
                    "elevenlabs:stt_status",
                    ElevenLabsSttStatusEvent {
                        session_id: sid.clone(),
                        status: "ended".to_string(),
                        error: None,
                    },
                );
            }
            SttTranscriptEvent::Error { message } => {
                tracing::error!("[elevenlabs] STT error: {message}");
                let _ = app_handle.emit(
                    "elevenlabs:stt_status",
                    ElevenLabsSttStatusEvent {
                        session_id: sid.clone(),
                        status: "error".to_string(),
                        error: Some(message),
                    },
                );
            }
        }
    })
    .await
    .map_err(|e| {
        tracing::error!("[elevenlabs] WebSocket connect FAILED: {e}");
        e.to_string()
    })?;

    tracing::info!("[elevenlabs] WebSocket connect SUCCESS, storing session");

    state
        .stt_sessions
        .write()
        .await
        .insert(session_id.clone(), Arc::new(client));

    tracing::info!("[elevenlabs] Session {session_id} ready, waiting for audio");
    Ok(())
}

#[tauri::command]
pub async fn elevenlabs_stt_send_audio(
    session_id: String,
    audio_base64: String,
    state: State<'_, ElevenLabsState>,
) -> Result<(), String> {
    // Log first chunk only (to avoid spamming)
    static LOGGED_FIRST: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if !LOGGED_FIRST.swap(true, std::sync::atomic::Ordering::Relaxed) {
        tracing::info!("[elevenlabs] First audio chunk received, len={}", audio_base64.len());
    }

    let sessions = state.stt_sessions.read().await;
    let client = sessions
        .get(&session_id)
        .ok_or_else(|| {
            tracing::error!("[elevenlabs] send_audio: session not found: {session_id}");
            ElevenLabsError::SessionNotFound(session_id).to_string()
        })?;

    client
        .send_audio(&audio_base64)
        .await
        .map_err(|e| {
            tracing::error!("[elevenlabs] send_audio error: {e}");
            e.to_string()
        })
}

#[tauri::command]
pub async fn elevenlabs_stt_commit(
    session_id: String,
    state: State<'_, ElevenLabsState>,
) -> Result<(), String> {
    tracing::info!("[elevenlabs] Committing session {session_id}");
    let sessions = state.stt_sessions.read().await;
    let client = sessions
        .get(&session_id)
        .ok_or_else(|| ElevenLabsError::SessionNotFound(session_id).to_string())?;

    client.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn elevenlabs_stt_stop(
    session_id: String,
    state: State<'_, ElevenLabsState>,
) -> Result<(), String> {
    let client = state.stt_sessions.write().await.remove(&session_id);

    if let Some(client) = client {
        client.close().await.map_err(|e| e.to_string())?;
    }

    Ok(())
}

// =============================================================================
// TTS Commands (stretch goal)
// =============================================================================

#[tauri::command]
pub async fn elevenlabs_tts_speak(
    app: AppHandle,
    session_id: String,
    text: String,
    voice_id: Option<String>,
    model_id: Option<String>,
    state: State<'_, ElevenLabsState>,
) -> Result<(), String> {
    let api_key = state
        .api_key
        .read()
        .await
        .clone()
        .ok_or_else(|| ElevenLabsError::NoApiKey.to_string())?;

    // Cancel existing TTS for this session if any
    if let Some(handle) = state.tts_handles.write().await.remove(&session_id) {
        handle.abort();
    }

    let mut config = TtsConfig::default();
    if let Some(vid) = voice_id {
        config.voice_id = vid;
    }
    if let Some(mid) = model_id {
        config.model_id = mid;
    }

    let sid = session_id.clone();
    let app_handle = app.clone();

    let _ = app.emit(
        "elevenlabs:tts_status",
        ElevenLabsTtsStatusEvent {
            session_id: session_id.clone(),
            status: "speaking".to_string(),
            error: None,
        },
    );

    let handle = tokio::spawn(async move {
        let client = TtsStreamClient::new();
        let sid_inner = sid.clone();
        let app_inner = app_handle.clone();

        let result = client
            .stream_text(&text, &config, &api_key, move |event| {
                match event {
                    solo_elevenlabs::TtsAudioEvent::AudioChunk { chunk, sample_rate } => {
                        let _ = app_inner.emit(
                            "elevenlabs:tts_audio",
                            ElevenLabsTtsAudioEvent {
                                session_id: sid_inner.clone(),
                                chunk,
                                sample_rate,
                            },
                        );
                    }
                    solo_elevenlabs::TtsAudioEvent::Done => {
                        let _ = app_inner.emit(
                            "elevenlabs:tts_status",
                            ElevenLabsTtsStatusEvent {
                                session_id: sid_inner.clone(),
                                status: "done".to_string(),
                                error: None,
                            },
                        );
                    }
                    solo_elevenlabs::TtsAudioEvent::Error { message } => {
                        let _ = app_inner.emit(
                            "elevenlabs:tts_status",
                            ElevenLabsTtsStatusEvent {
                                session_id: sid_inner.clone(),
                                status: "error".to_string(),
                                error: Some(message),
                            },
                        );
                    }
                }
            })
            .await;

        if let Err(e) = result {
            let _ = app_handle.emit(
                "elevenlabs:tts_status",
                ElevenLabsTtsStatusEvent {
                    session_id: sid,
                    status: "error".to_string(),
                    error: Some(e.to_string()),
                },
            );
        }
    });

    state
        .tts_handles
        .write()
        .await
        .insert(session_id, handle);

    Ok(())
}

#[tauri::command]
pub async fn elevenlabs_tts_stop(
    session_id: String,
    state: State<'_, ElevenLabsState>,
) -> Result<(), String> {
    if let Some(handle) = state.tts_handles.write().await.remove(&session_id) {
        handle.abort();
    }
    Ok(())
}
