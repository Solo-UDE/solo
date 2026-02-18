//! Agent Bridge - Spawns and communicates with the Node.js sidecar
//!
//! Uses stdin/stdout JSON IPC to communicate with the agent-bridge Node.js process.

use std::fmt;
use std::io::{BufRead as _, BufReader, Write as _};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::result;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;

use super::protocol::{BridgeEvent, BridgeRequest, BridgeResponse, CommandResponse};

/// Error type for bridge operations
#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    /// Failed to spawn sidecar process
    #[error("Failed to spawn sidecar: {0}")]
    SpawnError(String),
    /// Sidecar is not running
    #[error("Sidecar not running")]
    NotRunning,
    /// Failed to send request to sidecar
    #[error("Failed to send request: {0}")]
    SendError(String),
    /// Failed to receive response from sidecar
    #[error("Failed to receive response: {0}")]
    ReceiveError(String),
    /// Sidecar returned an error
    #[error("Sidecar returned error: {0}")]
    SidecarError(String),
    /// Timeout waiting for response
    #[error("Timeout waiting for response")]
    Timeout,
    /// JSON serialization error
    #[error("JSON serialization error: {0}")]
    JsonError(#[from] serde_json::Error),
}

/// Result type alias for bridge operations
pub type Result<T> = result::Result<T, BridgeError>;

/// Callback for handling events from the sidecar
pub type EventCallback = Arc<dyn Fn(BridgeEvent) + Send + Sync>;

/// Agent Bridge - manages the Node.js sidecar process
pub struct AgentBridge {
    /// Child process handle
    child: Option<Child>,
    /// Stdin for sending requests (wrapped in Mutex for interior mutability)
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    /// Channel for receiving responses
    response_rx: Option<Receiver<BridgeResponse>>,
    /// Event callback
    event_callback: Option<EventCallback>,
    /// Whether the bridge is ready
    ready: bool,
}

impl AgentBridge {
    /// Create a new bridge (does not spawn yet)
    #[must_use]
    pub fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            response_rx: None,
            event_callback: None,
            ready: false,
        }
    }

    /// Set the event callback for handling async events
    pub fn set_event_callback(&mut self, callback: EventCallback) {
        self.event_callback = Some(callback);
    }

    /// Spawn the sidecar process
    pub fn spawn(&mut self, node_script_path: &str) -> Result<()> {
        if self.child.is_some() {
            return Ok(()); // Already running
        }

        tracing::info!("Spawning agent bridge sidecar: {node_script_path}");

        // Spawn the Node.js process
        let mut child = Command::new("node")
            .arg(node_script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit()) // Let stderr go to parent's stderr for debugging
            .spawn()
            .map_err(|e| BridgeError::SpawnError(e.to_string()))?;

        // Take ownership of stdin
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| BridgeError::SpawnError("Failed to get stdin".to_owned()))?;

        // Take ownership of stdout
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| BridgeError::SpawnError("Failed to get stdout".to_owned()))?;

        // Create channel for responses (bounded to prevent memory issues)
        let (tx, rx) = bounded(1000);
        self.response_rx = Some(rx);

        // Spawn reader thread
        let event_callback = self.event_callback.clone();
        drop(thread::spawn(move || {
            Self::reader_thread(stdout, &tx, event_callback.as_ref());
        }));

        self.child = Some(child);
        self.stdin = Some(Arc::new(Mutex::new(stdin)));

        // Wait for ready event — if this fails, clean up so we can retry
        if let Err(e) = self.wait_for_ready() {
            tracing::error!("Agent bridge failed to become ready: {e}");
            // Kill the child and reset state so subsequent spawn attempts actually retry
            if let Some(mut child) = self.child.take() {
                drop(child.kill());
                drop(child.wait());
            }
            self.stdin = None;
            self.response_rx = None;
            self.ready = false;
            return Err(e);
        }

        tracing::info!("Agent bridge sidecar ready");
        Ok(())
    }

    /// Reader thread - reads JSON lines from stdout
    fn reader_thread(
        stdout: ChildStdout,
        tx: &Sender<BridgeResponse>,
        event_callback: Option<&EventCallback>,
    ) {
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if line.is_empty() {
                        continue;
                    }

                    match serde_json::from_str::<BridgeResponse>(&line) {
                        Ok(response) => {
                            // Check if it's an event or command response
                            if let Some(event) = response.as_event() {
                                // Fire event callback if set
                                if let Some(callback) = event_callback {
                                    callback(event.clone());
                                }
                            }

                            // Always send through channel for request-response matching
                            if tx.send(response).is_err() {
                                tracing::debug!("Response channel closed, exiting reader thread");
                                break;
                            }
                        },
                        Err(e) => {
                            tracing::error!("Failed to parse response: {e}\nLine: {line}");
                        },
                    }
                },
                Err(e) => {
                    tracing::error!("Failed to read line: {e}");
                    break;
                },
            }
        }

        tracing::debug!("Reader thread exiting");
    }

    /// Wait for the ready event
    fn wait_for_ready(&mut self) -> Result<()> {
        let rx = self.response_rx.as_ref().ok_or(BridgeError::NotRunning)?;

        // Wait up to 30 seconds for ready
        let timeout = Duration::from_secs(30);

        loop {
            match rx.recv_timeout(timeout) {
                Ok(response) => {
                    if response.is_ready() {
                        self.ready = true;
                        return Ok(());
                    }
                    // Ignore other events during startup
                },
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                    return Err(BridgeError::Timeout);
                },
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                    return Err(BridgeError::ReceiveError("Channel disconnected".to_owned()));
                },
            }
        }
    }

    /// Send a request and wait for response
    pub fn send_request(&self, request: &BridgeRequest) -> Result<CommandResponse> {
        if !self.ready {
            return Err(BridgeError::NotRunning);
        }

        let stdin = self.stdin.as_ref().ok_or(BridgeError::NotRunning)?;
        let rx = self.response_rx.as_ref().ok_or(BridgeError::NotRunning)?;

        // Serialize and send request (lock stdin)
        {
            let mut stdin_guard = stdin.lock();
            let json = serde_json::to_string(request)?;
            writeln!(stdin_guard, "{json}").map_err(|e| BridgeError::SendError(e.to_string()))?;
            stdin_guard
                .flush()
                .map_err(|e| BridgeError::SendError(e.to_string()))?;
        }

        // Wait for response (with timeout)
        let timeout = Duration::from_secs(300); // 5 minutes for long operations

        loop {
            match rx.recv_timeout(timeout) {
                Ok(response) => {
                    // Check if it's a command response (not an event)
                    if let Some(cmd) = response.as_command() {
                        return Ok(cmd.clone());
                    }
                    // Skip events, continue waiting for command response
                },
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                    return Err(BridgeError::Timeout);
                },
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                    return Err(BridgeError::ReceiveError("Channel disconnected".to_owned()));
                },
            }
        }
    }

    /// Send a request without waiting for response (fire and forget)
    pub fn send_request_async(&self, request: &BridgeRequest) -> Result<()> {
        if !self.ready {
            return Err(BridgeError::NotRunning);
        }

        let stdin = self.stdin.as_ref().ok_or(BridgeError::NotRunning)?;

        let mut stdin_guard = stdin.lock();
        let json = serde_json::to_string(request)?;
        writeln!(stdin_guard, "{json}").map_err(|e| BridgeError::SendError(e.to_string()))?;
        stdin_guard
            .flush()
            .map_err(|e| BridgeError::SendError(e.to_string()))?;

        Ok(())
    }

    /// Check if the bridge is running
    #[must_use]
    pub fn is_running(&self) -> bool {
        self.ready && self.child.is_some()
    }

    /// Shutdown the bridge
    pub fn shutdown(&mut self) -> Result<()> {
        if !self.is_running() {
            return Ok(());
        }

        tracing::info!("Shutting down agent bridge");

        // Send shutdown request (ignore result - process may already be dead)
        drop(self.send_request(&BridgeRequest::Shutdown));

        // Give it a moment to clean up
        thread::sleep(Duration::from_millis(100));

        // Force kill if still running
        if let Some(mut child) = self.child.take() {
            drop(child.kill());
            drop(child.wait());
        }

        self.stdin = None;
        self.response_rx = None;
        self.ready = false;

        tracing::info!("Agent bridge shutdown complete");
        Ok(())
    }
}

impl Drop for AgentBridge {
    fn drop(&mut self) {
        drop(self.shutdown());
    }
}

impl Default for AgentBridge {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for AgentBridge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AgentBridge")
            .field("ready", &self.ready)
            .field("running", &self.child.is_some())
            .finish_non_exhaustive()
    }
}
