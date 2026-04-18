//! Tauri command surface for the voice pipeline.
//!
//! Phase 1 responsibilities: expose enable/begin/end/cancel, model
//! download, and history ops. No global hotkeys or paste — those
//! arrive in Phase 2.

use crate::provider_commands::ProviderAuthState;
use crate::voice::hotkey::{HotkeyEvent, HotkeyManager};
use solo_protocol::{ShortcutsConfig, VoicePermissions};
use solo_voice::{
    audio::{start_capture, AudioRing, AudioStream},
    formatter::{
        ChatClient, CloudFormatter, DictationOptions, FormatterProvider,
        DEFAULT_CLAUDE_FORMATTER_MODEL,
    },
    history::{History, HistoryRow},
    mode::{PipelineTarget, VoiceMode},
    models,
    pipeline::{PipelineState, VoicePipeline},
    stt::{SherpaConfig, SherpaParakeet, SttProvider},
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex as TokioMutex;

// -- Chat client wired to solo-auth's Claude provider ------------------------

struct ClaudeChatClient {
    handle: AppHandle,
}

#[async_trait::async_trait]
impl ChatClient for ClaudeChatClient {
    async fn simple_completion(
        &self,
        model: &str,
        system: &str,
        user: &str,
    ) -> solo_voice::error::Result<String> {
        let creds = self
            .handle
            .state::<ProviderAuthState>()
            .credentials
            .clone();
        solo_auth::claude_simple_completion(&creds, model, system, user)
            .await
            .map_err(|e| solo_voice::VoiceError::Formatter(format!("claude: {e}")))
    }
}

// -- Managed Tauri state ------------------------------------------------------

pub struct VoiceState {
    pipeline: TokioMutex<Option<Arc<VoicePipeline>>>,
    stream: TokioMutex<Option<AudioStream>>,
    ring: AudioRing,
    history: TokioMutex<Option<History>>,
    models_root: TokioMutex<Option<PathBuf>>,
    hotkey: TokioMutex<Option<HotkeyManager>>,
    shortcuts: TokioMutex<ShortcutsConfig>,
}

impl VoiceState {
    pub fn new() -> Self {
        Self {
            pipeline: TokioMutex::new(None),
            stream: TokioMutex::new(None),
            ring: AudioRing::new(),
            history: TokioMutex::new(None),
            models_root: TokioMutex::new(None),
            hotkey: TokioMutex::new(None),
            shortcuts: TokioMutex::new(ShortcutsConfig::default()),
        }
    }
}

// -- Helpers -----------------------------------------------------------------

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let models = base.join("models");
    std::fs::create_dir_all(&models).map_err(|e| e.to_string())?;
    Ok(models)
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base.join("voice_history.sqlite"))
}

fn emit_state(app: &AppHandle, mode: VoiceMode, state: &PipelineState) {
    #[derive(serde::Serialize, Clone)]
    struct Payload<'a> {
        mode: VoiceMode,
        state: &'a PipelineState,
    }
    let _ = app.emit("voice:state", Payload { mode, state });
}

// -- Commands ----------------------------------------------------------------

#[tauri::command]
pub async fn voice_enable(
    app: AppHandle,
    voice: State<'_, VoiceState>,
) -> Result<(), String> {
    let hist_path = history_path(&app)?;
    let models_root = models_dir(&app)?;
    let history = History::open(&hist_path).map_err(|e| e.to_string())?;
    *voice.history.lock().await = Some(history);
    *voice.models_root.lock().await = Some(models_root);

    let cfg = voice.shortcuts.lock().await.clone();
    let app_for_cb = app.clone();
    let mgr = HotkeyManager::start(
        cfg,
        std::sync::Arc::new(move |evt| {
            match evt {
                HotkeyEvent::DictationDown => {
                    let _ = app_for_cb.emit("voice:hotkey", "dictation_down");
                }
                HotkeyEvent::DictationUp => {
                    let _ = app_for_cb.emit("voice:hotkey", "dictation_up");
                }
                HotkeyEvent::DispatchDown => {
                    let _ = app_for_cb.emit("voice:hotkey", "dispatch_down");
                }
                HotkeyEvent::DispatchUp => {
                    let _ = app_for_cb.emit("voice:hotkey", "dispatch_up");
                }
                HotkeyEvent::Cancel => {
                    let _ = app_for_cb.emit("voice:hotkey", "cancel");
                }
            }
        }),
    )
    .map_err(|e| e)?;
    *voice.hotkey.lock().await = Some(mgr);

    Ok(())
}

#[tauri::command]
pub async fn voice_download_parakeet(
    app: AppHandle,
    voice: State<'_, VoiceState>,
) -> Result<(), String> {
    let root = voice
        .models_root
        .lock()
        .await
        .clone()
        .ok_or_else(|| "voice not enabled".to_string())?;
    let app_for_progress = app.clone();
    models::download_manifest(&models::PARAKEET, &root, move |bytes, total| {
        let _ = app_for_progress.emit(
            "voice:model_progress",
            serde_json::json!({
                "model_id": models::PARAKEET.id,
                "bytes": bytes,
                "total": total,
            }),
        );
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_begin(
    app: AppHandle,
    voice: State<'_, VoiceState>,
    mode: VoiceMode,
) -> Result<(), String> {
    let mut pipeline_guard = voice.pipeline.lock().await;

    if pipeline_guard.is_none() {
        let root = voice
            .models_root
            .lock()
            .await
            .clone()
            .ok_or_else(|| "voice not enabled".to_string())?;
        if !models::is_installed(&root, &models::PARAKEET) {
            return Err("Parakeet model not downloaded".into());
        }
        let dir = models::install_dir(&root, &models::PARAKEET);
        let stt: Arc<dyn SttProvider> = Arc::new(
            SherpaParakeet::new(SherpaConfig {
                encoder: dir.join("encoder.int8.onnx"),
                decoder: dir.join("decoder.int8.onnx"),
                joiner: dir.join("joiner.int8.onnx"),
                tokens: dir.join("tokens.txt"),
                num_threads: 2,
            })
            .map_err(|e| e.to_string())?,
        );

        let formatter: Arc<dyn FormatterProvider> = Arc::new(CloudFormatter {
            model: DEFAULT_CLAUDE_FORMATTER_MODEL.into(),
            client: ClaudeChatClient { handle: app.clone() },
        });

        let app_for_state = app.clone();
        let hud_state: Arc<crate::voice::hud::HudState> =
            app.state::<Arc<crate::voice::hud::HudState>>().inner().clone();
        let on_state = Arc::new(move |s: &PipelineState| {
            emit_state(&app_for_state, mode, s);
            match s {
                PipelineState::Arming
                | PipelineState::Recording
                | PipelineState::Transcribing
                | PipelineState::Formatting => {
                    let _ = crate::voice::hud::show(&app_for_state, &hud_state);
                }
                PipelineState::Idle
                | PipelineState::Emitting
                | PipelineState::Error(_) => {
                    let _ = crate::voice::hud::hide(&app_for_state, &hud_state);
                }
            }
        });

        let app_for_level = app.clone();
        let on_level = Arc::new(move |rms: f32| {
            let _ = app_for_level.emit("voice:level", serde_json::json!({ "rms": rms }));
        });

        *pipeline_guard = Some(Arc::new(VoicePipeline::new(
            stt,
            formatter,
            voice.ring.clone(),
            on_state,
            on_level,
        )));
    }
    let pipeline = pipeline_guard.as_ref().unwrap().clone();
    drop(pipeline_guard);

    let stream = start_capture(voice.ring.clone()).map_err(|e| e.to_string())?;
    *voice.stream.lock().await = Some(stream);

    pipeline.begin().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_end(
    app: AppHandle,
    voice: State<'_, VoiceState>,
    mode: VoiceMode,
    target: PipelineTarget,
) -> Result<(), String> {
    let pipeline = voice
        .pipeline
        .lock()
        .await
        .clone()
        .ok_or_else(|| "pipeline not initialised".to_string())?;

    *voice.stream.lock().await = None;

    let ctx = crate::voice::app_monitor::frontmost_app();
    let out = pipeline
        .end(
            mode,
            target,
            ctx.clone(),
            DictationOptions::default(),
        )
        .await
        .map_err(|e| e.to_string())?;

    use crate::voice::injection::{inject_text, InjectionOutcome};

    let paste_outcome = match target {
        PipelineTarget::FocusedApp => {
            match inject_text(&out.formatted) {
                Ok(InjectionOutcome::Pasted) => Some(Ok(())),
                Ok(InjectionOutcome::ClipboardOnly) => Some(Err(
                    "Paste failed — text copied to clipboard, paste manually".to_string(),
                )),
                Err(e) => Some(Err(format!("Paste failed: {}", e.0))),
            }
        }
        _ => None,
    };

    if let Some(Err(msg)) = &paste_outcome {
        let _ = app.emit("voice:error", serde_json::json!({ "message": msg }));
    }

    if let Some(h) = voice.history.lock().await.as_ref() {
        let row = HistoryRow {
            id: out.id.clone(),
            mode: format!("{:?}", out.mode),
            raw_transcript: out.raw_transcript.clone(),
            formatted: out.formatted.clone(),
            target_app_bundle_id: ctx.bundle_id.clone(),
            target_app_name: ctx.app_name.clone(),
            duration_ms: out.duration_ms,
            linked_session_id: None,
            created_at: chrono::Utc::now().timestamp_millis(),
        };
        h.insert(&row).map_err(|e| e.to_string())?;
    }

    let payload = serde_json::json!({
        "id": out.id,
        "mode": out.mode,
        "raw_transcript": out.raw_transcript,
        "formatted": out.formatted,
        "target_app_bundle_id": ctx.bundle_id,
        "target_app_name": ctx.app_name,
        "duration_ms": out.duration_ms,
        "linked_session_id": serde_json::Value::Null,
        "created_at": chrono::Utc::now().timestamp_millis(),
    });
    let _ = app.emit("voice:transcript", serde_json::json!({ "result": payload }));
    Ok(())
}

#[tauri::command]
pub async fn voice_cancel(voice: State<'_, VoiceState>) -> Result<(), String> {
    *voice.stream.lock().await = None;
    if let Some(p) = voice.pipeline.lock().await.as_ref() {
        p.cancel().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_history_list(
    voice: State<'_, VoiceState>,
    limit: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let g = voice.history.lock().await;
    let h = g.as_ref().ok_or_else(|| "voice not enabled".to_string())?;
    let rows = h.list(limit).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "mode": r.mode,
                "raw_transcript": r.raw_transcript,
                "formatted": r.formatted,
                "target_app_bundle_id": r.target_app_bundle_id,
                "target_app_name": r.target_app_name,
                "duration_ms": r.duration_ms,
                "linked_session_id": r.linked_session_id,
                "created_at": r.created_at,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn voice_history_delete(
    voice: State<'_, VoiceState>,
    id: String,
) -> Result<(), String> {
    let g = voice.history.lock().await;
    let h = g.as_ref().ok_or_else(|| "voice not enabled".to_string())?;
    h.delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_parakeet_installed(
    voice: State<'_, VoiceState>,
) -> Result<bool, String> {
    let root = voice
        .models_root
        .lock()
        .await
        .clone()
        .ok_or_else(|| "voice not enabled".to_string())?;
    Ok(models::is_installed(&root, &models::PARAKEET))
}

#[tauri::command]
pub async fn voice_get_shortcuts(
    voice: State<'_, VoiceState>,
) -> Result<ShortcutsConfig, String> {
    Ok(voice.shortcuts.lock().await.clone())
}

#[tauri::command]
pub async fn voice_set_shortcuts(
    voice: State<'_, VoiceState>,
    shortcuts: ShortcutsConfig,
) -> Result<(), String> {
    *voice.shortcuts.lock().await = shortcuts.clone();
    if let Some(mgr) = voice.hotkey.lock().await.as_ref() {
        mgr.update(shortcuts);
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_check_permissions() -> Result<VoicePermissions, String> {
    let microphone = tauri_plugin_macos_permissions::check_microphone_permission().await;
    let input_monitoring =
        tauri_plugin_macos_permissions::check_input_monitoring_permission().await;
    let accessibility = tauri_plugin_macos_permissions::check_accessibility_permission().await;
    Ok(VoicePermissions {
        microphone,
        input_monitoring,
        accessibility,
    })
}

#[tauri::command]
pub async fn voice_request_permission(
    which: String,
) -> Result<VoicePermissions, String> {
    match which.as_str() {
        "microphone" => {
            let _ =
                tauri_plugin_macos_permissions::request_microphone_permission().await;
        }
        "input-monitoring" => {
            let _ = tauri_plugin_macos_permissions::request_input_monitoring_permission()
                .await;
        }
        "accessibility" => {
            tauri_plugin_macos_permissions::request_accessibility_permission().await;
        }
        other => return Err(format!("unknown permission: {other}")),
    };
    voice_check_permissions().await
}
