//! Solo File System - File operations and watching for Solo IDE
//!
//! This crate provides file system functionality for the Solo IDE, including:
//! - Directory tree reading with lazy loading
//! - File CRUD operations (create, read, update, delete)
//! - File system watching with debouncing
//!
//! # Example
//!
//! ```no_run
//! use solo_fs::{tree, operations, watcher::FileWatcher};
//! use std::path::Path;
//!
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! // Read a directory tree
//! let entry = tree::read_directory(Path::new("/path/to/project"), 1)?;
//!
//! // Create a file
//! operations::create_file(
//!     Path::new("/path/to/project/new.txt"),
//!     Some("Hello, World!"),
//!     Path::new("/path/to/project"),
//! )?;
//!
//! // Watch for file changes
//! let watcher = FileWatcher::new()?;
//! let mut rx = watcher.subscribe();
//! watcher.watch(Path::new("/path/to/project"), true).await?;
//!
//! // Receive events
//! while let Ok(event) = rx.recv().await {
//!     println!("File event: {:?}", event);
//! }
//! # Ok(())
//! # }
//! ```

pub mod errors;
pub mod operations;
pub mod tree;
pub mod watcher;

// Re-export commonly used types
pub use errors::{FsError, FsResult};
pub use tree::{read_directory, FileMetadata};
pub use watcher::{FileEventType, FileWatchEvent, FileWatcher};
