//! Terminal PTY command handlers for Solo IDE
//!
//! Manages pseudo-terminal processes via `portable-pty`.
//! Each terminal gets a UUID, a read thread for streaming output,
//! and write/resize/kill commands exposed as Tauri IPC handlers.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use solo_protocol::BackendEvent;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, error, info, warn};

const BATCH_FLUSH_INTERVAL: Duration = Duration::from_millis(16);

const SHELL_CONFIG_VERSION: &str = "# solo-shell-v1";

const ZSH_RC: &str = r#"# solo-shell-v1
# Restore original ZDOTDIR for subshells
if [[ -n "$_SOLO_ORIG_ZDOTDIR" ]]; then
  export ZDOTDIR="$_SOLO_ORIG_ZDOTDIR"
else
  unset ZDOTDIR
fi

# Source user config (PATH, aliases, completions, plugins)
[[ -f "${HOME}/.zshrc" ]] && source "${HOME}/.zshrc"

# Solo prompt — only inside Solo terminal
[[ -z "$SOLO_TERMINAL" ]] && return

__solo_git_info() {
  local branch
  branch=$(git symbolic-ref --short HEAD 2>/dev/null) || return
  local dirty=""
  if ! git diff --quiet --ignore-submodules 2>/dev/null || \
     ! git diff --cached --quiet --ignore-submodules 2>/dev/null; then
    dirty=" %F{yellow}✗%f"
  fi
  echo " %F{cyan}git:(%F{red}${branch}%F{cyan})%f${dirty}"
}

precmd() { PROMPT="%F{cyan}→%f  %F{red}%n%f$(__solo_git_info) " }
"#;

const BASH_RC: &str = r#"# solo-shell-v1
[[ -f "${HOME}/.bashrc" ]] && source "${HOME}/.bashrc"
[[ -z "$SOLO_TERMINAL" ]] && return

__solo_git_info() {
  local branch
  branch=$(git symbolic-ref --short HEAD 2>/dev/null) || return
  local dirty=""
  if ! git diff --quiet --ignore-submodules 2>/dev/null || \
     ! git diff --cached --quiet --ignore-submodules 2>/dev/null; then
    dirty=" \[\e[33m\]✗\[\e[0m\]"
  fi
  echo " \[\e[36m\]git:(\[\e[31m\]${branch}\[\e[36m\])\[\e[0m\]${dirty}"
}

PROMPT_COMMAND='PS1="\[\e[36m\]→\[\e[0m\]  \[\e[31m\]\u\[\e[0m\]$(__solo_git_info) "'
"#;

fn solo_shell_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".solo").join("shell")
}

/// Write a file only if it's missing or the version header doesn't match.
fn write_if_outdated(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        if let Ok(existing) = std::fs::read_to_string(path) {
            if existing.starts_with(SHELL_CONFIG_VERSION) {
                return Ok(());
            }
        }
    }
    std::fs::write(path, content).map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

/// Create Solo shell RC files in ~/.solo/shell/ (best-effort).
fn ensure_shell_configs() -> Result<(), String> {
    let base = solo_shell_dir();
    let zsh_dir = base.join("zsh");
    let bash_dir = base.join("bash");

    std::fs::create_dir_all(&zsh_dir)
        .map_err(|e| format!("Failed to create {}: {e}", zsh_dir.display()))?;
    std::fs::create_dir_all(&bash_dir)
        .map_err(|e| format!("Failed to create {}: {e}", bash_dir.display()))?;

    write_if_outdated(&zsh_dir.join(".zshrc"), ZSH_RC)?;
    write_if_outdated(&bash_dir.join(".bashrc"), BASH_RC)?;

    Ok(())
}

#[derive(Serialize)]
pub struct SpawnResult {
    id: String,
    shell: String,
}

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

/// Spawn a new PTY process and return its ID and shell name.
#[tauri::command]
pub fn spawn_pty(
    cwd: Option<String>,
    shell: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    env: Option<HashMap<String, String>>,
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<SpawnResult, String> {
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

    // Best-effort: generate Solo shell configs before spawning
    if let Err(e) = ensure_shell_configs() {
        warn!("Failed to ensure shell configs: {e}");
    }

    let shell_name_lower = std::path::Path::new(&shell_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    let is_zsh = shell_name_lower == "zsh";
    let is_bash = shell_name_lower == "bash";

    let mut cmd = if is_bash {
        // Bash: use --rcfile to source our custom config
        let rc_path = solo_shell_dir().join("bash").join(".bashrc");
        let mut c = CommandBuilder::new(&shell_path);
        c.arg("--rcfile");
        c.arg(rc_path.to_string_lossy().as_ref());
        c
    } else {
        CommandBuilder::new(&shell_path)
    };

    cmd.cwd(&working_dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("SOLO_TERMINAL", "1");

    if is_zsh {
        // Save original ZDOTDIR so our .zshrc can restore it for subshells
        if let Ok(orig) = std::env::var("ZDOTDIR") {
            cmd.env("_SOLO_ORIG_ZDOTDIR", &orig);
        }
        let zsh_dir = solo_shell_dir().join("zsh");
        cmd.env("ZDOTDIR", zsh_dir.to_string_lossy().as_ref());
    }

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

    let shell_name = std::path::Path::new(&shell_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("shell")
        .to_string();

    info!(id = %id, shell = %shell_path, cwd = %working_dir.display(), "Spawned PTY");
    Ok(SpawnResult {
        id,
        shell: shell_name,
    })
}

/// Emit accumulated terminal data as a single IPC event.
fn flush_batch(batch: &mut String, id: &str, app: &AppHandle, last_flush: &mut Instant) {
    if batch.is_empty() {
        return;
    }
    let event = BackendEvent::TerminalData {
        id: id.to_string(),
        data: batch.clone(),
    };
    if let Err(e) = app.emit("terminal-event", &event) {
        error!(id = %id, error = %e, "Failed to emit terminal data");
    }
    batch.clear();
    *last_flush = Instant::now();
}

/// Blocking read loop that forwards PTY output to the frontend.
/// Batches output and flushes at most once per ~16ms to avoid IPC flooding.
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
    let mut carry: Vec<u8> = Vec::new();
    let mut batch = String::with_capacity(16384);
    let mut last_flush = Instant::now();

    loop {
        match reader.read(&mut buf) {
            Ok(0) => {
                debug!(id = %id, "PTY reader got EOF");
                break;
            }
            Ok(n) => {
                let chunk = if carry.is_empty() {
                    &buf[..n]
                } else {
                    carry.extend_from_slice(&buf[..n]);
                    carry.as_slice()
                };

                let (valid, remainder) = split_utf8(chunk);

                if !valid.is_empty() {
                    batch.push_str(&String::from_utf8_lossy(valid));
                }

                carry = remainder.to_vec();

                // Flush if enough time has elapsed or the batch is large
                if last_flush.elapsed() >= BATCH_FLUSH_INTERVAL || batch.len() >= 65536 {
                    flush_batch(&mut batch, id, app, &mut last_flush);
                }
            }
            Err(e) => {
                warn!(id = %id, error = %e, "PTY read error");
                break;
            }
        }
    }

    // Flush remaining batch + carry bytes
    if !carry.is_empty() {
        batch.push_str(&String::from_utf8_lossy(&carry));
    }
    flush_batch(&mut batch, id, app, &mut last_flush);

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
pub fn write_pty(id: String, data: String, state: State<'_, TerminalState>) -> Result<(), String> {
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
pub fn kill_pty(id: String, state: State<'_, TerminalState>) -> Result<(), String> {
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
