//! File system error types for Solo IDE

use thiserror::Error;

/// File system error types
#[derive(Error, Debug)]
pub enum FsError {
    #[error("File not found: {0}")]
    NotFound(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("File already exists: {0}")]
    AlreadyExists(String),

    #[error("Not a directory: {0}")]
    NotADirectory(String),

    #[error("Not a file: {0}")]
    NotAFile(String),

    #[error("Directory not empty: {0}")]
    DirectoryNotEmpty(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("Path outside workspace: {0}")]
    PathOutsideWorkspace(String),

    #[error("Watcher error: {0}")]
    Watcher(#[from] notify::Error),
}

impl FsError {
    /// Convert IO error kind to appropriate FsError variant
    pub fn from_io_error(err: std::io::Error, path: &str) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => FsError::NotFound(path.to_string()),
            std::io::ErrorKind::PermissionDenied => FsError::PermissionDenied(path.to_string()),
            std::io::ErrorKind::AlreadyExists => FsError::AlreadyExists(path.to_string()),
            _ => FsError::Io(err),
        }
    }
}

/// Result type alias for file system operations
pub type FsResult<T> = Result<T, FsError>;
