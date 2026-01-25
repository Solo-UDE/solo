//! File system watcher with debouncing support

use crate::errors::FsResult;
use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{debug, info};

/// Default debounce duration in milliseconds
const DEFAULT_DEBOUNCE_MS: u64 = 100;

/// File watch event types
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileEventType {
    Created,
    Modified,
    Deleted,
    Renamed,
}

/// A file system change event
#[derive(Debug, Clone)]
pub struct FileWatchEvent {
    /// Type of change
    pub event_type: FileEventType,
    /// Affected path
    pub path: PathBuf,
    /// For rename events, the new path
    pub new_path: Option<PathBuf>,
}

/// File watcher state
struct WatcherState {
    /// The underlying notify watcher
    watcher: Option<RecommendedWatcher>,
    /// Currently watched paths
    watched_paths: Vec<PathBuf>,
    /// Whether the watcher is active
    is_running: bool,
}

/// File system watcher with debouncing
pub struct FileWatcher {
    state: Arc<RwLock<WatcherState>>,
    /// Broadcast channel for sending events to subscribers
    event_tx: broadcast::Sender<FileWatchEvent>,
    /// Debounce duration
    debounce_duration: Duration,
}

impl FileWatcher {
    /// Create a new file watcher
    pub fn new() -> FsResult<Self> {
        Self::with_debounce(Duration::from_millis(DEFAULT_DEBOUNCE_MS))
    }

    /// Create a new file watcher with custom debounce duration
    pub fn with_debounce(debounce_duration: Duration) -> FsResult<Self> {
        let (event_tx, _) = broadcast::channel(256);

        Ok(Self {
            state: Arc::new(RwLock::new(WatcherState {
                watcher: None,
                watched_paths: Vec::new(),
                is_running: false,
            })),
            event_tx,
            debounce_duration,
        })
    }

    /// Get a receiver for file events
    pub fn subscribe(&self) -> broadcast::Receiver<FileWatchEvent> {
        self.event_tx.subscribe()
    }

    /// Start watching a path
    pub async fn watch(&self, path: &Path, recursive: bool) -> FsResult<()> {
        let mut state = self.state.write().await;

        // Create watcher if it doesn't exist
        if state.watcher.is_none() {
            let (tx, mut rx) = mpsc::channel::<Event>(256);
            let event_tx = self.event_tx.clone();
            let debounce_duration = self.debounce_duration;

            // Create the notify watcher
            let watcher = RecommendedWatcher::new(
                move |res: Result<Event, notify::Error>| {
                    if let Ok(event) = res {
                        let _ = tx.blocking_send(event);
                    }
                },
                Config::default().with_poll_interval(Duration::from_millis(100)),
            )?;

            // Start the debouncing task
            tokio::spawn(async move {
                let mut pending_events: HashMap<PathBuf, (FileEventType, Instant, Option<PathBuf>)> =
                    HashMap::new();

                loop {
                    // Check for new events with timeout
                    let timeout = tokio::time::timeout(
                        Duration::from_millis(50),
                        rx.recv(),
                    )
                    .await;

                    match timeout {
                        Ok(Some(event)) => {
                            // Process the event
                            if let Some((path, event_type, new_path)) = process_notify_event(&event) {
                                pending_events.insert(
                                    path.clone(),
                                    (event_type, Instant::now(), new_path),
                                );
                            }
                        }
                        Ok(None) => {
                            // Channel closed, exit
                            break;
                        }
                        Err(_) => {
                            // Timeout - check for events ready to emit
                        }
                    }

                    // Emit events that have been debounced
                    let now = Instant::now();
                    let mut to_emit = Vec::new();

                    pending_events.retain(|path, (event_type, timestamp, new_path)| {
                        if now.duration_since(*timestamp) >= debounce_duration {
                            to_emit.push(FileWatchEvent {
                                event_type: event_type.clone(),
                                path: path.clone(),
                                new_path: new_path.clone(),
                            });
                            false // Remove from pending
                        } else {
                            true // Keep in pending
                        }
                    });

                    // Send debounced events
                    for event in to_emit {
                        debug!(
                            event_type = ?event.event_type,
                            path = %event.path.display(),
                            "Emitting file watch event"
                        );
                        let _ = event_tx.send(event);
                    }
                }
            });

            state.watcher = Some(watcher);
            state.is_running = true;
        }

        // Add the path to watch
        if let Some(watcher) = &mut state.watcher {
            let mode = if recursive {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };

            watcher.watch(path, mode)?;
            state.watched_paths.push(path.to_path_buf());

            info!(path = %path.display(), recursive, "Started watching path");
        }

        Ok(())
    }

    /// Stop watching a path
    pub async fn unwatch(&self, path: &Path) -> FsResult<()> {
        let mut state = self.state.write().await;

        if let Some(watcher) = &mut state.watcher {
            watcher.unwatch(path)?;
            state.watched_paths.retain(|p| p != path);

            info!(path = %path.display(), "Stopped watching path");
        }

        Ok(())
    }

    /// Stop watching all paths and shut down the watcher
    pub async fn stop(&self) -> FsResult<()> {
        let mut state = self.state.write().await;

        // Clone paths before unwatching to avoid borrow conflict
        let paths_to_unwatch: Vec<PathBuf> = state.watched_paths.clone();
        if let Some(watcher) = &mut state.watcher {
            for path in &paths_to_unwatch {
                let _ = watcher.unwatch(path);
            }
        }

        state.watcher = None;
        state.watched_paths.clear();
        state.is_running = false;

        info!("File watcher stopped");

        Ok(())
    }

    /// Check if the watcher is running
    pub async fn is_running(&self) -> bool {
        self.state.read().await.is_running
    }

    /// Get list of currently watched paths
    pub async fn watched_paths(&self) -> Vec<PathBuf> {
        self.state.read().await.watched_paths.clone()
    }
}

impl Default for FileWatcher {
    fn default() -> Self {
        Self::new().expect("Failed to create file watcher")
    }
}

/// Process a notify event into our event type
fn process_notify_event(event: &Event) -> Option<(PathBuf, FileEventType, Option<PathBuf>)> {
    let path = event.paths.first()?.clone();

    // Skip temporary files and common editor backup files
    let path_str = path.to_string_lossy();
    if path_str.ends_with('~')
        || path_str.ends_with(".swp")
        || path_str.ends_with(".swx")
        || path_str.ends_with(".tmp")
        || path_str.contains(".git/")
        || path_str.contains("node_modules/")
    {
        return None;
    }

    let event_type = match event.kind {
        EventKind::Create(_) => FileEventType::Created,
        EventKind::Modify(_) => FileEventType::Modified,
        EventKind::Remove(_) => FileEventType::Deleted,
        EventKind::Any => return None,
        EventKind::Access(_) => return None, // Ignore access events
        EventKind::Other => return None,
    };

    // For rename events, try to get the new path
    let new_path = if matches!(event.kind, EventKind::Modify(_)) && event.paths.len() > 1 {
        event.paths.get(1).cloned()
    } else {
        None
    };

    Some((path, event_type, new_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;
    use tokio::time::timeout;

    #[tokio::test]
    async fn test_watcher_creation() {
        let watcher = FileWatcher::new().unwrap();
        assert!(!watcher.is_running().await);
    }

    #[tokio::test]
    async fn test_watch_directory() {
        let temp = TempDir::new().unwrap();
        let watcher = FileWatcher::new().unwrap();

        watcher.watch(temp.path(), true).await.unwrap();

        assert!(watcher.is_running().await);
        assert_eq!(watcher.watched_paths().await.len(), 1);
    }

    #[tokio::test]
    async fn test_unwatch_directory() {
        let temp = TempDir::new().unwrap();
        let watcher = FileWatcher::new().unwrap();

        watcher.watch(temp.path(), true).await.unwrap();
        watcher.unwatch(temp.path()).await.unwrap();

        assert!(watcher.watched_paths().await.is_empty());
    }

    #[tokio::test]
    async fn test_file_created_event() {
        let temp = TempDir::new().unwrap();
        let watcher = FileWatcher::with_debounce(Duration::from_millis(50)).unwrap();
        let mut rx = watcher.subscribe();

        watcher.watch(temp.path(), true).await.unwrap();

        // Create a file
        let file_path = temp.path().join("test.txt");
        fs::write(&file_path, "content").unwrap();

        // Wait for the event
        let result = timeout(Duration::from_secs(2), rx.recv()).await;

        assert!(result.is_ok(), "Should receive event within timeout");
        let event = result.unwrap().unwrap();
        // Note: On macOS FSEvents, file creation may be reported as Created or Modified
        assert!(
            event.event_type == FileEventType::Created || event.event_type == FileEventType::Modified,
            "Expected Created or Modified event, got {:?}", event.event_type
        );
    }

    #[tokio::test]
    async fn test_stop_watcher() {
        let temp = TempDir::new().unwrap();
        let watcher = FileWatcher::new().unwrap();

        watcher.watch(temp.path(), true).await.unwrap();
        watcher.stop().await.unwrap();

        assert!(!watcher.is_running().await);
        assert!(watcher.watched_paths().await.is_empty());
    }
}
