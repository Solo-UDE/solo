#![warn(clippy::all, clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::wildcard_imports,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::uninlined_format_args,
    clippy::doc_markdown,
    clippy::return_self_not_must_use,
    clippy::redundant_closure_for_method_calls,
    clippy::single_match_else,
    clippy::if_not_else,
    clippy::match_same_arms,
    clippy::map_unwrap_or,
    clippy::similar_names,
    clippy::struct_excessive_bools
)]

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
pub mod git_watcher;
pub mod operations;
pub mod tree;
pub mod watcher;

// Re-export commonly used types
pub use errors::{FsError, FsResult};
pub use git_watcher::{GitRefWatcher, SharedGitRefWatcher};
pub use tree::{read_directory, FileMetadata};
pub use watcher::{FileEventType, FileWatchEvent, FileWatcher};
