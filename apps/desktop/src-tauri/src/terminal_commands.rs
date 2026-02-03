//! Terminal PTY command handlers for Solo IDE
//!
//! Manages pseudo-terminal processes via `portable-pty`.
//! Each terminal gets a UUID, a read thread for streaming output,
//! and write/resize/kill commands exposed as Tauri IPC handlers.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use solo_protocol::BackendEvent;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, error, info, warn};

pub struct PtyInstance {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

type TerminalsMap = Arc<RwLock<HashMap<String, PtyInstance>>>;

pub struct TerminalState {
    terminals: TerminalsMap,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl Default for TerminalState {
    fn default() -> Self {
        Self::new()
    }
}

/// Spawn a new PTY process and return its ID.
#[tauri::command]
pub fn spawn_pty(
    cwd: Option<String>,
    shell: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    env: Option<HashMap<String, String>>,
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<String, String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    // Detect shell
    let shell_path = shell.unwrap_or_else(|| {
        #[cfg(unix)]
        {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
        }
        #[cfg(windows)]
        {
            "powershell.exe".to_string()
        }
    });

    let working_dir = cwd.map(std::path::PathBuf::from).unwrap_or_else(|| {
        #[cfg(unix)]
        {
            std::env::var("HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("/"))
        }
        #[cfg(windows)]
        {
            std::env::var("USERPROFILE")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("C:\\"))
        }
    });

    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.cwd(&working_dir);

    // Merge extra env vars
    if let Some(vars) = env {
        for (k, v) in vars {
            cmd.env(k, v);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    let id = uuid::Uuid::new_v4().to_string();

    let child_arc = Arc::new(Mutex::new(child));
    let child_for_reader = Arc::clone(&child_arc);

    let instance = PtyInstance {
        writer: Arc::new(Mutex::new(writer)),
        master: Arc::new(Mutex::new(pair.master)),
        child: child_arc,
    };

    let terminals_ref = Arc::clone(&state.terminals);

    {
        let mut terminals = terminals_ref
            .write()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        terminals.insert(id.clone(), instance);
    }

    // Spawn a blocking read thread (PTY I/O is not async)
    let read_id = id.clone();
    std::thread::spawn(move || {
        read_loop(reader, &read_id, &app, &child_for_reader, &terminals_ref);
    });

    info!(id = %id, shell = %shell_path, cwd = %working_dir.display(), "Spawned PTY");
    Ok(id)
}

/// Blocking read loop that forwards PTY output to the frontend.
/// On exit, waits for the child process to get the exit code and removes
/// the terminal entry from the shared map to prevent resource leaks.
fn read_loop(
    mut reader: Box<dyn Read + Send>,
    id: &str,
    app: &AppHandle,
    child: &Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    terminals: &TerminalsMap,
) {
    let mut buf = [0u8; 4096];
    // Carry-over buffer for incomplete UTF-8 sequences at read boundaries
    let mut carry: Vec<u8> = Vec::new();

    loop {
        match reader.read(&mut buf) {
            Ok(0) => {
                debug!(id = %id, "PTY reader got EOF");
                break;
            }
            Ok(n) => {
                // Prepend any leftover bytes from a previous incomplete UTF-8 sequence
                let chunk = if carry.is_empty() {
                    &buf[..n]
                } else {
                    carry.extend_from_slice(&buf[..n]);
                    carry.as_slice()
                };

                // Find the last valid UTF-8 boundary
                let (valid, remainder) = split_utf8(chunk);

                if !valid.is_empty() {
                    let data = String::from_utf8_lossy(valid).into_owned();
                    let event = BackendEvent::TerminalData {
                        id: id.to_string(),
                        data,
                    };
                    if let Err(e) = app.emit("terminal-event", &event) {
                        error!(id = %id, error = %e, "Failed to emit terminal data");
                    }
                }

                // Save incomplete trailing bytes for the next read
                carry = remainder.to_vec();
            }
            Err(e) => {
                warn!(id = %id, error = %e, "PTY read error");
                break;
            }
        }
    }

    // Flush any remaining carry bytes (lossy — should be rare)
    if !carry.is_empty() {
        let data = String::from_utf8_lossy(&carry).into_owned();
        let event = BackendEvent::TerminalData {
            id: id.to_string(),
            data,
        };
        let _ = app.emit("terminal-event", &event);
    }

    // Wait for the child process to get the exit code
    let exit_code = match child.lock() {
        Ok(mut child_guard) => match child_guard.wait() {
            Ok(status) => {
                if status.success() {
                    Some(0)
                } else {
                    // portable-pty ExitStatus doesn't expose the raw code on all platforms,
                    // but we can at least distinguish success vs failure
                    Some(1)
                }
            }
            Err(e) => {
                debug!(id = %id, error = %e, "Failed to wait for child process");
                None
            }
        },
        Err(e) => {
            debug!(id = %id, error = %e, "Child lock poisoned during exit");
            None
        }
    };

    let exit_event = BackendEvent::TerminalExit {
        id: id.to_string(),
        code: exit_code,
    };
    if let Err(e) = app.emit("terminal-event", &exit_event) {
        error!(id = %id, error = %e, "Failed to emit terminal exit");
    }

    // Remove the dead terminal from the shared map to free resources
    if let Ok(mut map) = terminals.write() {
        if map.remove(id).is_some() {
            debug!(id = %id, "Cleaned up PTY from state after exit");
        }
    }
}

/// Split a byte slice at the last valid UTF-8 boundary.
/// Returns (valid_prefix, incomplete_trailing_bytes).
fn split_utf8(bytes: &[u8]) -> (&[u8], &[u8]) {
    match std::str::from_utf8(bytes) {
        Ok(_) => (bytes, &[]),
        Err(e) => {
            let valid_up_to = e.valid_up_to();
            // Check if there's an incomplete sequence at the end (vs a truly invalid byte)
            if e.error_len().is_none() {
                // Incomplete sequence — split at the boundary
                (&bytes[..valid_up_to], &bytes[valid_up_to..])
            } else {
                // Truly invalid byte — include it in the valid portion (lossy),
                // skip past the bad bytes
                let bad_len = e.error_len().unwrap();
                let skip = valid_up_to + bad_len;
                if skip < bytes.len() {
                    // Recurse on the remainder to find the next split point.
                    // For simplicity in a terminal context, just return everything as valid (lossy).
                    (bytes, &[])
                } else {
                    (bytes, &[])
                }
            }
        }
    }
}

/// Write data to a terminal's stdin.
#[tauri::command]
pub fn write_pty(
    id: String,
    data: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let terminals = state
        .terminals
        .read()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    let instance = terminals
        .get(&id)
        .ok_or_else(|| format!("Terminal not found: {id}"))?;

    let mut writer = instance
        .writer
        .lock()
        .map_err(|e| format!("Writer lock poisoned: {e}"))?;

    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {e}"))?;

    Ok(())
}

/// Resize a terminal.
#[tauri::command]
pub fn resize_pty(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let terminals = state
        .terminals
        .read()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    let instance = terminals
        .get(&id)
        .ok_or_else(|| format!("Terminal not found: {id}"))?;

    let master = instance
        .master
        .lock()
        .map_err(|e| format!("Master lock poisoned: {e}"))?;

    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {e}"))?;

    debug!(id = %id, cols = cols, rows = rows, "Resized PTY");
    Ok(())
}

/// Kill a terminal process and remove it from state.
#[tauri::command]
pub fn kill_pty(
    id: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let mut terminals = state
        .terminals
        .write()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    if let Some(instance) = terminals.remove(&id) {
        if let Ok(mut child) = instance.child.lock() {
            let _ = child.kill();
        }
        info!(id = %id, "Killed PTY");
    } else {
        debug!(id = %id, "Terminal already gone");
    }

    Ok(())
}
