//! Narrow watcher for a repo's `.git/` directory.
//!
//! The main [`FileWatcher`](crate::watcher::FileWatcher) explicitly ignores `.git/` to
//! keep the editor's file-change stream clean. That leaves git-tree state invisible to
//! the UI whenever it's mutated outside our Tauri commands — e.g. the agent's Bash tool,
//! an embedded terminal, or a detached external shell. This watcher fills that gap by
//! watching the ref and index files directly and emitting a single coarse signal, which
//! the caller converts into a `GitChangesUpdated` backend event.

use crate::errors::FsResult;
use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{debug, info, warn};

/// Debounce for collapsing bursts of `.git/` writes (e.g. `git commit` rewrites
/// index + HEAD + refs in rapid succession).
const DEBOUNCE_MS: u64 = 200;

/// A narrow watcher that observes just the load-bearing files inside one `.git/`
/// directory and emits a `()` signal on every debounced change.
pub struct GitRefWatcher {
    _watcher: RecommendedWatcher,
    _handle: tokio::task::JoinHandle<()>,
    event_tx: broadcast::Sender<()>,
    watched_root: PathBuf,
}

impl GitRefWatcher {
    /// Start watching `<workspace>/.git/` for ref/index changes. Returns `None` if the
    /// workspace isn't a git repo.
    pub fn start(workspace: &Path) -> FsResult<Option<Self>> {
        let git_dir = workspace.join(".git");
        if !git_dir.exists() {
            return Ok(None);
        }

        let (tx, mut rx) = mpsc::channel::<Event>(256);
        let (event_tx, _) = broadcast::channel::<()>(16);

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.try_send(event);
                }
            },
            Config::default().with_poll_interval(Duration::from_millis(200)),
        )?;

        // Watch the whole `.git/` recursively — it's small and the ignore blanket
        // upstream means we don't need to cherry-pick specific files.
        watcher.watch(&git_dir, RecursiveMode::Recursive)?;
        info!(path = %git_dir.display(), "GitRefWatcher: watching .git/");

        let event_tx_clone = event_tx.clone();
        let handle = tokio::spawn(async move {
            let debounce = Duration::from_millis(DEBOUNCE_MS);
            let mut last_event_at: Option<Instant> = None;

            loop {
                let timeout = tokio::time::timeout(Duration::from_millis(50), rx.recv()).await;
                match timeout {
                    Ok(Some(event)) => {
                        if is_interesting(&event) {
                            last_event_at = Some(Instant::now());
                        }
                    }
                    Ok(None) => break, // channel closed
                    Err(_) => {}       // timeout, fall through to debounce check
                }

                if let Some(t) = last_event_at {
                    if t.elapsed() >= debounce {
                        debug!("GitRefWatcher: emitting changes_updated signal");
                        let _ = event_tx_clone.send(());
                        last_event_at = None;
                    }
                }
            }
        });

        Ok(Some(Self {
            _watcher: watcher,
            _handle: handle,
            event_tx,
            watched_root: git_dir,
        }))
    }

    /// Subscribe to debounced change signals.
    pub fn subscribe(&self) -> broadcast::Receiver<()> {
        self.event_tx.subscribe()
    }

    /// Returns the `.git/` directory this watcher is observing.
    pub fn watched_root(&self) -> &Path {
        &self.watched_root
    }
}

/// True when the event touches a file that represents repo state the UI cares about.
/// Filters out lock files (e.g. `index.lock`) and `.log` trailing writes that would
/// otherwise cause spurious refreshes.
fn is_interesting(event: &Event) -> bool {
    // Only fire on actual writes/creates/removes — metadata-only events (access,
    // chmod) don't change repo state.
    let touches_content = matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    );
    if !touches_content {
        return false;
    }

    let Some(path) = event.paths.first() else {
        return false;
    };
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

    // Skip transient lock files; the real write happens when the lock is renamed over
    // its target and that produces its own event. Git always writes lowercase ".lock".
    if path.extension().is_some_and(|e| e == "lock") {
        return false;
    }
    // Skip packed refs cache — churns without changing logical state.
    if name == "packed-refs.new" {
        return false;
    }
    // Everything else inside .git/ is fair game (HEAD, index, refs/**,
    // MERGE_HEAD, ORIG_HEAD, FETCH_HEAD, logs/**).
    true
}

/// Shared, hot-swappable handle. Callers replace the inner watcher when the
/// workspace changes (open a folder, switch worktrees). The old watcher is dropped
/// which tears down its notify handle and background task.
pub type SharedGitRefWatcher = Arc<Mutex<Option<GitRefWatcher>>>;

/// Replace the currently installed watcher (if any) with a fresh one for `workspace`.
/// A non-repo workspace clears the slot.
pub async fn install(shared: &SharedGitRefWatcher, workspace: &Path) -> FsResult<()> {
    let new_watcher = match GitRefWatcher::start(workspace) {
        Ok(w) => w,
        Err(e) => {
            warn!("GitRefWatcher: failed to start for {}: {}", workspace.display(), e);
            return Err(e);
        }
    };
    let mut slot = shared.lock().await;
    *slot = new_watcher;
    Ok(())
}
