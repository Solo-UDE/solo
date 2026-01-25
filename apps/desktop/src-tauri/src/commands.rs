//! Tauri command handlers
//!
//! This module contains all IPC command handlers that bridge
//! the TypeScript frontend with the Rust backend.

use solo_core::SoloConfig;

/// Simple ping command to test IPC communication
#[tauri::command]
pub async fn ping() -> String {
    tracing::debug!("Received ping command");
    "pong".to_string()
}

/// Get the current configuration
#[tauri::command]
pub async fn get_config() -> SoloConfig {
    tracing::debug!("Received get_config command");
    SoloConfig::default()
}
