//! Update command handlers for Solo IDE
//!
//! This module provides app update checking and installation
//! using the Tauri updater plugin.

#![allow(clippy::used_underscore_binding)]

use solo_protocol::BackendEvent;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;
use tracing::{error, info};

/// Check for available updates.
///
/// Returns `true` if an update is available, `false` otherwise.
/// Emits `update:available` backend event when an update is found.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<bool, String> {
    info!("Checking for updates...");

    let updater = app.updater().map_err(|e| {
        error!("Failed to get updater: {}", e);
        e.to_string()
    })?;

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let body = update.body.clone();
            let date = update.date.map(|d| d.to_string());

            info!("Update available: v{}", version);

            let _ = app.emit(
                "backend-event",
                &BackendEvent::UpdateAvailable {
                    version,
                    body,
                    date,
                },
            );

            Ok(true)
        }
        Ok(None) => {
            info!("No updates available");
            Ok(false)
        }
        Err(e) => {
            error!("Update check failed: {}", e);
            let _ = app.emit(
                "backend-event",
                &BackendEvent::UpdateError {
                    error: e.to_string(),
                },
            );
            Err(e.to_string())
        }
    }
}

/// Download and install a pending update, then restart the app.
///
/// Emits `update:progress` events during download and `update:ready`
/// when the update is ready to install.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    info!("Installing update...");

    let updater = app.updater().map_err(|e| {
        error!("Failed to get updater: {}", e);
        e.to_string()
    })?;

    let update = updater.check().await.map_err(|e| {
        error!("Failed to check for update: {}", e);
        e.to_string()
    })?;

    let Some(update) = update else {
        return Err("No update available".to_string());
    };

    info!("Downloading update v{}...", update.version);

    let app_handle = app.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = app_handle.emit(
                    "backend-event",
                    &BackendEvent::UpdateProgress {
                        chunk_length,
                        content_length,
                    },
                );
            },
            || {
                info!("Update downloaded, ready to install");
            },
        )
        .await
        .map_err(|e| {
            error!("Failed to install update: {}", e);
            let _ = app.emit(
                "backend-event",
                &BackendEvent::UpdateError {
                    error: e.to_string(),
                },
            );
            e.to_string()
        })?;

    let _ = app.emit("backend-event", &BackendEvent::UpdateReady {});

    info!("Restarting app to apply update...");
    app.restart();
}
