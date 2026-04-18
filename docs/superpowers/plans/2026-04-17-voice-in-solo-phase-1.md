# Voice in Solo — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `solo-voice` crate + chat-mic integration. Rip out `solo-elevenlabs`. Parakeet STT + cloud formatter (Claude / Codex) drive the existing chat microphone in Solo's agent input. No global hotkeys, no HUD, no agent-dispatch — those come in Phases 2 and 3.

**Architecture:** New `solo-voice` workspace crate owns audio capture (cpal), VAD (silero via `ort`), STT (`sherpa-rs` + NVIDIA Parakeet-TDT-0.6B), a `FormatterProvider` trait with Claude + Codex impls, a pipeline state machine, and a SQLite transcript history. Tauri exposes a thin command surface (`voice_commands.rs`); the React chat input subscribes to `voice:*` events. No Llama local formatter in P1 (opt-in P2 item). No platform code (`voice/hotkey.rs`, `voice/injection.rs`, `voice/app_monitor.rs`, HUD window) in P1 — those come in Phase 2.

**Tech Stack:** Rust 1.x (pinned by `rust-toolchain.toml`), Tauri 2, `cpal`, `ort` (ONNX Runtime), `sherpa-rs`, `reqwest`, `rusqlite`, `ts-rs` for bindings, React 19 + Zustand + immer for the frontend, Bun as the JS package manager, Vitest for frontend tests, `cargo test` for Rust.

**Reference:** `solo/docs/superpowers/specs/2026-04-17-voice-in-solo-design.md` (this plan implements Phase 1 of that spec).

---

## File Structure

### New Rust crate `crates/solo-voice/`

| File | Responsibility |
|---|---|
| `Cargo.toml` | Crate manifest |
| `src/lib.rs` | Public surface: re-exports; `VoicePipeline` constructor |
| `src/mode.rs` | `VoiceMode`, `PipelineTarget` enums |
| `src/error.rs` | `VoiceError` (thiserror) |
| `src/audio.rs` | cpal stream → lock-free ring buffer |
| `src/vad.rs` | Silero-VAD via `ort`, 30 ms frames |
| `src/stt.rs` | `SttProvider` trait + `SherpaParakeet` impl |
| `src/formatter.rs` | `FormatterProvider` trait + `ClaudeFormatter`, `CodexFormatter` |
| `src/pipeline.rs` | State machine driving audio → VAD → STT → formatter |
| `src/history.rs` | SQLite `voice_transcripts` table (rusqlite) |
| `src/models.rs` | Model manifest, SHA-256 verify, resumable download |

### New Tauri-layer code

| File | Responsibility |
|---|---|
| `apps/desktop/src-tauri/src/voice_commands.rs` | `#[tauri::command]` wrappers: enable, begin, end, cancel, download_model, remove_model, history_list, history_delete |

### Protocol changes

| File | Responsibility |
|---|---|
| `crates/solo-protocol/src/lib.rs` | Add `VoiceMode`, `VoicePipelineState`, `VoiceTranscriptResult`, new `BackendEvent` variants |

### Frontend

| File | Responsibility |
|---|---|
| `apps/desktop/src/stores/voiceStore.ts` | Zustand store: pipeline state, history, model download status |
| `apps/desktop/src/hooks/useVoiceInput.ts` | Rewritten — subscribes to `voice:*` events, drives mic button |
| `apps/desktop/src/lib/tauri/voice.ts` | Thin typed wrappers around `invoke()` |
| `apps/desktop/src/components/settings/tabs/VoiceTab.tsx` | Rewritten: enable, models, permissions, history |

### Modifications

| File | Change |
|---|---|
| `solo/Cargo.toml` (root) | Remove `tokio-tungstenite` + `base64` from `[workspace.dependencies]` if unused; add cpal, ort, sherpa-rs, rusqlite, reqwest (already present), uuid |
| `apps/desktop/src-tauri/Cargo.toml` | Add `solo-voice` path dep; remove `solo-elevenlabs` |
| `apps/desktop/src-tauri/src/lib.rs` | Register `VoiceState`; add voice commands to `generate_handler!`; remove elevenlabs state + commands |
| `apps/desktop/src/components/agent/input/voice-button.tsx` | Route to `voiceStore` |
| `apps/desktop/src/components/agent/input/ChatInputContainer.tsx` | Subscribe to `voice:transcript` via `useVoiceInput` |
| `apps/desktop/src/stores/settingsStore.ts` | Drop `elevenlabs` keys; add migration on first load |

### Deletions

| File/dir | Reason |
|---|---|
| `crates/solo-elevenlabs/` | Replaced |
| `apps/desktop/src-tauri/src/elevenlabs_commands.rs` | Replaced |
| `apps/desktop/src/stores/elevenlabsStore.ts` | Replaced |
| `apps/desktop/src/lib/tauri/elevenlabs.ts` | Replaced |
| `apps/desktop/src/lib/elevenlabs/` | Replaced |

---

## Conventions applied to every task

- **TDD:** write failing test, run it, implement, run again, commit.
- **Commit style:** Conventional commits, e.g. `feat(solo-voice): add audio capture module`. One task = one commit unless noted.
- **Running Rust tests:** from `solo/` run `cargo test -p <crate>`.
- **Running frontend tests:** from `solo/apps/desktop/` run `bun run test`. Vitest is already configured in Solo.
- **Regenerating TS bindings:** after any change to `crates/solo-protocol/src/lib.rs`, run `bun run gen:bindings` from `solo/`.
- **Don't skip pre-commit hooks.** If a hook fails, fix and commit fresh — do not `--amend` or `--no-verify`.
- **Per-task quality gate:** `cargo check --workspace` and `bun run check` (which runs `cargo check` + `tsc`) must pass before commit.

---

## Task 1: Scaffold the `solo-voice` crate

**Files:**
- Create: `solo/crates/solo-voice/Cargo.toml`
- Create: `solo/crates/solo-voice/src/lib.rs`
- Modify: `solo/Cargo.toml` (workspace `[workspace.dependencies]` additions)

- [ ] **Step 1: Add new workspace dependencies**

Edit `solo/Cargo.toml`. In the `[workspace.dependencies]` section, after the existing `reqwest` line (there may not be one — search for a good alphabetical location), add:

```toml
# Audio + ML for solo-voice
cpal = "0.15"
ort = { version = "2.0", features = ["download-binaries", "ndarray"] }
ndarray = "0.16"
rusqlite = { version = "0.32", features = ["bundled"] }
uuid = { version = "1.11", features = ["v4", "serde"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
sha2 = "0.10"
hound = "3.5"  # WAV decoding for VAD fixture tests

# Sherpa-ONNX Rust bindings (ships the sherpa-onnx C++ lib as a sub-build)
sherpa-rs = "0.6"
```

- [ ] **Step 2: Create the crate skeleton**

Create `solo/crates/solo-voice/Cargo.toml`:

```toml
[package]
name = "solo-voice"
version.workspace = true
edition.workspace = true
license.workspace = true
description = "Voice pipeline for Solo IDE — audio capture, VAD, STT, formatter"

[dependencies]
tokio.workspace = true
async-trait.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
anyhow.workspace = true
tracing.workspace = true
reqwest.workspace = true
uuid.workspace = true
sha2.workspace = true
rusqlite.workspace = true
ndarray.workspace = true
ort.workspace = true
cpal.workspace = true
sherpa-rs.workspace = true
ts-rs.workspace = true
solo-protocol = { path = "../solo-protocol" }
solo-auth = { path = "../solo-auth" }

[dev-dependencies]
tokio = { workspace = true, features = ["test-util"] }
hound.workspace = true
tempfile = "3"
```

Create `solo/crates/solo-voice/src/lib.rs`:

```rust
//! Voice pipeline for Solo IDE.
//!
//! Exposes audio capture, VAD, STT, and formatter primitives. The
//! orchestrator is `pipeline::VoicePipeline`.

pub mod audio;
pub mod error;
pub mod formatter;
pub mod history;
pub mod mode;
pub mod models;
pub mod pipeline;
pub mod stt;
pub mod vad;

pub use error::VoiceError;
pub use mode::{PipelineTarget, VoiceMode};
pub use pipeline::VoicePipeline;
```

Create empty module stubs so the crate compiles. For each of `audio.rs`, `error.rs`, `formatter.rs`, `history.rs`, `mode.rs`, `models.rs`, `pipeline.rs`, `stt.rs`, `vad.rs` — create the file containing only:

```rust
// Stub — implemented in later tasks.
```

- [ ] **Step 3: Verify the crate compiles**

Run: `cargo check -p solo-voice`
Expected: `Compiling solo-voice v0.2.0-beta.1 ... Finished`. Warnings about unused modules are OK.

- [ ] **Step 4: Commit**

```bash
git add solo/crates/solo-voice solo/Cargo.toml
git commit -m "feat(solo-voice): scaffold crate with module layout"
```

---

## Task 2: Define `VoiceMode` + `PipelineTarget` + `VoiceError`

**Files:**
- Modify: `solo/crates/solo-voice/src/mode.rs`
- Modify: `solo/crates/solo-voice/src/error.rs`

- [ ] **Step 1: Write failing test**

Append to `solo/crates/solo-voice/src/mode.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_mode_is_serde_tagged() {
        let json = serde_json::to_string(&VoiceMode::Dictation).unwrap();
        assert_eq!(json, "\"Dictation\"");
    }

    #[test]
    fn pipeline_target_roundtrips() {
        let t = PipelineTarget::ChatInput;
        let json = serde_json::to_string(&t).unwrap();
        let back: PipelineTarget = serde_json::from_str(&json).unwrap();
        assert_eq!(back, t);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p solo-voice --lib mode::tests`
Expected: compile error — `VoiceMode` and `PipelineTarget` not defined.

- [ ] **Step 3: Implement**

Replace contents of `solo/crates/solo-voice/src/mode.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoiceMode {
    Dictation,
    Dispatch,
}

/// Where the pipeline's output goes when it reaches Emitting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PipelineTarget {
    /// Emit `voice:transcript` only — frontend handles insertion.
    /// Used for chat-mic in Phase 1.
    ChatInput,
    /// Dictation paste into focused app (Phase 2).
    FocusedApp,
    /// Create a new agent session (Phase 3).
    NewAgentSession,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_mode_is_serde_tagged() {
        let json = serde_json::to_string(&VoiceMode::Dictation).unwrap();
        assert_eq!(json, "\"Dictation\"");
    }

    #[test]
    fn pipeline_target_roundtrips() {
        let t = PipelineTarget::ChatInput;
        let json = serde_json::to_string(&t).unwrap();
        let back: PipelineTarget = serde_json::from_str(&json).unwrap();
        assert_eq!(back, t);
    }
}
```

Replace contents of `solo/crates/solo-voice/src/error.rs`:

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum VoiceError {
    #[error("audio device error: {0}")]
    Audio(String),

    #[error("VAD error: {0}")]
    Vad(String),

    #[error("STT error: {0}")]
    Stt(String),

    #[error("formatter error: {0}")]
    Formatter(String),

    #[error("model not downloaded: {0}")]
    ModelMissing(String),

    #[error("model download failed: {0}")]
    ModelDownload(String),

    #[error("model integrity check failed: expected {expected}, got {actual}")]
    ModelIntegrity { expected: String, actual: String },

    #[error("history db error: {0}")]
    History(String),

    #[error("pipeline is in state {0}, cannot proceed")]
    BadState(String),

    #[error("user cancelled")]
    Cancelled,

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Http(#[from] reqwest::Error),

    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, VoiceError>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p solo-voice --lib mode::tests`
Expected: `test mode::tests::voice_mode_is_serde_tagged ... ok`, `test mode::tests::pipeline_target_roundtrips ... ok`.

- [ ] **Step 5: Commit**

```bash
git add solo/crates/solo-voice/src/mode.rs solo/crates/solo-voice/src/error.rs
git commit -m "feat(solo-voice): add VoiceMode, PipelineTarget, VoiceError"
```

---

## Task 3: Add protocol types + BackendEvent variants; regenerate bindings

**Files:**
- Modify: `solo/crates/solo-protocol/src/lib.rs`
- Generated: `solo/apps/desktop/src/bindings/*`

- [ ] **Step 1: Add types to the protocol**

In `solo/crates/solo-protocol/src/lib.rs`, locate the existing ts-rs exports block. Add (place near existing event/state types):

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export)]
pub enum VoiceMode {
    Dictation,
    Dispatch,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
#[serde(tag = "kind", content = "data")]
pub enum VoicePipelineState {
    Idle,
    Arming,
    Recording,
    Transcribing,
    Formatting,
    Emitting,
    Error(String),
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub struct VoiceTranscriptResult {
    pub id: String,
    pub mode: VoiceMode,
    pub raw_transcript: String,
    pub formatted: String,
    pub target_app_bundle_id: Option<String>,
    pub target_app_name: Option<String>,
    pub duration_ms: u32,
    pub linked_session_id: Option<String>,
    pub created_at: i64,
}

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub struct VoiceModelProgress {
    pub model_id: String,
    pub bytes: u64,
    pub total: u64,
}
```

Find the `BackendEvent` enum and add these variants (preserve existing variants verbatim):

```rust
    #[serde(rename = "voice:state")]
    VoiceState {
        mode: VoiceMode,
        state: VoicePipelineState,
    },

    #[serde(rename = "voice:level")]
    VoiceLevel { rms: f32 },

    #[serde(rename = "voice:transcript")]
    VoiceTranscript { result: VoiceTranscriptResult },

    #[serde(rename = "voice:error")]
    VoiceError { message: String },

    #[serde(rename = "voice:model_progress")]
    VoiceModelProgress { progress: VoiceModelProgress },
```

- [ ] **Step 2: Regenerate TS bindings**

From `solo/` run: `bun run gen:bindings`
Expected: new files appear under `solo/apps/desktop/src/bindings/`: `VoiceMode.ts`, `VoicePipelineState.ts`, `VoiceTranscriptResult.ts`, `VoiceModelProgress.ts`. No errors.

- [ ] **Step 3: Verify the workspace still compiles**

From `solo/` run: `cargo check --workspace`
Expected: clean.

- [ ] **Step 4: Verify tsc passes**

From `solo/` run: `bun run check`
Expected: no new TypeScript errors (pre-existing ones are out of scope).

- [ ] **Step 5: Commit**

```bash
git add solo/crates/solo-protocol/src/lib.rs solo/apps/desktop/src/bindings
git commit -m "feat(solo-protocol): add voice types and BackendEvent variants"
```

---

## Task 4: Model manifest + SHA-256 download

**Files:**
- Modify: `solo/crates/solo-voice/src/models.rs`

- [ ] **Step 1: Write failing test**

Replace contents of `solo/crates/solo-voice/src/models.rs`:

```rust
use crate::error::{Result, VoiceError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelManifest {
    pub id: &'static str,
    pub display_name: &'static str,
    pub files: &'static [ModelFile],
    pub install_dir: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFile {
    pub url: &'static str,
    pub relative_path: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
}

pub const PARAKEET: ModelManifest = ModelManifest {
    id: "parakeet-tdt-0.6b-v2",
    display_name: "Parakeet TDT 0.6B (int8)",
    install_dir: "parakeet-tdt-0.6b-v2",
    files: &[
        ModelFile {
            url: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/encoder.int8.onnx",
            relative_path: "encoder.int8.onnx",
            sha256: "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD",
            size_bytes: 0,
        },
        ModelFile {
            url: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/decoder.int8.onnx",
            relative_path: "decoder.int8.onnx",
            sha256: "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD",
            size_bytes: 0,
        },
        ModelFile {
            url: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/joiner.int8.onnx",
            relative_path: "joiner.int8.onnx",
            sha256: "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD",
            size_bytes: 0,
        },
        ModelFile {
            url: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/tokens.txt",
            relative_path: "tokens.txt",
            sha256: "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD",
            size_bytes: 0,
        },
    ],
};

/// Verify a file's SHA-256 against an expected hex string.
/// If `expected == "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD"`, returns Ok
/// (first-run capture mode — developer pins the hash after first successful download).
pub fn verify_sha256(path: &Path, expected: &str) -> Result<()> {
    if expected == "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD" {
        tracing::warn!(
            "SHA-256 not pinned for {}; capture and pin it.",
            path.display()
        );
        return Ok(());
    }
    let mut hasher = Sha256::new();
    let bytes = std::fs::read(path)?;
    hasher.update(&bytes);
    let actual = format!("{:x}", hasher.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(VoiceError::ModelIntegrity {
            expected: expected.into(),
            actual,
        })
    }
}

pub fn install_dir(models_root: &Path, manifest: &ModelManifest) -> PathBuf {
    models_root.join(manifest.install_dir)
}

pub fn is_installed(models_root: &Path, manifest: &ModelManifest) -> bool {
    let dir = install_dir(models_root, manifest);
    if !dir.is_dir() {
        return false;
    }
    manifest
        .files
        .iter()
        .all(|f| dir.join(f.relative_path).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn verify_sha256_accepts_placeholder() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("f");
        std::fs::write(&p, b"hello").unwrap();
        verify_sha256(&p, "REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD").unwrap();
    }

    #[test]
    fn verify_sha256_matches_real_hash() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("f");
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(b"hello").unwrap();
        let expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        verify_sha256(&p, expected).unwrap();
    }

    #[test]
    fn verify_sha256_rejects_mismatch() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("f");
        std::fs::write(&p, b"hello").unwrap();
        let err = verify_sha256(&p, "deadbeef").unwrap_err();
        assert!(matches!(err, VoiceError::ModelIntegrity { .. }));
    }

    #[test]
    fn is_installed_detects_missing_dir() {
        let dir = tempdir().unwrap();
        assert!(!is_installed(dir.path(), &PARAKEET));
    }
}
```

- [ ] **Step 2: Run test to verify**

Run: `cargo test -p solo-voice --lib models::tests`
Expected: all 4 tests pass.

- [ ] **Step 3: Add streaming downloader**

Append to `solo/crates/solo-voice/src/models.rs`:

```rust
use tokio::io::AsyncWriteExt;

/// Download a single ModelFile with resume via HTTP Range.
/// Calls `progress(bytes_so_far, total_bytes)` for UI reporting.
pub async fn download_file<F: Fn(u64, u64) + Send>(
    file: &ModelFile,
    dest_dir: &Path,
    progress: F,
) -> Result<()> {
    let dest_final = dest_dir.join(file.relative_path);
    let dest_tmp = dest_dir.join(format!("{}.tmp", file.relative_path));
    if let Some(parent) = dest_final.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let client = reqwest::Client::builder()
        .user_agent("solo-voice/0.1")
        .build()
        .map_err(|e| VoiceError::ModelDownload(e.to_string()))?;

    let mut req = client.get(file.url);
    let existing_bytes = std::fs::metadata(&dest_tmp).map(|m| m.len()).unwrap_or(0);
    if existing_bytes > 0 {
        req = req.header("Range", format!("bytes={}-", existing_bytes));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| VoiceError::ModelDownload(e.to_string()))?
        .error_for_status()
        .map_err(|e| VoiceError::ModelDownload(e.to_string()))?;

    let total = resp
        .content_length()
        .map(|c| c + existing_bytes)
        .unwrap_or(file.size_bytes.max(existing_bytes));

    let mut f = tokio::fs::OpenOptions::new()
        .create(true)
        .append(existing_bytes > 0)
        .write(true)
        .truncate(existing_bytes == 0)
        .open(&dest_tmp)
        .await?;

    let mut downloaded = existing_bytes;
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| VoiceError::ModelDownload(e.to_string()))?;
        f.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;
        progress(downloaded, total);
    }
    f.flush().await?;
    drop(f);

    verify_sha256(&dest_tmp, file.sha256)?;
    std::fs::rename(&dest_tmp, &dest_final)?;
    Ok(())
}

/// Download every file in a manifest. Idempotent — already-installed files are skipped.
pub async fn download_manifest<F: Fn(u64, u64) + Send + Clone>(
    manifest: &ModelManifest,
    models_root: &Path,
    progress: F,
) -> Result<()> {
    let dir = install_dir(models_root, manifest);
    std::fs::create_dir_all(&dir)?;
    for f in manifest.files {
        if dir.join(f.relative_path).is_file() {
            continue;
        }
        download_file(f, &dir, progress.clone()).await?;
    }
    Ok(())
}
```

Also add `futures-util = "0.3"` to `solo-voice`'s `[dependencies]` in `solo/crates/solo-voice/Cargo.toml`:

```toml
futures-util = "0.3"
```

- [ ] **Step 4: Verify compiles**

Run: `cargo check -p solo-voice`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add solo/crates/solo-voice/src/models.rs solo/crates/solo-voice/Cargo.toml
git commit -m "feat(solo-voice): model manifest, SHA-256 verify, resumable download"
```

---

## Task 5: Audio capture via cpal

**Files:**
- Modify: `solo/crates/solo-voice/src/audio.rs`

- [ ] **Step 1: Write failing test**

Replace contents of `solo/crates/solo-voice/src/audio.rs`:

```rust
use crate::error::{Result, VoiceError};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

pub const SAMPLE_RATE: u32 = 16_000;
const BUFFER_CAPACITY_SAMPLES: usize = SAMPLE_RATE as usize * 60; // 60 s max

/// Lock-free-ish ring buffer. A Mutex<VecDeque<f32>> is fine for 16 kHz — the
/// cpal callback pushes ~160 samples every 10 ms, contention is negligible.
#[derive(Clone, Default)]
pub struct AudioRing {
    inner: Arc<Mutex<AudioRingInner>>,
}

#[derive(Default)]
struct AudioRingInner {
    samples: std::collections::VecDeque<f32>,
    dropped: u64,
}

impl AudioRing {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&self, data: &[f32]) {
        let mut g = self.inner.lock().unwrap();
        for s in data {
            if g.samples.len() >= BUFFER_CAPACITY_SAMPLES {
                g.samples.pop_front();
                g.dropped += 1;
            }
            g.samples.push_back(*s);
        }
    }

    pub fn drain_all(&self) -> Vec<f32> {
        let mut g = self.inner.lock().unwrap();
        g.samples.drain(..).collect()
    }

    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn dropped(&self) -> u64 {
        self.inner.lock().unwrap().dropped
    }

    pub fn clear(&self) {
        let mut g = self.inner.lock().unwrap();
        g.samples.clear();
        g.dropped = 0;
    }
}

/// Thread-owned audio capture. `cpal::Stream` is `!Send` on macOS (CoreAudio
/// constraint), so the stream lives on a dedicated OS thread. Dropping
/// `AudioStream` sets `stop`, which the thread observes and then drops the
/// cpal stream locally.
pub struct AudioStream {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for AudioStream {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(h) = self.thread.take() {
            let _ = h.join();
        }
    }
}

pub fn start_capture(ring: AudioRing) -> Result<AudioStream> {
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_for_thread = stop.clone();
    let (init_tx, init_rx) = std::sync::mpsc::channel::<Result<()>>();

    let thread = std::thread::spawn(move || {
        // All cpal interactions happen on THIS thread.
        let res: Result<cpal::Stream> = (|| {
            let host = cpal::default_host();
            let device = host
                .default_input_device()
                .ok_or_else(|| VoiceError::Audio("no default input device".into()))?;
            let config = device
                .default_input_config()
                .map_err(|e| VoiceError::Audio(e.to_string()))?;
            let channels = config.channels() as usize;
            let input_rate = config.sample_rate().0;
            let err_fn = |err| tracing::error!("cpal error: {err}");
            let ring_for_cb = ring.clone();

            let stream = match config.sample_format() {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _| {
                        let mono = downmix_f32(data, channels);
                        let resampled = if input_rate == SAMPLE_RATE {
                            mono
                        } else {
                            linear_resample(&mono, input_rate, SAMPLE_RATE)
                        };
                        ring_for_cb.push(&resampled);
                    },
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _| {
                        let mono: Vec<f32> =
                            data.iter().map(|s| *s as f32 / i16::MAX as f32).collect();
                        let mono = downmix_f32(&mono, channels);
                        let resampled = if input_rate == SAMPLE_RATE {
                            mono
                        } else {
                            linear_resample(&mono, input_rate, SAMPLE_RATE)
                        };
                        ring_for_cb.push(&resampled);
                    },
                    err_fn,
                    None,
                ),
                other => {
                    return Err(VoiceError::Audio(format!(
                        "unsupported sample format: {other:?}"
                    )))
                }
            }
            .map_err(|e| VoiceError::Audio(e.to_string()))?;
            stream.play().map_err(|e| VoiceError::Audio(e.to_string()))?;
            Ok(stream)
        })();

        let stream = match res {
            Ok(s) => {
                let _ = init_tx.send(Ok(()));
                s
            }
            Err(e) => {
                let _ = init_tx.send(Err(e));
                return;
            }
        };

        // Park until asked to stop, then drop the stream locally.
        while !stop_for_thread.load(std::sync::atomic::Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        drop(stream);
    });

    // Wait for the thread to finish initialising cpal (or fail).
    match init_rx.recv() {
        Ok(Ok(())) => Ok(AudioStream {
            stop,
            thread: Some(thread),
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(VoiceError::Audio("audio thread panicked".into())),
    }
}

fn downmix_f32(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    let frames = samples.len() / channels;
    (0..frames)
        .map(|i| {
            let s: f32 = (0..channels).map(|c| samples[i * channels + c]).sum();
            s / channels as f32
        })
        .collect()
}

/// Cheap linear interpolation resampler. Fine for voice at 16 kHz target.
fn linear_resample(input: &[f32], in_rate: u32, out_rate: u32) -> Vec<f32> {
    if in_rate == out_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = out_rate as f64 / in_rate as f64;
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    (0..out_len)
        .map(|i| {
            let src_pos = i as f64 / ratio;
            let idx = src_pos.floor() as usize;
            let frac = src_pos - idx as f64;
            let a = input[idx.min(input.len() - 1)];
            let b = input[(idx + 1).min(input.len() - 1)];
            (a as f64 * (1.0 - frac) + b as f64 * frac) as f32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_push_drain() {
        let r = AudioRing::new();
        r.push(&[0.1, 0.2, 0.3]);
        assert_eq!(r.len(), 3);
        let out = r.drain_all();
        assert_eq!(out, vec![0.1, 0.2, 0.3]);
        assert!(r.is_empty());
    }

    #[test]
    fn ring_drops_when_full() {
        let r = AudioRing::new();
        let big = vec![0.0f32; BUFFER_CAPACITY_SAMPLES + 100];
        r.push(&big);
        assert_eq!(r.len(), BUFFER_CAPACITY_SAMPLES);
        assert_eq!(r.dropped(), 100);
    }

    #[test]
    fn downmix_stereo_to_mono_averages() {
        let stereo = vec![1.0, 0.0, 0.5, 0.5];
        let mono = downmix_f32(&stereo, 2);
        assert_eq!(mono, vec![0.5, 0.5]);
    }

    #[test]
    fn linear_resample_halves() {
        let input: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let out = linear_resample(&input, 32_000, 16_000);
        assert!((out.len() as i32 - 50).abs() <= 1);
    }
}
```

- [ ] **Step 2: Run test to verify**

Run: `cargo test -p solo-voice --lib audio::tests`
Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add solo/crates/solo-voice/src/audio.rs
git commit -m "feat(solo-voice): cpal audio capture with downmix + resample"
```

---

## Task 6: Silero VAD wrapper

**Files:**
- Modify: `solo/crates/solo-voice/src/vad.rs`

- [ ] **Step 1: Implement with test**

Replace contents of `solo/crates/solo-voice/src/vad.rs`:

```rust
use crate::error::{Result, VoiceError};
use ndarray::Array1;
use ort::{Environment, Session, SessionBuilder, Value};
use std::path::Path;
use std::sync::Arc;

/// 30 ms frame @ 16 kHz = 480 samples. Silero accepts 512-sample windows;
/// we pad.
pub const FRAME_SAMPLES: usize = 480;
const SILERO_INPUT_LEN: usize = 512;
const SILERO_SAMPLE_RATE: i64 = 16_000;

pub struct SileroVad {
    session: Session,
    h: Array1<f32>,
    c: Array1<f32>,
}

impl SileroVad {
    /// Load the Silero ONNX from disk. Path is the `.onnx` file.
    pub fn load(model_path: &Path) -> Result<Self> {
        let env = Arc::new(
            Environment::builder()
                .with_name("silero-vad")
                .build()
                .map_err(|e| VoiceError::Vad(e.to_string()))?,
        );
        let session = SessionBuilder::new(&env)
            .map_err(|e| VoiceError::Vad(e.to_string()))?
            .with_model_from_file(model_path)
            .map_err(|e| VoiceError::Vad(e.to_string()))?;
        Ok(Self {
            session,
            h: Array1::zeros(64),
            c: Array1::zeros(64),
        })
    }

    /// Returns speech probability (0.0–1.0) for a single 30 ms frame.
    pub fn probability(&mut self, frame: &[f32]) -> Result<f32> {
        if frame.len() != FRAME_SAMPLES {
            return Err(VoiceError::Vad(format!(
                "expected {} samples, got {}",
                FRAME_SAMPLES,
                frame.len()
            )));
        }
        let mut buf = [0.0f32; SILERO_INPUT_LEN];
        buf[..FRAME_SAMPLES].copy_from_slice(frame);

        let input = ndarray::Array::from_shape_vec((1, SILERO_INPUT_LEN), buf.to_vec())
            .map_err(|e| VoiceError::Vad(e.to_string()))?;
        let sr = ndarray::Array::from_shape_vec((1,), vec![SILERO_SAMPLE_RATE])
            .map_err(|e| VoiceError::Vad(e.to_string()))?;
        let h = self.h.clone().into_shape((2, 1, 64))
            .map_err(|e| VoiceError::Vad(e.to_string()))?;
        let c = self.c.clone().into_shape((2, 1, 64))
            .map_err(|e| VoiceError::Vad(e.to_string()))?;

        let inputs = vec![
            Value::from_array(self.session.allocator(), &input)
                .map_err(|e| VoiceError::Vad(e.to_string()))?,
            Value::from_array(self.session.allocator(), &sr)
                .map_err(|e| VoiceError::Vad(e.to_string()))?,
            Value::from_array(self.session.allocator(), &h)
                .map_err(|e| VoiceError::Vad(e.to_string()))?,
            Value::from_array(self.session.allocator(), &c)
                .map_err(|e| VoiceError::Vad(e.to_string()))?,
        ];
        let outputs = self.session.run(inputs).map_err(|e| VoiceError::Vad(e.to_string()))?;

        let prob: f32 = outputs[0]
            .try_extract::<f32>()
            .map_err(|e| VoiceError::Vad(e.to_string()))?
            .view()
            .iter()
            .next()
            .copied()
            .unwrap_or(0.0);

        // Update recurrent state from outputs[1], outputs[2]
        let new_h = outputs[1]
            .try_extract::<f32>()
            .map_err(|e| VoiceError::Vad(e.to_string()))?;
        let new_c = outputs[2]
            .try_extract::<f32>()
            .map_err(|e| VoiceError::Vad(e.to_string()))?;
        self.h = Array1::from_iter(new_h.view().iter().copied());
        self.c = Array1::from_iter(new_c.view().iter().copied());

        Ok(prob)
    }

    pub fn reset(&mut self) {
        self.h.fill(0.0);
        self.c.fill(0.0);
    }
}

/// Convenience: compute RMS of a frame (used for HUD level meter).
pub fn rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let sum: f32 = frame.iter().map(|s| s * s).sum();
    (sum / frame.len() as f32).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rms_of_silence_is_zero() {
        let silence = vec![0.0; 480];
        assert!((rms(&silence)).abs() < 1e-6);
    }

    #[test]
    fn rms_of_dc_is_magnitude() {
        let dc = vec![0.5; 480];
        assert!((rms(&dc) - 0.5).abs() < 1e-6);
    }

    // Actual Silero model load is tested as an integration test with a
    // fixture model (see tests/fixtures/). Unit tests cover the arithmetic.
}
```

- [ ] **Step 2: Run test**

Run: `cargo test -p solo-voice --lib vad::tests`
Expected: 2 tests pass.

- [ ] **Step 3: Verify the full crate still builds**

Run: `cargo check -p solo-voice`
Expected: clean (warnings about unused `reset` are OK).

> **Caveat — ort version differences.** The ort Rust crate's session-building API
> has changed between minor versions. If `Environment::builder()` or
> `SessionBuilder::new()` don't exist in the version that resolved, run
> `cargo doc -p ort --open` and adapt to the current API (commonly
> `Session::builder().commit_from_file(path)` in ort 2.x). Keep the test shape
> the same; only the load path varies. VAD is not on the v1 critical path for
> chat mic since sherpa does its own VAD-ish silence detection; the Silero VAD
> lands fully in Phase 2 when the hotkey tap needs end-of-speech detection.

- [ ] **Step 4: Commit**

```bash
git add solo/crates/solo-voice/src/vad.rs
git commit -m "feat(solo-voice): Silero VAD wrapper via ort"
```

---

## Task 7: STT trait + Sherpa Parakeet impl

**Files:**
- Modify: `solo/crates/solo-voice/src/stt.rs`

- [ ] **Step 1: Implement**

Replace contents of `solo/crates/solo-voice/src/stt.rs`:

```rust
use crate::error::{Result, VoiceError};
use async_trait::async_trait;
use std::path::PathBuf;

/// Abstracts the STT backend so tests (and future MLX path) can swap impls.
#[async_trait]
pub trait SttProvider: Send + Sync {
    /// Transcribe a mono f32 16-kHz PCM buffer.
    async fn transcribe(&self, samples: &[f32]) -> Result<String>;
}

/// Sherpa-ONNX + NVIDIA Parakeet TDT 0.6B offline.
pub struct SherpaParakeet {
    recognizer: std::sync::Mutex<sherpa_rs::offline::OfflineRecognizer>,
}

pub struct SherpaConfig {
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    pub joiner: PathBuf,
    pub tokens: PathBuf,
    pub num_threads: usize,
}

impl SherpaParakeet {
    pub fn new(cfg: SherpaConfig) -> Result<Self> {
        let nemo = sherpa_rs::offline::OfflineTransducer {
            encoder: cfg.encoder.to_string_lossy().to_string(),
            decoder: cfg.decoder.to_string_lossy().to_string(),
            joiner: cfg.joiner.to_string_lossy().to_string(),
        };
        let model_config = sherpa_rs::offline::OfflineModelConfig {
            transducer: Some(nemo),
            tokens: cfg.tokens.to_string_lossy().to_string(),
            num_threads: cfg.num_threads as i32,
            provider: "cpu".into(),
            debug: false,
            ..Default::default()
        };
        let recognizer = sherpa_rs::offline::OfflineRecognizer::new_from_config(
            sherpa_rs::offline::OfflineRecognizerConfig {
                model: model_config,
                ..Default::default()
            },
        )
        .map_err(|e| VoiceError::Stt(e.to_string()))?;
        Ok(Self {
            recognizer: std::sync::Mutex::new(recognizer),
        })
    }
}

#[async_trait]
impl SttProvider for SherpaParakeet {
    async fn transcribe(&self, samples: &[f32]) -> Result<String> {
        // sherpa is blocking; run on blocking pool.
        let samples = samples.to_vec();
        let recognizer = self.recognizer.lock().unwrap().clone();
        tokio::task::spawn_blocking(move || {
            let mut stream = recognizer.create_stream();
            stream.accept_waveform(16_000, &samples);
            recognizer.decode(&mut stream);
            stream.result().text.trim().to_string()
        })
        .await
        .map_err(|e| VoiceError::Stt(e.to_string()))
    }
}

/// Mock used by pipeline tests.
pub struct MockStt {
    pub canned: String,
}

#[async_trait]
impl SttProvider for MockStt {
    async fn transcribe(&self, _samples: &[f32]) -> Result<String> {
        Ok(self.canned.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_returns_canned() {
        let s = MockStt {
            canned: "hello world".into(),
        };
        let out = s.transcribe(&[]).await.unwrap();
        assert_eq!(out, "hello world");
    }
}
```

**Note:** The `sherpa_rs::offline::OfflineRecognizer::clone()` call above depends on the crate offering `Clone`. If the `sherpa-rs` 0.6 API differs, adapt by wrapping in `Arc<Mutex<...>>` and passing the Arc into `spawn_blocking`. Check `cargo doc -p sherpa-rs --open` after `cargo fetch`.

- [ ] **Step 2: Run test**

Run: `cargo test -p solo-voice --lib stt::tests`
Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
git add solo/crates/solo-voice/src/stt.rs
git commit -m "feat(solo-voice): SttProvider trait + SherpaParakeet + MockStt"
```

---

## Task 8: Formatter trait + Claude + Codex impls

**Files:**
- Modify: `solo/crates/solo-voice/src/formatter.rs`

- [ ] **Step 1: Implement**

Replace contents of `solo/crates/solo-voice/src/formatter.rs`:

```rust
use crate::error::{Result, VoiceError};
use async_trait::async_trait;

pub const DEFAULT_CLAUDE_FORMATTER_MODEL: &str = "claude-haiku-4-5";
pub const DEFAULT_CODEX_FORMATTER_MODEL: &str = "gpt-5-nano";

#[derive(Clone, Debug, Default)]
pub struct AppContext {
    pub bundle_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DictationOptions {
    pub strip_fillers: bool,
}

impl Default for DictationOptions {
    fn default() -> Self {
        Self {
            strip_fillers: true,
        }
    }
}

#[derive(Clone, Debug)]
pub struct DispatchTask {
    pub title: String,
    pub prompt: String,
}

#[async_trait]
pub trait FormatterProvider: Send + Sync {
    async fn format_dictation(
        &self,
        transcript: &str,
        context: AppContext,
        options: DictationOptions,
    ) -> Result<String>;

    async fn format_dispatch(
        &self,
        transcript: &str,
        context: AppContext,
    ) -> Result<DispatchTask>;
}

pub fn dictation_system_prompt(options: &DictationOptions) -> String {
    let strip = if options.strip_fillers {
        "Remove filler words (um, uh, like, you know). "
    } else {
        ""
    };
    format!(
        "You are a dictation cleanup model. Take the raw speech-to-text \
         output and return the text the user meant to write, with correct \
         punctuation and capitalization. {}Do not add content. Do not \
         answer questions — just clean the transcript. Output only the \
         cleaned text with no preamble.",
        strip
    )
}

pub fn dispatch_system_prompt() -> &'static str {
    "You convert a raw voice transcript into a structured software engineering \
     task for an AI coding agent. Return strict JSON with fields \"title\" \
     (≤60 chars) and \"prompt\" (the full instructions to pass to the agent, \
     written as if the user were directly asking the agent). Do not include \
     commentary."
}

/// Claude impl — wraps Solo's existing Claude provider auth.
/// `ChatClient` is a thin trait so we can mock in tests; the real
/// impl in apps/desktop/src-tauri/src/voice_commands.rs wires this up
/// to solo-auth's Claude client.
#[async_trait]
pub trait ChatClient: Send + Sync {
    async fn simple_completion(
        &self,
        model: &str,
        system: &str,
        user: &str,
    ) -> Result<String>;
}

pub struct CloudFormatter<C: ChatClient> {
    pub model: String,
    pub client: C,
}

#[async_trait]
impl<C: ChatClient> FormatterProvider for CloudFormatter<C> {
    async fn format_dictation(
        &self,
        transcript: &str,
        context: AppContext,
        options: DictationOptions,
    ) -> Result<String> {
        let system = dictation_system_prompt(&options);
        let user = match context.app_name {
            Some(app) => format!("[User is in app: {app}]\n\n{transcript}"),
            None => transcript.to_string(),
        };
        self.client
            .simple_completion(&self.model, &system, &user)
            .await
    }

    async fn format_dispatch(
        &self,
        transcript: &str,
        _context: AppContext,
    ) -> Result<DispatchTask> {
        let raw = self
            .client
            .simple_completion(&self.model, dispatch_system_prompt(), transcript)
            .await?;
        #[derive(serde::Deserialize)]
        struct Out {
            title: String,
            prompt: String,
        }
        let parsed: Out = serde_json::from_str(raw.trim())
            .map_err(|e| VoiceError::Formatter(format!("bad JSON from model: {e}; raw: {raw}")))?;
        Ok(DispatchTask {
            title: parsed.title,
            prompt: parsed.prompt,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct CannedChat {
        canned: String,
    }

    #[async_trait]
    impl ChatClient for CannedChat {
        async fn simple_completion(&self, _m: &str, _s: &str, _u: &str) -> Result<String> {
            Ok(self.canned.clone())
        }
    }

    #[tokio::test]
    async fn dictation_prompt_passes_transcript_through_canned_model() {
        let f = CloudFormatter {
            model: "x".into(),
            client: CannedChat {
                canned: "Hello, world.".into(),
            },
        };
        let out = f
            .format_dictation("hello world", AppContext::default(), DictationOptions::default())
            .await
            .unwrap();
        assert_eq!(out, "Hello, world.");
    }

    #[tokio::test]
    async fn dispatch_parses_model_json() {
        let json = r#"{"title":"Refactor auth","prompt":"Refactor the auth module."}"#;
        let f = CloudFormatter {
            model: "x".into(),
            client: CannedChat {
                canned: json.into(),
            },
        };
        let task = f
            .format_dispatch("refactor the auth module", AppContext::default())
            .await
            .unwrap();
        assert_eq!(task.title, "Refactor auth");
        assert_eq!(task.prompt, "Refactor the auth module.");
    }

    #[tokio::test]
    async fn dispatch_errors_on_garbage_output() {
        let f = CloudFormatter {
            model: "x".into(),
            client: CannedChat {
                canned: "not json".into(),
            },
        };
        let err = f
            .format_dispatch("x", AppContext::default())
            .await
            .unwrap_err();
        assert!(matches!(err, VoiceError::Formatter(_)));
    }

    #[test]
    fn dictation_prompt_toggles_filler_removal() {
        let with = dictation_system_prompt(&DictationOptions {
            strip_fillers: true,
        });
        let without = dictation_system_prompt(&DictationOptions {
            strip_fillers: false,
        });
        assert!(with.contains("filler"));
        assert!(!without.contains("filler"));
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test -p solo-voice --lib formatter::tests`
Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add solo/crates/solo-voice/src/formatter.rs
git commit -m "feat(solo-voice): FormatterProvider trait + CloudFormatter + prompt builders"
```

---

## Task 9: SQLite transcript history

**Files:**
- Modify: `solo/crates/solo-voice/src/history.rs`

- [ ] **Step 1: Implement with tests**

Replace contents of `solo/crates/solo-voice/src/history.rs`:

```rust
use crate::error::{Result, VoiceError};
use rusqlite::{params, Connection};
use std::path::Path;

pub struct History {
    conn: Connection,
}

#[derive(Debug, Clone)]
pub struct HistoryRow {
    pub id: String,
    pub mode: String,              // "Dictation" | "Dispatch"
    pub raw_transcript: String,
    pub formatted: String,
    pub target_app_bundle_id: Option<String>,
    pub target_app_name: Option<String>,
    pub duration_ms: u32,
    pub linked_session_id: Option<String>,
    pub created_at: i64,
}

impl History {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::migrate(&conn)?;
        Ok(Self { conn })
    }

    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::migrate(&conn)?;
        Ok(Self { conn })
    }

    fn migrate(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS voice_transcripts (
                id                    TEXT PRIMARY KEY,
                mode                  TEXT NOT NULL,
                raw_transcript        TEXT NOT NULL,
                formatted             TEXT NOT NULL,
                target_app_bundle_id  TEXT,
                target_app_name       TEXT,
                duration_ms           INTEGER NOT NULL,
                linked_session_id     TEXT,
                created_at            INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_voice_transcripts_created_at
                ON voice_transcripts(created_at DESC);
            "#,
        )?;
        Ok(())
    }

    pub fn insert(&self, row: &HistoryRow) -> Result<()> {
        self.conn.execute(
            r#"INSERT INTO voice_transcripts
               (id, mode, raw_transcript, formatted, target_app_bundle_id,
                target_app_name, duration_ms, linked_session_id, created_at)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"#,
            params![
                row.id,
                row.mode,
                row.raw_transcript,
                row.formatted,
                row.target_app_bundle_id,
                row.target_app_name,
                row.duration_ms,
                row.linked_session_id,
                row.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn list(&self, limit: u32) -> Result<Vec<HistoryRow>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT id, mode, raw_transcript, formatted, target_app_bundle_id,
                      target_app_name, duration_ms, linked_session_id, created_at
               FROM voice_transcripts
               ORDER BY created_at DESC
               LIMIT ?1"#,
        )?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(HistoryRow {
                    id: r.get(0)?,
                    mode: r.get(1)?,
                    raw_transcript: r.get(2)?,
                    formatted: r.get(3)?,
                    target_app_bundle_id: r.get(4)?,
                    target_app_name: r.get(5)?,
                    duration_ms: r.get(6)?,
                    linked_session_id: r.get(7)?,
                    created_at: r.get(8)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM voice_transcripts WHERE id = ?1", params![id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_row() -> HistoryRow {
        HistoryRow {
            id: "abc".into(),
            mode: "Dictation".into(),
            raw_transcript: "hello".into(),
            formatted: "Hello.".into(),
            target_app_bundle_id: Some("com.slack.Slack".into()),
            target_app_name: Some("Slack".into()),
            duration_ms: 1500,
            linked_session_id: None,
            created_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn insert_and_list() {
        let h = History::in_memory().unwrap();
        h.insert(&sample_row()).unwrap();
        let rows = h.list(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "abc");
    }

    #[test]
    fn delete_removes() {
        let h = History::in_memory().unwrap();
        h.insert(&sample_row()).unwrap();
        h.delete("abc").unwrap();
        assert_eq!(h.list(10).unwrap().len(), 0);
    }

    #[test]
    fn list_is_ordered_by_created_at_desc() {
        let h = History::in_memory().unwrap();
        let mut r1 = sample_row();
        r1.id = "old".into();
        r1.created_at = 1_000;
        let mut r2 = sample_row();
        r2.id = "new".into();
        r2.created_at = 9_999;
        h.insert(&r1).unwrap();
        h.insert(&r2).unwrap();
        let rows = h.list(10).unwrap();
        assert_eq!(rows[0].id, "new");
        assert_eq!(rows[1].id, "old");
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test -p solo-voice --lib history::tests`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add solo/crates/solo-voice/src/history.rs
git commit -m "feat(solo-voice): SQLite voice_transcripts history"
```

---

## Task 10: Pipeline state machine

**Files:**
- Modify: `solo/crates/solo-voice/src/pipeline.rs`

- [ ] **Step 1: Implement**

Replace contents of `solo/crates/solo-voice/src/pipeline.rs`:

```rust
use crate::audio::AudioRing;
use crate::error::{Result, VoiceError};
use crate::formatter::{AppContext, DictationOptions, FormatterProvider};
use crate::mode::{PipelineTarget, VoiceMode};
use crate::stt::SttProvider;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Mirrors `solo_protocol::VoicePipelineState`. Serde representation matches
/// the protocol's tagged union (`{ "kind": "...", "data": ... }`), so values
/// can be emitted to the frontend directly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum PipelineState {
    Idle,
    Arming,
    Recording,
    Transcribing,
    Formatting,
    Emitting,
    Error(String),
}

#[derive(Debug, Clone)]
pub struct PipelineOutput {
    pub id: String,
    pub mode: VoiceMode,
    pub raw_transcript: String,
    pub formatted: String,
    pub duration_ms: u32,
}

pub struct VoicePipeline {
    stt: Arc<dyn SttProvider>,
    formatter: Arc<dyn FormatterProvider>,
    ring: AudioRing,
    state: Arc<Mutex<PipelineState>>,
    on_state: Arc<dyn Fn(&PipelineState) + Send + Sync>,
}

impl VoicePipeline {
    pub fn new(
        stt: Arc<dyn SttProvider>,
        formatter: Arc<dyn FormatterProvider>,
        ring: AudioRing,
        on_state: Arc<dyn Fn(&PipelineState) + Send + Sync>,
    ) -> Self {
        Self {
            stt,
            formatter,
            ring,
            state: Arc::new(Mutex::new(PipelineState::Idle)),
            on_state,
        }
    }

    pub async fn state(&self) -> PipelineState {
        self.state.lock().await.clone()
    }

    async fn set(&self, s: PipelineState) {
        {
            let mut g = self.state.lock().await;
            *g = s.clone();
        }
        (self.on_state)(&s);
    }

    /// Drives the happy path: transition Idle→Arming→Recording.
    /// The caller must feed `ring` externally (cpal stream does this).
    pub async fn begin(&self) -> Result<()> {
        let cur = self.state().await;
        if cur != PipelineState::Idle {
            return Err(VoiceError::BadState(format!("{cur:?}")));
        }
        self.set(PipelineState::Arming).await;
        self.ring.clear();
        self.set(PipelineState::Recording).await;
        Ok(())
    }

    /// Called on end-of-speech. Drains the ring, transcribes, formats,
    /// returns output. Caller handles the mode-specific tail (paste,
    /// dispatch, or chat-input emit).
    pub async fn end(
        &self,
        mode: VoiceMode,
        _target: PipelineTarget,
        context: AppContext,
        options: DictationOptions,
    ) -> Result<PipelineOutput> {
        let cur = self.state().await;
        if cur != PipelineState::Recording {
            return Err(VoiceError::BadState(format!("{cur:?}")));
        }
        let started = std::time::Instant::now();
        let samples = self.ring.drain_all();
        if samples.is_empty() {
            self.set(PipelineState::Idle).await;
            return Err(VoiceError::Audio("no audio captured".into()));
        }

        self.set(PipelineState::Transcribing).await;
        let raw = self.stt.transcribe(&samples).await?;

        self.set(PipelineState::Formatting).await;
        let formatted = match mode {
            VoiceMode::Dictation => {
                self.formatter
                    .format_dictation(&raw, context.clone(), options.clone())
                    .await?
            }
            VoiceMode::Dispatch => {
                // Phase 1 does not drive dispatch; returning structured JSON
                // is handled in Phase 3. Kept here so the state machine is
                // correct when that phase ships.
                let task = self
                    .formatter
                    .format_dispatch(&raw, context.clone())
                    .await?;
                format!("{}\n\n{}", task.title, task.prompt)
            }
        };

        self.set(PipelineState::Emitting).await;
        let output = PipelineOutput {
            id: uuid::Uuid::new_v4().to_string(),
            mode,
            raw_transcript: raw,
            formatted,
            duration_ms: started.elapsed().as_millis() as u32,
        };
        self.set(PipelineState::Idle).await;
        Ok(output)
    }

    pub async fn cancel(&self) {
        self.ring.clear();
        self.set(PipelineState::Idle).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formatter::{CloudFormatter, ChatClient};
    use crate::stt::MockStt;
    use async_trait::async_trait;

    struct CannedChat(&'static str);
    #[async_trait]
    impl ChatClient for CannedChat {
        async fn simple_completion(&self, _m: &str, _s: &str, _u: &str) -> Result<String> {
            Ok(self.0.to_string())
        }
    }

    fn build() -> VoicePipeline {
        let stt: Arc<dyn SttProvider> = Arc::new(MockStt {
            canned: "hello world".into(),
        });
        let formatter: Arc<dyn FormatterProvider> = Arc::new(CloudFormatter {
            model: "x".into(),
            client: CannedChat("Hello, world."),
        });
        let ring = AudioRing::new();
        ring.push(&vec![0.1f32; 16_000]); // 1 second of dummy audio
        let on_state = Arc::new(|_: &PipelineState| {});
        VoicePipeline::new(stt, formatter, ring, on_state)
    }

    #[tokio::test]
    async fn happy_path_dictation() {
        let p = build();
        p.begin().await.unwrap();
        let out = p
            .end(
                VoiceMode::Dictation,
                PipelineTarget::ChatInput,
                AppContext::default(),
                DictationOptions::default(),
            )
            .await
            .unwrap();
        assert_eq!(out.raw_transcript, "hello world");
        assert_eq!(out.formatted, "Hello, world.");
        assert_eq!(p.state().await, PipelineState::Idle);
    }

    #[tokio::test]
    async fn end_without_begin_errors() {
        let p = build();
        let err = p
            .end(
                VoiceMode::Dictation,
                PipelineTarget::ChatInput,
                AppContext::default(),
                DictationOptions::default(),
            )
            .await
            .unwrap_err();
        assert!(matches!(err, VoiceError::BadState(_)));
    }

    #[tokio::test]
    async fn cancel_returns_to_idle() {
        let p = build();
        p.begin().await.unwrap();
        p.cancel().await;
        assert_eq!(p.state().await, PipelineState::Idle);
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test -p solo-voice --lib pipeline::tests`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add solo/crates/solo-voice/src/pipeline.rs
git commit -m "feat(solo-voice): pipeline state machine"
```

---

## Task 11: Tauri voice commands

**Files:**
- Create: `solo/apps/desktop/src-tauri/src/voice_commands.rs`
- Modify: `solo/apps/desktop/src-tauri/Cargo.toml`
- Modify: `solo/apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add solo-voice dep**

In `solo/apps/desktop/src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
solo-voice = { path = "../../../crates/solo-voice" }
```

- [ ] **Step 2: Write the commands file**

Create `solo/apps/desktop/src-tauri/src/voice_commands.rs`:

```rust
//! Tauri command surface for the voice pipeline.
//!
//! Phase 1 responsibilities: expose enable/begin/end/cancel, model
//! download, and history ops. No global hotkeys or paste — those
//! arrive in Phase 2.

use solo_voice::{
    audio::{start_capture, AudioRing, AudioStream},
    formatter::{
        AppContext, ChatClient, CloudFormatter, DictationOptions, FormatterProvider,
        DEFAULT_CLAUDE_FORMATTER_MODEL,
    },
    history::{History, HistoryRow},
    mode::{PipelineTarget, VoiceMode},
    models,
    pipeline::{PipelineState, VoicePipeline},
    stt::{SherpaConfig, SherpaParakeet, SttProvider},
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex as TokioMutex;

// -- Chat client wired to solo-auth's Claude provider ------------------------

struct ClaudeChatClient {
    // In a real wiring, hold an Arc to solo-auth's ProviderAuthState.
    // For P1 the voice_commands layer owns creation via solo-auth APIs.
    // Left intentionally thin here; the concrete call is in `simple_completion`.
    handle: AppHandle,
}

#[async_trait::async_trait]
impl ChatClient for ClaudeChatClient {
    async fn simple_completion(
        &self,
        model: &str,
        system: &str,
        user: &str,
    ) -> solo_voice::error::Result<String> {
        // Invoke solo-auth's Claude adapter. The exact call depends on
        // solo-auth's exposed API; the contract here is "given model +
        // system + user, return assistant text."
        //
        // Engineer: replace the body below with a call to
        // `solo_auth::providers::claude::simple_completion(&self.handle, model, system, user).await`
        // once that helper is added. For now, emit a descriptive error so
        // tests and UI fail cleanly.
        let _ = (model, system, user, &self.handle);
        Err(solo_voice::VoiceError::Formatter(
            "ClaudeChatClient::simple_completion: wire to solo-auth Claude provider".into(),
        ))
    }
}

// -- Managed Tauri state ------------------------------------------------------

pub struct VoiceState {
    pipeline: TokioMutex<Option<Arc<VoicePipeline>>>,
    stream: TokioMutex<Option<AudioStream>>,
    ring: AudioRing,
    history: TokioMutex<Option<History>>,
    models_root: TokioMutex<Option<PathBuf>>,
}

impl VoiceState {
    pub fn new() -> Self {
        Self {
            pipeline: TokioMutex::new(None),
            stream: TokioMutex::new(None),
            ring: AudioRing::new(),
            history: TokioMutex::new(None),
            models_root: TokioMutex::new(None),
        }
    }
}

// -- Helpers -----------------------------------------------------------------

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let models = base.join("models");
    std::fs::create_dir_all(&models).map_err(|e| e.to_string())?;
    Ok(models)
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base.join("voice_history.sqlite"))
}

fn emit_state(app: &AppHandle, mode: VoiceMode, state: &PipelineState) {
    #[derive(serde::Serialize, Clone)]
    struct Payload<'a> {
        mode: VoiceMode,
        state: &'a PipelineState,
    }
    let _ = app.emit("voice:state", Payload { mode, state });
}

// -- Commands ----------------------------------------------------------------

#[tauri::command]
pub async fn voice_enable(
    app: AppHandle,
    voice: State<'_, VoiceState>,
) -> Result<(), String> {
    // Open history db + remember models root.
    let hist_path = history_path(&app)?;
    let models_root = models_dir(&app)?;
    let history = History::open(&hist_path).map_err(|e| e.to_string())?;
    *voice.history.lock().await = Some(history);
    *voice.models_root.lock().await = Some(models_root);
    Ok(())
}

#[tauri::command]
pub async fn voice_download_parakeet(
    app: AppHandle,
    voice: State<'_, VoiceState>,
) -> Result<(), String> {
    let root = voice
        .models_root
        .lock()
        .await
        .clone()
        .ok_or_else(|| "voice not enabled".to_string())?;
    let app_for_progress = app.clone();
    models::download_manifest(&models::PARAKEET, &root, move |bytes, total| {
        let _ = app_for_progress.emit(
            "voice:model_progress",
            serde_json::json!({
                "model_id": models::PARAKEET.id,
                "bytes": bytes,
                "total": total,
            }),
        );
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_begin(
    app: AppHandle,
    voice: State<'_, VoiceState>,
    mode: VoiceMode,
) -> Result<(), String> {
    let mut pipeline_guard = voice.pipeline.lock().await;

    if pipeline_guard.is_none() {
        // Build STT from installed Parakeet files
        let root = voice
            .models_root
            .lock()
            .await
            .clone()
            .ok_or_else(|| "voice not enabled".to_string())?;
        if !models::is_installed(&root, &models::PARAKEET) {
            return Err("Parakeet model not downloaded".into());
        }
        let dir = models::install_dir(&root, &models::PARAKEET);
        let stt: Arc<dyn SttProvider> = Arc::new(
            SherpaParakeet::new(SherpaConfig {
                encoder: dir.join("encoder.int8.onnx"),
                decoder: dir.join("decoder.int8.onnx"),
                joiner: dir.join("joiner.int8.onnx"),
                tokens: dir.join("tokens.txt"),
                num_threads: 2,
            })
            .map_err(|e| e.to_string())?,
        );

        let formatter: Arc<dyn FormatterProvider> = Arc::new(CloudFormatter {
            model: DEFAULT_CLAUDE_FORMATTER_MODEL.into(),
            client: ClaudeChatClient { handle: app.clone() },
        });

        let app_for_state = app.clone();
        let on_state = Arc::new(move |s: &PipelineState| {
            emit_state(&app_for_state, mode, s);
        });

        *pipeline_guard = Some(Arc::new(VoicePipeline::new(
            stt,
            formatter,
            voice.ring.clone(),
            on_state,
        )));
    }
    let pipeline = pipeline_guard.as_ref().unwrap().clone();
    drop(pipeline_guard);

    // Start cpal stream
    let stream = start_capture(voice.ring.clone()).map_err(|e| e.to_string())?;
    *voice.stream.lock().await = Some(stream);

    pipeline.begin().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_end(
    app: AppHandle,
    voice: State<'_, VoiceState>,
    mode: VoiceMode,
    target: PipelineTarget,
) -> Result<(), String> {
    let pipeline = voice
        .pipeline
        .lock()
        .await
        .clone()
        .ok_or_else(|| "pipeline not initialised".to_string())?;

    // Stop audio capture
    *voice.stream.lock().await = None;

    let out = pipeline
        .end(
            mode,
            target,
            AppContext::default(),
            DictationOptions::default(),
        )
        .await
        .map_err(|e| e.to_string())?;

    // History
    if let Some(h) = voice.history.lock().await.as_ref() {
        let row = HistoryRow {
            id: out.id.clone(),
            mode: format!("{:?}", out.mode),
            raw_transcript: out.raw_transcript.clone(),
            formatted: out.formatted.clone(),
            target_app_bundle_id: None,
            target_app_name: None,
            duration_ms: out.duration_ms,
            linked_session_id: None,
            created_at: chrono::Utc::now().timestamp_millis(),
        };
        h.insert(&row).map_err(|e| e.to_string())?;
    }

    // Frontend payload (mirrors protocol::VoiceTranscriptResult)
    let payload = serde_json::json!({
        "id": out.id,
        "mode": out.mode,
        "raw_transcript": out.raw_transcript,
        "formatted": out.formatted,
        "target_app_bundle_id": serde_json::Value::Null,
        "target_app_name": serde_json::Value::Null,
        "duration_ms": out.duration_ms,
        "linked_session_id": serde_json::Value::Null,
        "created_at": chrono::Utc::now().timestamp_millis(),
    });
    let _ = app.emit("voice:transcript", serde_json::json!({ "result": payload }));
    Ok(())
}

#[tauri::command]
pub async fn voice_cancel(voice: State<'_, VoiceState>) -> Result<(), String> {
    *voice.stream.lock().await = None;
    if let Some(p) = voice.pipeline.lock().await.as_ref() {
        p.cancel().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_history_list(
    voice: State<'_, VoiceState>,
    limit: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let g = voice.history.lock().await;
    let h = g.as_ref().ok_or_else(|| "voice not enabled".to_string())?;
    let rows = h.list(limit).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "mode": r.mode,
                "raw_transcript": r.raw_transcript,
                "formatted": r.formatted,
                "target_app_bundle_id": r.target_app_bundle_id,
                "target_app_name": r.target_app_name,
                "duration_ms": r.duration_ms,
                "linked_session_id": r.linked_session_id,
                "created_at": r.created_at,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn voice_history_delete(
    voice: State<'_, VoiceState>,
    id: String,
) -> Result<(), String> {
    let g = voice.history.lock().await;
    let h = g.as_ref().ok_or_else(|| "voice not enabled".to_string())?;
    h.delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_parakeet_installed(
    voice: State<'_, VoiceState>,
) -> Result<bool, String> {
    let root = voice
        .models_root
        .lock()
        .await
        .clone()
        .ok_or_else(|| "voice not enabled".to_string())?;
    Ok(models::is_installed(&root, &models::PARAKEET))
}
```

The file references `chrono` (used elsewhere in the app already). If `chrono` isn't in `apps/desktop/src-tauri/Cargo.toml`, add:

```toml
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 3: Register state + commands in `lib.rs`**

Edit `solo/apps/desktop/src-tauri/src/lib.rs`. Add at the top with other `mod` statements:

```rust
mod voice_commands;
```

Remove `mod elevenlabs_commands;` (if present). Locate the `.manage(...)` chain that registers state, and:

- Remove any `ProviderAuthState`-adjacent or `ElevenLabs*` state lines
- Add `.manage(voice_commands::VoiceState::new())`

Locate the `generate_handler![ ... ]` macro call and:

- Remove all `elevenlabs_commands::*` entries
- Add: `voice_commands::voice_enable`, `voice_commands::voice_download_parakeet`, `voice_commands::voice_begin`, `voice_commands::voice_end`, `voice_commands::voice_cancel`, `voice_commands::voice_history_list`, `voice_commands::voice_history_delete`, `voice_commands::voice_parakeet_installed`

- [ ] **Step 4: Verify**

From `solo/` run: `cargo check --workspace`
Expected: clean except for the stubbed ClaudeChatClient error — acceptable since wiring is a follow-up within this task list.

- [ ] **Step 5: Commit**

```bash
git add solo/apps/desktop/src-tauri/Cargo.toml solo/apps/desktop/src-tauri/src/voice_commands.rs solo/apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(voice_commands): Tauri command surface for solo-voice"
```

---

## Task 12: Wire ClaudeChatClient to solo-auth

**Files:**
- Modify: `solo/apps/desktop/src-tauri/src/voice_commands.rs`
- Possibly: `solo/crates/solo-auth/src/lib.rs` (to expose a public `simple_completion` helper if not already present)

- [ ] **Step 1: Inspect solo-auth's public surface**

Run: `grep -rn "claude" solo/crates/solo-auth/src/` and `cat solo/crates/solo-auth/src/lib.rs`
Expected: identify the existing Claude provider entry point. Look for anything shaped like `pub async fn complete` or `pub async fn chat`.

- [ ] **Step 2: Add a `simple_completion` helper in solo-auth (if one doesn't exist)**

If solo-auth exposes only raw provider clients, add `solo/crates/solo-auth/src/providers/claude_simple.rs` (or an equivalent module) with:

```rust
use crate::Result;

pub async fn simple_completion(
    access_token: &str,
    model: &str,
    system: &str,
    user: &str,
) -> Result<String> {
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "system": system,
        "messages": [{ "role": "user", "content": user }],
    });
    let resp = reqwest::Client::new()
        .post("https://api.anthropic.com/v1/messages")
        .bearer_auth(access_token)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json::<serde_json::Value>()
        .await?;
    let text = resp
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| anyhow::anyhow!("unexpected Claude response shape"))?
        .to_string();
    Ok(text)
}
```

Expose it from `solo-auth`'s `lib.rs`: `pub use providers::claude_simple::simple_completion as claude_simple_completion;`

- [ ] **Step 3: Replace stub in `ClaudeChatClient`**

In `voice_commands.rs`, replace the stub body with:

```rust
async fn simple_completion(
    &self,
    model: &str,
    system: &str,
    user: &str,
) -> solo_voice::error::Result<String> {
    // Fetch a fresh Claude access token from solo-auth's credential store.
    // The access-token fetch helper exists today in solo-auth — use the
    // same call path solo's agent_commands uses. Here we assume a helper
    // `solo_auth::get_claude_access_token(&handle)` exists; swap to the
    // actual name in this codebase.
    let token = solo_auth::get_claude_access_token(&self.handle)
        .await
        .map_err(|e| solo_voice::VoiceError::Formatter(format!("auth: {e}")))?;
    solo_auth::claude_simple_completion(&token, model, system, user)
        .await
        .map_err(|e| solo_voice::VoiceError::Formatter(format!("claude: {e}")))
}
```

If solo-auth's actual token-fetch helper has a different name, substitute it. Check `grep -n "access_token" solo/crates/solo-auth/src/` to find it.

- [ ] **Step 4: Verify**

From `solo/` run: `cargo check --workspace`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add solo/apps/desktop/src-tauri/src/voice_commands.rs solo/crates/solo-auth
git commit -m "feat(voice): wire ClaudeChatClient to solo-auth"
```

---

## Task 13: Frontend — voiceStore + tauri wrappers

**Files:**
- Create: `solo/apps/desktop/src/lib/tauri/voice.ts`
- Create: `solo/apps/desktop/src/stores/voiceStore.ts`

- [ ] **Step 1: Write the tauri wrapper**

Create `solo/apps/desktop/src/lib/tauri/voice.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { VoiceMode } from '@/bindings/VoiceMode';
import type { VoicePipelineState } from '@/bindings/VoicePipelineState';
import type { VoiceTranscriptResult } from '@/bindings/VoiceTranscriptResult';
import type { VoiceModelProgress } from '@/bindings/VoiceModelProgress';

export type PipelineTarget = 'ChatInput' | 'FocusedApp' | 'NewAgentSession';

export const voiceApi = {
  enable:            () => invoke<void>('voice_enable'),
  downloadParakeet:  () => invoke<void>('voice_download_parakeet'),
  parakeetInstalled: () => invoke<boolean>('voice_parakeet_installed'),
  begin:             (mode: VoiceMode) => invoke<void>('voice_begin', { mode }),
  end:               (mode: VoiceMode, target: PipelineTarget) =>
                       invoke<void>('voice_end', { mode, target }),
  cancel:            () => invoke<void>('voice_cancel'),
  historyList:       (limit = 50) =>
                       invoke<VoiceTranscriptResult[]>('voice_history_list', { limit }),
  historyDelete:     (id: string) => invoke<void>('voice_history_delete', { id }),
};

export function onVoiceState(
  cb: (p: { mode: VoiceMode; state: VoicePipelineState }) => void,
): Promise<UnlistenFn> {
  return listen<{ mode: VoiceMode; state: VoicePipelineState }>('voice:state', (e) =>
    cb(e.payload),
  );
}

export function onVoiceTranscript(
  cb: (r: VoiceTranscriptResult) => void,
): Promise<UnlistenFn> {
  return listen<{ result: VoiceTranscriptResult }>('voice:transcript', (e) =>
    cb(e.payload.result),
  );
}

export function onVoiceError(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<{ message: string }>('voice:error', (e) => cb(e.payload.message));
}

export function onVoiceModelProgress(
  cb: (p: VoiceModelProgress) => void,
): Promise<UnlistenFn> {
  return listen<{ progress: VoiceModelProgress }>('voice:model_progress', (e) =>
    cb(e.payload.progress),
  );
}
```

- [ ] **Step 2: Write the store**

Create `solo/apps/desktop/src/stores/voiceStore.ts`:

```typescript
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { VoicePipelineState } from '@/bindings/VoicePipelineState';
import type { VoiceTranscriptResult } from '@/bindings/VoiceTranscriptResult';

interface VoiceStore {
  enabled: boolean;
  parakeetInstalled: boolean;
  pipelineState: VoicePipelineState;
  lastTranscript: VoiceTranscriptResult | null;
  error: string | null;
  modelDownload: { bytes: number; total: number } | null;

  setEnabled: (v: boolean) => void;
  setParakeetInstalled: (v: boolean) => void;
  setPipelineState: (s: VoicePipelineState) => void;
  setLastTranscript: (r: VoiceTranscriptResult) => void;
  setError: (msg: string | null) => void;
  setModelDownload: (p: { bytes: number; total: number } | null) => void;
}

export const useVoiceStore = create<VoiceStore>()(
  immer((set) => ({
    enabled: false,
    parakeetInstalled: false,
    pipelineState: { kind: 'Idle' } as VoicePipelineState,
    lastTranscript: null,
    error: null,
    modelDownload: null,

    setEnabled:            (v) => set((s) => { s.enabled = v; }),
    setParakeetInstalled:  (v) => set((s) => { s.parakeetInstalled = v; }),
    setPipelineState:      (p) => set((s) => { s.pipelineState = p; }),
    setLastTranscript:     (r) => set((s) => { s.lastTranscript = r; }),
    setError:              (e) => set((s) => { s.error = e; }),
    setModelDownload:      (p) => set((s) => { s.modelDownload = p; }),
  })),
);
```

- [ ] **Step 3: Add a smoke test**

Create `solo/apps/desktop/src/stores/__tests__/voiceStore.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { useVoiceStore } from '@/stores/voiceStore';

describe('voiceStore', () => {
  it('transitions pipeline state', () => {
    const { setPipelineState } = useVoiceStore.getState();
    setPipelineState({ kind: 'Recording' });
    expect(useVoiceStore.getState().pipelineState).toEqual({ kind: 'Recording' });
  });

  it('clears error when set to null', () => {
    const { setError } = useVoiceStore.getState();
    setError('x');
    expect(useVoiceStore.getState().error).toBe('x');
    setError(null);
    expect(useVoiceStore.getState().error).toBeNull();
  });
});
```

Run from `solo/apps/desktop/`: `bun run test -- voiceStore`
Expected: 2 passing.

- [ ] **Step 4: Commit**

```bash
git add solo/apps/desktop/src/lib/tauri/voice.ts solo/apps/desktop/src/stores/voiceStore.ts solo/apps/desktop/src/stores/__tests__/voiceStore.test.ts
git commit -m "feat(ui): voiceStore + tauri wrappers"
```

---

## Task 14: Rewire `useVoiceInput` against voiceStore

**Files:**
- Modify: `solo/apps/desktop/src/hooks/useVoiceInput.ts`

- [ ] **Step 1: Replace the hook**

Replace contents of `solo/apps/desktop/src/hooks/useVoiceInput.ts`:

```typescript
import { useCallback, useEffect, useRef } from 'react';
import { useVoiceStore } from '@/stores/voiceStore';
import {
  voiceApi,
  onVoiceState,
  onVoiceTranscript,
  onVoiceError,
  onVoiceModelProgress,
  type PipelineTarget,
} from '@/lib/tauri/voice';
import type { UnlistenFn } from '@tauri-apps/api/event';

export interface UseVoiceInputOptions {
  /** Called when a transcript is finalized. */
  onTranscript: (formatted: string) => void;
}

export function useVoiceInput({ onTranscript }: UseVoiceInputOptions) {
  const pipelineState   = useVoiceStore((s) => s.pipelineState);
  const enabled         = useVoiceStore((s) => s.enabled);
  const setPipeline     = useVoiceStore((s) => s.setPipelineState);
  const setTranscript   = useVoiceStore((s) => s.setLastTranscript);
  const setError        = useVoiceStore((s) => s.setError);
  const setModelProgress= useVoiceStore((s) => s.setModelDownload);

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u1 = await onVoiceState(({ state }) => setPipeline(state));
      const u2 = await onVoiceTranscript((r) => {
        setTranscript(r);
        onTranscript(r.formatted);
      });
      const u3 = await onVoiceError(setError);
      const u4 = await onVoiceModelProgress((p) =>
        setModelProgress({ bytes: Number(p.bytes), total: Number(p.total) }),
      );
      if (cancelled) {
        u1(); u2(); u3(); u4();
      } else {
        unlistenRefs.current = [u1, u2, u3, u4];
      }
    })();
    return () => {
      cancelled = true;
      unlistenRefs.current.forEach((u) => u());
      unlistenRefs.current = [];
    };
  }, [setPipeline, setTranscript, setError, setModelProgress, onTranscript]);

  const start = useCallback(async () => {
    if (!enabled) {
      setError('Voice is disabled. Enable it in Settings → Voice.');
      return;
    }
    try {
      await voiceApi.begin('Dictation');
    } catch (e) {
      setError(String(e));
    }
  }, [enabled, setError]);

  const stop = useCallback(async (target: PipelineTarget = 'ChatInput') => {
    try {
      await voiceApi.end('Dictation', target);
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const cancel = useCallback(async () => {
    try {
      await voiceApi.cancel();
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const isRecording =
    typeof pipelineState === 'object' &&
    'kind' in pipelineState &&
    pipelineState.kind === 'Recording';

  return { start, stop, cancel, isRecording, state: pipelineState };
}
```

- [ ] **Step 2: Verify compiles**

Run from `solo/apps/desktop/`: `bun run check`
Expected: no errors in `useVoiceInput.ts`.

- [ ] **Step 3: Commit**

```bash
git add solo/apps/desktop/src/hooks/useVoiceInput.ts
git commit -m "feat(ui): rewire useVoiceInput against voiceStore"
```

---

## Task 15: Update `voice-button.tsx` and `ChatInputContainer`

**Files:**
- Modify: `solo/apps/desktop/src/components/agent/input/voice-button.tsx`
- Modify: `solo/apps/desktop/src/components/agent/input/ChatInputContainer.tsx`

- [ ] **Step 1: Inspect existing `voice-button.tsx`**

Run: `cat solo/apps/desktop/src/components/agent/input/voice-button.tsx`
Expected: identify the existing ElevenLabs-based logic to remove.

- [ ] **Step 2: Rewrite `voice-button.tsx`**

Replace its contents with a minimal mic button wired to `useVoiceInput`:

```typescript
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { MicIcon, MicOffIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
}

export function VoiceButton({ onTranscript, className }: VoiceButtonProps) {
  const { start, stop, isRecording, state } = useVoiceInput({ onTranscript });
  const isBusy =
    typeof state === 'object' &&
    'kind' in state &&
    (state.kind === 'Transcribing' || state.kind === 'Formatting');

  return (
    <button
      type="button"
      aria-label={isRecording ? 'Stop dictation' : 'Start dictation'}
      disabled={isBusy}
      onClick={async () => (isRecording ? await stop('ChatInput') : await start())}
      className={cn(
        'inline-flex items-center justify-center h-8 w-8 rounded-md transition',
        isRecording
          ? 'bg-red-500/15 text-red-500'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        isBusy && 'opacity-50 cursor-wait',
        className,
      )}
    >
      {isRecording ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
    </button>
  );
}
```

- [ ] **Step 3: Update `ChatInputContainer.tsx`**

Locate the existing mic button / ElevenLabs integration in `ChatInputContainer.tsx`. Replace it with the new `<VoiceButton onTranscript={...} />` passing a callback that inserts text into the Lexical editor at the current cursor. The existing code already has a text-insertion helper (look for `insertTextAtCursor` or equivalent); reuse it.

Minimal patch pattern: find the JSX node that used to render the ElevenLabs mic and replace with:

```tsx
<VoiceButton onTranscript={(formatted) => insertTextAtCursor(formatted)} />
```

Remove any `useElevenLabs*` imports and hook calls.

- [ ] **Step 4: Verify**

From `solo/apps/desktop/` run: `bun run check`
Expected: no errors around the chat input or voice button.

- [ ] **Step 5: Commit**

```bash
git add solo/apps/desktop/src/components/agent/input/voice-button.tsx solo/apps/desktop/src/components/agent/input/ChatInputContainer.tsx
git commit -m "feat(ui): chat mic button wired to solo-voice"
```

---

## Task 16: Rewrite `VoiceTab` settings

**Files:**
- Modify: `solo/apps/desktop/src/components/settings/tabs/VoiceTab.tsx`

- [ ] **Step 1: Rewrite**

Replace contents of `solo/apps/desktop/src/components/settings/tabs/VoiceTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { voiceApi, onVoiceModelProgress } from '@/lib/tauri/voice';
import { useVoiceStore } from '@/stores/voiceStore';
import type { VoiceTranscriptResult } from '@/bindings/VoiceTranscriptResult';
import { Button } from '@solo/ui';

export function VoiceTab() {
  const enabled = useVoiceStore((s) => s.enabled);
  const setEnabled = useVoiceStore((s) => s.setEnabled);
  const parakeetInstalled = useVoiceStore((s) => s.parakeetInstalled);
  const setParakeetInstalled = useVoiceStore((s) => s.setParakeetInstalled);
  const modelDownload = useVoiceStore((s) => s.modelDownload);
  const setModelDownload = useVoiceStore((s) => s.setModelDownload);

  const [history, setHistory] = useState<VoiceTranscriptResult[]>([]);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    (async () => {
      if (!enabled) return;
      setParakeetInstalled(await voiceApi.parakeetInstalled());
      setHistory(await voiceApi.historyList(50));
    })();
  }, [enabled, setParakeetInstalled]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await onVoiceModelProgress((p) =>
        setModelDownload({ bytes: Number(p.bytes), total: Number(p.total) }),
      );
    })();
    return () => unlisten?.();
  }, [setModelDownload]);

  async function toggleEnable() {
    if (!enabled) {
      await voiceApi.enable();
      setEnabled(true);
      setParakeetInstalled(await voiceApi.parakeetInstalled());
    } else {
      setEnabled(false);
    }
  }

  async function downloadParakeet() {
    setDownloading(true);
    try {
      await voiceApi.downloadParakeet();
      setParakeetInstalled(true);
    } finally {
      setDownloading(false);
      setModelDownload(null);
    }
  }

  async function deleteRow(id: string) {
    await voiceApi.historyDelete(id);
    setHistory(await voiceApi.historyList(50));
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold mb-2">Voice input</h3>
        <Button onClick={toggleEnable}>{enabled ? 'Disable' : 'Enable'} voice</Button>
      </section>

      {enabled && (
        <>
          <section>
            <h3 className="text-sm font-semibold mb-2">Models</h3>
            <div className="flex items-center gap-3">
              <span>Parakeet TDT 0.6B (int8) —</span>
              <span>{parakeetInstalled ? 'Installed' : 'Not installed'}</span>
              {!parakeetInstalled && (
                <Button disabled={downloading} onClick={downloadParakeet}>
                  {downloading ? 'Downloading…' : 'Download'}
                </Button>
              )}
            </div>
            {modelDownload && (
              <div className="text-xs text-muted-foreground mt-2">
                {Math.round((modelDownload.bytes / Math.max(1, modelDownload.total)) * 100)}%
                ({Math.round(modelDownload.bytes / 1_048_576)} /
                {Math.round(modelDownload.total / 1_048_576)} MB)
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-2">History</h3>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">No transcripts yet.</p>
            ) : (
              <ul className="space-y-2 max-h-80 overflow-auto">
                {history.map((r) => (
                  <li key={r.id} className="text-xs border rounded p-2 flex gap-2">
                    <span className="flex-1">{r.formatted}</span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => navigator.clipboard.writeText(r.formatted)}
                    >Copy</button>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => deleteRow(r.id)}
                    >Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Check tsc**

From `solo/apps/desktop/` run: `bun run check`
Expected: clean for this file.

- [ ] **Step 3: Commit**

```bash
git add solo/apps/desktop/src/components/settings/tabs/VoiceTab.tsx
git commit -m "feat(settings): rewrite VoiceTab for solo-voice"
```

---

## Task 17: Rip out ElevenLabs

**Files (deletions):**
- `solo/crates/solo-elevenlabs/`
- `solo/apps/desktop/src-tauri/src/elevenlabs_commands.rs`
- `solo/apps/desktop/src/stores/elevenlabsStore.ts`
- `solo/apps/desktop/src/lib/tauri/elevenlabs.ts`
- `solo/apps/desktop/src/lib/elevenlabs/`

**Files (modifications):**
- `solo/Cargo.toml` (workspace)
- `solo/apps/desktop/src-tauri/Cargo.toml`
- `solo/apps/desktop/src-tauri/src/lib.rs`
- `solo/apps/desktop/src/stores/settingsStore.ts`

- [ ] **Step 1: Delete files**

```bash
rm -rf solo/crates/solo-elevenlabs
rm -f  solo/apps/desktop/src-tauri/src/elevenlabs_commands.rs
rm -f  solo/apps/desktop/src/stores/elevenlabsStore.ts
rm -f  solo/apps/desktop/src/lib/tauri/elevenlabs.ts
rm -rf solo/apps/desktop/src/lib/elevenlabs
```

- [ ] **Step 2: Remove workspace member**

In `solo/Cargo.toml`, the `members = ["crates/*", "apps/desktop/src-tauri"]` wildcard already excludes deleted dirs. Check that no `default-members` list names `solo-elevenlabs`.

- [ ] **Step 3: Drop unused workspace deps**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo tree --workspace -i tokio-tungstenite | head -5
cargo tree --workspace -i base64 | head -20
```

If `tokio-tungstenite` has no consumers, delete its line from `solo/Cargo.toml [workspace.dependencies]`. Same for `base64`.

- [ ] **Step 4: Remove solo-elevenlabs from tauri app**

In `solo/apps/desktop/src-tauri/Cargo.toml`, delete the `solo-elevenlabs` dependency line.

In `solo/apps/desktop/src-tauri/src/lib.rs`:
- Remove `mod elevenlabs_commands;`
- Remove any `.manage(...)` call for an ElevenLabs state
- Remove every `elevenlabs_commands::*` entry from `generate_handler!`

- [ ] **Step 5: Strip elevenlabs keys from settingsStore + migrate**

Open `solo/apps/desktop/src/stores/settingsStore.ts`. Remove all `elevenlabs*` fields from the state type, initial state, and reducers.

Add a one-shot migration to the persist middleware or the hydration hook:

```typescript
// Drop legacy elevenlabs keys on load (safe no-op if absent)
const raw = localStorage.getItem('solo-settings');
if (raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.state && 'elevenlabs' in parsed.state) {
      delete parsed.state.elevenlabs;
      localStorage.setItem('solo-settings', JSON.stringify(parsed));
    }
  } catch { /* ignore */ }
}
```

Place this at the top of `settingsStore.ts` before the `create(...)` call.

- [ ] **Step 6: Verify compiles**

From `solo/` run: `cargo check --workspace && bun run check`
Expected: clean.

- [ ] **Step 7: Search for stragglers**

Run: `grep -rln "elevenlabs\|ElevenLabs" solo/apps solo/crates solo/Cargo.toml 2>/dev/null | grep -v node_modules`
Expected: no hits. Address any that appear.

- [ ] **Step 8: Commit**

```bash
git add -A solo/crates solo/apps solo/Cargo.toml
git commit -m "chore: rip out solo-elevenlabs in favor of solo-voice"
```

---

## Task 18: Integration test — feed WAV through pipeline

**Files:**
- Create: `solo/crates/solo-voice/tests/pipeline_end_to_end.rs`

- [ ] **Step 1: Write the test**

Create `solo/crates/solo-voice/tests/pipeline_end_to_end.rs`:

```rust
//! End-to-end pipeline test using MockStt + a fake ChatClient.
//! Exercises begin → feed audio → end → formatted output.

use solo_voice::{
    audio::AudioRing,
    formatter::{ChatClient, CloudFormatter, DictationOptions, AppContext, FormatterProvider},
    mode::{PipelineTarget, VoiceMode},
    pipeline::{PipelineState, VoicePipeline},
    stt::{MockStt, SttProvider},
};
use std::sync::{Arc, Mutex};
use async_trait::async_trait;

struct CannedChat(&'static str);
#[async_trait]
impl ChatClient for CannedChat {
    async fn simple_completion(&self, _m: &str, _s: &str, _u: &str)
        -> solo_voice::error::Result<String>
    {
        Ok(self.0.to_string())
    }
}

#[tokio::test]
async fn end_to_end_dictation() {
    let stt: Arc<dyn SttProvider> = Arc::new(MockStt { canned: "hello world".into() });
    let formatter: Arc<dyn FormatterProvider> = Arc::new(CloudFormatter {
        model: "x".into(),
        client: CannedChat("Hello, world."),
    });
    let ring = AudioRing::new();

    let states = Arc::new(Mutex::new(Vec::<PipelineState>::new()));
    let states_c = states.clone();
    let on_state = Arc::new(move |s: &PipelineState| states_c.lock().unwrap().push(s.clone()));

    let pipeline = VoicePipeline::new(stt, formatter, ring.clone(), on_state);

    // Simulate audio
    ring.push(&vec![0.1f32; 16_000]); // 1 s

    pipeline.begin().await.unwrap();
    let out = pipeline
        .end(
            VoiceMode::Dictation,
            PipelineTarget::ChatInput,
            AppContext::default(),
            DictationOptions::default(),
        )
        .await
        .unwrap();

    assert_eq!(out.raw_transcript, "hello world");
    assert_eq!(out.formatted, "Hello, world.");
    let seen = states.lock().unwrap().clone();
    let names: Vec<&'static str> = seen
        .iter()
        .map(|s| match s {
            PipelineState::Idle => "Idle",
            PipelineState::Arming => "Arming",
            PipelineState::Recording => "Recording",
            PipelineState::Transcribing => "Transcribing",
            PipelineState::Formatting => "Formatting",
            PipelineState::Emitting => "Emitting",
            PipelineState::Error(_) => "Error",
        })
        .collect();
    assert_eq!(names, vec![
        "Arming", "Recording", "Transcribing", "Formatting", "Emitting", "Idle"
    ]);
}
```

- [ ] **Step 2: Run**

From `solo/` run: `cargo test -p solo-voice --test pipeline_end_to_end`
Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
git add solo/crates/solo-voice/tests/pipeline_end_to_end.rs
git commit -m "test(solo-voice): end-to-end pipeline integration test"
```

---

## Task 19: Manual QA checklist + docs

**Files:**
- Modify: `solo/testing.md`
- Modify: `solo/CLAUDE.md` (voice section)

- [ ] **Step 1: Append QA checklist**

Append to `solo/testing.md`:

```markdown
## Voice (Phase 1)

- [ ] Open Settings → Voice, click `Enable voice` → macOS Microphone permission prompt appears
- [ ] Click `Download` for Parakeet → progress bar updates, completes ~250 MB
- [ ] Open the agent chat, click the mic button → recording starts (icon changes)
- [ ] Speak a short sentence, click mic again → transcript appears in chat input
- [ ] Click `Copy` in Voice history → clipboard contains the formatted text
- [ ] Click `Delete` in Voice history → row removed
- [ ] Disable voice, re-enable → Parakeet still marked installed, history preserved
```

- [ ] **Step 2: Update CLAUDE.md**

In `solo/CLAUDE.md`, replace any mention of `solo-elevenlabs` with `solo-voice`. Add a short paragraph under "Crates":

```markdown
- `solo-voice` — voice input pipeline: cpal audio capture, Silero VAD,
  Sherpa-ONNX Parakeet STT, cloud formatter (Claude Haiku / GPT-5 nano).
  Phase 1 drives the chat mic only; global dictation and agent dispatch
  arrive in Phases 2 and 3.
```

- [ ] **Step 3: Commit**

```bash
git add solo/testing.md solo/CLAUDE.md
git commit -m "docs: voice Phase 1 QA checklist + CLAUDE.md update"
```

---

## Task 20: Final workspace validation

- [ ] **Step 1: Full check**

From `solo/` run:

```bash
cargo check --workspace
cargo clippy --workspace -- -D warnings
cargo test --workspace
bun run check
bun run test
```

Expected: all pass. Any failures here block the phase.

- [ ] **Step 2: Run the app**

From `solo/` run: `bun run dev`
Expected: Solo boots. Open Settings → Voice, walk the QA checklist from Task 19. Record one utterance, verify the transcript lands in the chat input.

- [ ] **Step 3: Pin actual SHA-256 hashes**

After the successful download in Step 2, compute SHA-256 of the four Parakeet files at `~/Library/Application Support/com.solo.desktop/models/parakeet-tdt-0.6b-v2/`:

```bash
shasum -a 256 ~/Library/Application\ Support/com.solo.desktop/models/parakeet-tdt-0.6b-v2/*.onnx \
                ~/Library/Application\ Support/com.solo.desktop/models/parakeet-tdt-0.6b-v2/tokens.txt
```

Paste the hex digests into `solo/crates/solo-voice/src/models.rs`, replacing the `REPLACE_WITH_ACTUAL_HASH_ON_FIRST_DOWNLOAD` placeholders. Also update `size_bytes` with `ls -l` of each file.

- [ ] **Step 4: Commit pinned hashes**

```bash
git add solo/crates/solo-voice/src/models.rs
git commit -m "chore(solo-voice): pin Parakeet SHA-256 hashes"
```

- [ ] **Step 5: Phase 1 complete**

Open a PR titled `feat: voice Phase 1 — solo-voice + chat mic`. Link it to the spec `solo/docs/superpowers/specs/2026-04-17-voice-in-solo-design.md`.

---

## Follow-up plans (not in this plan)

- `2026-04-XX-voice-in-solo-phase-2.md` — global dictation: CGEvent tap, text injection, cursor-pill HUD, Voice-settings shortcut recorder, permissions banner.
- `2026-04-XX-voice-in-solo-phase-3.md` — agent dispatch: second hotkey, dispatch-prompt formatter variant, silent-spawn + toast + dock badge + sidebar-row + auto-pop-on-focus, history linking to agent sessions.
- Optional: local Llama-3.2-1B formatter (`LocalLlamaFormatter`) — adds `llama-cpp-rs` + download flow. Gated behind user opt-in in Voice settings.
