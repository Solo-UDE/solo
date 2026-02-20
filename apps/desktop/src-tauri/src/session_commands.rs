//! Session persistence commands for Solo IDE
//!
//! Manages session JSON files in `~/.solo/sessions/`.
//! Separate from `fs_commands` because these paths are global (not workspace-scoped).

use std::path::PathBuf;
use tokio::fs;
use tracing::debug;

/// Resolve the sessions directory: `~/.solo/sessions/`
fn sessions_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not determine home directory (HOME/USERPROFILE not set)".to_string())?;
    Ok(PathBuf::from(home).join(".solo").join("sessions"))
}

/// Ensure the sessions directory exists
async fn ensure_sessions_dir() -> Result<PathBuf, String> {
    let dir = sessions_dir()?;
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create sessions directory: {e}"))?;
    Ok(dir)
}

/// Return the sessions directory path, creating it if needed.
#[tauri::command]
pub async fn session_get_dir() -> Result<String, String> {
    let dir = ensure_sessions_dir().await?;
    Ok(dir.to_string_lossy().into_owned())
}

/// List all `.json` files in the sessions directory.
/// Returns a list of session IDs (filenames without extension).
#[tauri::command]
pub async fn session_list_files() -> Result<Vec<String>, String> {
    let dir = ensure_sessions_dir().await?;
    let mut ids = Vec::new();

    let mut entries = fs::read_dir(&dir)
        .await
        .map_err(|e| format!("Failed to read sessions directory: {e}"))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read directory entry: {e}"))?
    {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            if let Some(stem) = path.file_stem() {
                ids.push(stem.to_string_lossy().into_owned());
            }
        }
    }

    debug!("Listed {} session files", ids.len());
    Ok(ids)
}

/// Read a session file by session ID.
/// Returns the raw JSON string contents of `{session_id}.json`.
#[tauri::command]
pub async fn session_read_file(session_id: String) -> Result<String, String> {
    let dir = sessions_dir()?;
    let path = dir.join(format!("{session_id}.json"));

    fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read session file {session_id}: {e}"))
}

/// Write a session file atomically (write to .tmp, then rename).
#[tauri::command]
pub async fn session_write_file(session_id: String, content: String) -> Result<(), String> {
    let dir = ensure_sessions_dir().await?;
    let target = dir.join(format!("{session_id}.json"));
    let tmp = dir.join(format!("{session_id}.json.tmp"));

    fs::write(&tmp, content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write temp session file: {e}"))?;

    fs::rename(&tmp, &target)
        .await
        .map_err(|e| {
            // Clean up temp file on rename failure
            let tmp_clone = tmp.clone();
            tokio::spawn(async move {
                let _ = fs::remove_file(&tmp_clone).await;
            });
            format!("Failed to rename session file: {e}")
        })?;

    debug!("Wrote session file: {session_id}");
    Ok(())
}

/// Delete a session file by session ID.
#[tauri::command]
pub async fn session_delete_file(session_id: String) -> Result<(), String> {
    let dir = sessions_dir()?;
    let path = dir.join(format!("{session_id}.json"));

    match fs::remove_file(&path).await {
        Ok(()) => {
            debug!("Deleted session file: {session_id}");
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            debug!("Session file already absent: {session_id}");
        }
        Err(e) => {
            return Err(format!("Failed to delete session file {session_id}: {e}"));
        }
    }

    Ok(())
}
