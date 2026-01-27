//! File system command handlers for Solo IDE
//!
//! This module contains all file system related IPC commands.

use solo_fs::{
    operations, tree, watcher::{FileEventType, FileWatcher},
};
use solo_protocol::{
    BackendEvent, DirectoryReadRequest, DirectoryReadResponse, FileCreateRequest,
    FileDeleteRequest, FileErrorCode, FileOperationError, FileRenameRequest, FileTreeEntry,
};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{oneshot, RwLock};
use tracing::{debug, error, info};

/// Application state for file system operations
pub struct FsState {
    /// Current workspace root path
    pub workspace_root: RwLock<Option<PathBuf>>,
    /// File watcher instance
    pub watcher: RwLock<Option<FileWatcher>>,
}

impl FsState {
    pub fn new() -> Self {
        Self {
            workspace_root: RwLock::new(None),
            watcher: RwLock::new(None),
        }
    }
}

impl Default for FsState {
    fn default() -> Self {
        Self::new()
    }
}

/// Convert solo_fs error to protocol error
fn to_protocol_error(err: solo_fs::FsError, path: &str) -> FileOperationError {
    let code = match &err {
        solo_fs::FsError::NotFound(_) => FileErrorCode::NotFound,
        solo_fs::FsError::PermissionDenied(_) => FileErrorCode::PermissionDenied,
        solo_fs::FsError::AlreadyExists(_) => FileErrorCode::AlreadyExists,
        solo_fs::FsError::NotADirectory(_) => FileErrorCode::NotADirectory,
        solo_fs::FsError::NotAFile(_) => FileErrorCode::NotAFile,
        solo_fs::FsError::DirectoryNotEmpty(_) => FileErrorCode::DirectoryNotEmpty,
        solo_fs::FsError::Io(_) => FileErrorCode::IoError,
        solo_fs::FsError::InvalidPath(_) => FileErrorCode::InvalidPath,
        solo_fs::FsError::PathOutsideWorkspace(_) => FileErrorCode::PathOutsideWorkspace,
        solo_fs::FsError::Watcher(_) => FileErrorCode::IoError,
    };

    FileOperationError {
        code,
        message: err.to_string(),
        path: path.to_string(),
    }
}

/// Open folder dialog to select a directory
#[tauri::command]
pub async fn open_folder_dialog(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    debug!("Opening folder dialog");

    let (tx, rx) = oneshot::channel();

    app.dialog()
        .file()
        .set_title("Open Folder")
        .pick_folder(move |result| {
            let _ = tx.send(result);
        });

    match rx.await {
        Ok(Some(path)) => {
            let path_str = path.to_string();
            info!(path = %path_str, "Folder selected");
            Ok(Some(path_str))
        }
        Ok(None) => {
            debug!("Folder dialog cancelled");
            Ok(None)
        }
        Err(_) => {
            Err("Dialog was cancelled".to_string())
        }
    }
}

/// Set the workspace root path
#[tauri::command]
pub async fn set_workspace_root(
    path: String,
    state: State<'_, FsState>,
) -> Result<(), FileOperationError> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(FileOperationError {
            code: FileErrorCode::NotFound,
            message: "Path does not exist".to_string(),
            path,
        });
    }

    if !path_buf.is_dir() {
        return Err(FileOperationError {
            code: FileErrorCode::NotADirectory,
            message: "Path is not a directory".to_string(),
            path,
        });
    }

    info!(path = %path, "Setting workspace root");
    *state.workspace_root.write().await = Some(path_buf);

    Ok(())
}

/// Read a directory and return its contents
#[tauri::command]
pub async fn read_directory(
    request: DirectoryReadRequest,
    state: State<'_, FsState>,
) -> Result<DirectoryReadResponse, FileOperationError> {
    // Validate workspace is set (we check but allow reading any accessible path)
    let workspace = state.workspace_root.read().await;
    if workspace.is_none() {
        return Err(FileOperationError {
            code: FileErrorCode::InvalidPath,
            message: "No workspace root set. Open a folder first.".to_string(),
            path: request.path.clone(),
        });
    }

    let path = PathBuf::from(&request.path);

    debug!(path = %request.path, depth = request.depth, "Reading directory");

    let entry = tree::read_directory(&path, request.depth)
        .map_err(|e| to_protocol_error(e, &request.path))?;

    // Count total entries for progress indication
    let total_count = tree::count_entries(&path).unwrap_or(0);

    Ok(DirectoryReadResponse {
        entry,
        total_count,
    })
}

/// Create a new file
#[tauri::command]
pub async fn create_file(
    request: FileCreateRequest,
    state: State<'_, FsState>,
) -> Result<FileTreeEntry, FileOperationError> {
    let workspace = state.workspace_root.read().await;
    let workspace_path = workspace.as_ref().ok_or_else(|| FileOperationError {
        code: FileErrorCode::InvalidPath,
        message: "No workspace root set".to_string(),
        path: request.path.clone(),
    })?;

    let path = PathBuf::from(&request.path);

    info!(path = %request.path, is_dir = request.is_dir, "Creating file/directory");

    if request.is_dir {
        operations::create_directory(&path, workspace_path)
            .map_err(|e| to_protocol_error(e, &request.path))?;
    } else {
        operations::create_file(&path, request.content.as_deref(), workspace_path)
            .map_err(|e| to_protocol_error(e, &request.path))?;
    }

    // Return the created entry
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(FileTreeEntry {
        name,
        path: request.path,
        is_dir: request.is_dir,
        children: if request.is_dir { Some(vec![]) } else { None },
        size: None,
        modified: None,
    })
}

/// Read file contents
#[tauri::command]
pub async fn read_file(
    request: solo_protocol::FileReadRequest,
    state: State<'_, FsState>,
) -> Result<solo_protocol::FileReadResponse, FileOperationError> {
    let workspace = state.workspace_root.read().await;
    let workspace_path = workspace.as_ref().ok_or_else(|| FileOperationError {
        code: FileErrorCode::InvalidPath,
        message: "No workspace root set".to_string(),
        path: request.path.clone(),
    })?;

    let path = PathBuf::from(&request.path);

    // Validate path is within workspace
    let canonical = path.canonicalize().map_err(|e| FileOperationError {
        code: FileErrorCode::NotFound,
        message: e.to_string(),
        path: request.path.clone(),
    })?;

    let workspace_canonical = workspace_path.canonicalize().map_err(|e| FileOperationError {
        code: FileErrorCode::IoError,
        message: e.to_string(),
        path: request.path.clone(),
    })?;

    if !canonical.starts_with(&workspace_canonical) {
        return Err(FileOperationError {
            code: FileErrorCode::PathOutsideWorkspace,
            message: "Path is outside workspace".to_string(),
            path: request.path.clone(),
        });
    }

    debug!(path = %request.path, "Reading file");

    let content = std::fs::read_to_string(&path).map_err(|e| FileOperationError {
        code: if e.kind() == std::io::ErrorKind::NotFound {
            FileErrorCode::NotFound
        } else {
            FileErrorCode::IoError
        },
        message: e.to_string(),
        path: request.path.clone(),
    })?;

    Ok(solo_protocol::FileReadResponse {
        content,
        encoding: "utf-8".to_string(),
    })
}

/// Write content to a file
#[tauri::command]
pub async fn write_file(
    request: solo_protocol::FileWriteRequest,
    state: State<'_, FsState>,
) -> Result<(), FileOperationError> {
    let workspace = state.workspace_root.read().await;
    let workspace_path = workspace.as_ref().ok_or_else(|| FileOperationError {
        code: FileErrorCode::InvalidPath,
        message: "No workspace root set".to_string(),
        path: request.path.clone(),
    })?;

    let path = PathBuf::from(&request.path);

    // Validate path is within workspace
    let canonical = path.canonicalize().map_err(|e| FileOperationError {
        code: FileErrorCode::NotFound,
        message: e.to_string(),
        path: request.path.clone(),
    })?;

    let workspace_canonical = workspace_path.canonicalize().map_err(|e| FileOperationError {
        code: FileErrorCode::IoError,
        message: e.to_string(),
        path: request.path.clone(),
    })?;

    if !canonical.starts_with(&workspace_canonical) {
        return Err(FileOperationError {
            code: FileErrorCode::PathOutsideWorkspace,
            message: "Path is outside workspace".to_string(),
            path: request.path.clone(),
        });
    }

    debug!(path = %request.path, "Writing file");

    std::fs::write(&path, &request.content).map_err(|e| FileOperationError {
        code: if e.kind() == std::io::ErrorKind::PermissionDenied {
            FileErrorCode::PermissionDenied
        } else {
            FileErrorCode::IoError
        },
        message: e.to_string(),
        path: request.path.clone(),
    })?;

    Ok(())
}

/// Rename/move a file or directory
#[tauri::command]
pub async fn rename_file(
    request: FileRenameRequest,
    state: State<'_, FsState>,
) -> Result<FileTreeEntry, FileOperationError> {
    let workspace = state.workspace_root.read().await;
    let workspace_path = workspace.as_ref().ok_or_else(|| FileOperationError {
        code: FileErrorCode::InvalidPath,
        message: "No workspace root set".to_string(),
        path: request.old_path.clone(),
    })?;

    let old_path = PathBuf::from(&request.old_path);
    let new_path = PathBuf::from(&request.new_path);

    info!(old_path = %request.old_path, new_path = %request.new_path, "Renaming");

    let is_dir = old_path.is_dir();

    operations::rename(&old_path, &new_path, workspace_path)
        .map_err(|e| to_protocol_error(e, &request.old_path))?;

    // Return the renamed entry
    let name = new_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(FileTreeEntry {
        name,
        path: request.new_path,
        is_dir,
        children: if is_dir { Some(vec![]) } else { None },
        size: None,
        modified: None,
    })
}

/// Delete a file or directory
#[tauri::command]
pub async fn delete_file(
    request: FileDeleteRequest,
    state: State<'_, FsState>,
) -> Result<(), FileOperationError> {
    let workspace = state.workspace_root.read().await;
    let workspace_path = workspace.as_ref().ok_or_else(|| FileOperationError {
        code: FileErrorCode::InvalidPath,
        message: "No workspace root set".to_string(),
        path: request.path.clone(),
    })?;

    let path = PathBuf::from(&request.path);

    info!(path = %request.path, recursive = request.recursive, "Deleting");

    operations::delete(&path, request.recursive, workspace_path)
        .map_err(|e| to_protocol_error(e, &request.path))?;

    Ok(())
}

/// Start watching a directory for changes
#[tauri::command]
pub async fn start_watching(
    path: String,
    recursive: bool,
    app: AppHandle,
    state: State<'_, FsState>,
) -> Result<(), String> {
    info!(path = %path, recursive, "Starting file watcher");

    let mut watcher_lock = state.watcher.write().await;

    // Track if this is a new watcher (we'll need to spawn the event forwarder)
    let is_new_watcher = watcher_lock.is_none();

    // Create a new watcher if needed
    if is_new_watcher {
        let watcher = FileWatcher::new().map_err(|e| e.to_string())?;
        *watcher_lock = Some(watcher);
    }

    let watcher = watcher_lock.as_ref().unwrap();

    // Start watching FIRST - if this fails, we don't spawn the event task
    let path_buf = PathBuf::from(&path);
    watcher.watch(&path_buf, recursive).await.map_err(|e| e.to_string())?;

    // Only spawn the event forwarder task for new watchers, after watch succeeds
    if is_new_watcher {
        let mut rx = watcher.subscribe();
        let app_handle = app.clone();

        tokio::spawn(async move {
            while let Ok(event) = rx.recv().await {
                let backend_event = match event.event_type {
                    FileEventType::Created => BackendEvent::FileCreated {
                        path: event.path.display().to_string(),
                    },
                    FileEventType::Modified => BackendEvent::FileChanged {
                        path: event.path.display().to_string(),
                    },
                    FileEventType::Deleted => BackendEvent::FileDeleted {
                        path: event.path.display().to_string(),
                    },
                    FileEventType::Renamed => {
                        if let Some(new_path) = event.new_path {
                            BackendEvent::FileRenamed {
                                old_path: event.path.display().to_string(),
                                new_path: new_path.display().to_string(),
                            }
                        } else {
                            continue;
                        }
                    }
                };

                if let Err(e) = app_handle.emit("backend-event", &backend_event) {
                    error!(error = %e, "Failed to emit file event");
                }
            }
        });
    }

    Ok(())
}

/// Reveal a file or directory in Finder (macOS)
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    info!(path = %path, "Revealing in Finder");

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let path_buf = PathBuf::from(&path);
        if path_buf.is_file() {
            // For files, reveal and select the file
            Command::new("open")
                .args(["-R", &path])
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            // For directories, open the directory
            Command::new("open")
                .arg(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Reveal in Finder is only supported on macOS".to_string())
    }
}

/// Stop watching for file changes
#[tauri::command]
pub async fn stop_watching(state: State<'_, FsState>) -> Result<(), String> {
    info!("Stopping file watcher");

    let mut watcher_lock = state.watcher.write().await;

    if let Some(watcher) = watcher_lock.as_ref() {
        watcher.stop().await.map_err(|e| e.to_string())?;
    }

    *watcher_lock = None;

    Ok(())
}
