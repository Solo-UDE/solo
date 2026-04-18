# Voice in Solo — Design

Status: Draft · Date: 2026-04-17 · Owner: @sachin1801

## Goal

Bring VoiceFlow-style native voice into Solo IDE with a Solo-native extension: voice isn't just dictation — it can also dispatch agent tasks. Swap VoiceFlow's local Whisper for cloud-ready NVIDIA Parakeet. Keep the desktop binary small; download models on demand.

## Non-goals (v1)

- Windows / Linux support. Traits are portable; impls are macOS-only.
- Streaming partial transcripts (batch-only, VoiceFlow-parity).
- Multi-agent fan-out from a single utterance.
- Self-hosted model infrastructure. Cloud formatter uses existing Claude/Codex auth.
- Retaining any ElevenLabs code. Existing STT/TTS integration is removed entirely.

## Product shape

One voice pipeline (audio → VAD → Parakeet → formatter) exposed through three surfaces, layered:

| Surface | Input | Output | Hotkey |
|---|---|---|---|
| Chat mic | Click mic in Solo's agent chat | Formatted text into chat input | n/a (button) |
| Dictation | Global PTT, any focused app | Formatted text pasted into focused app | `Fn` (configurable) |
| Agent dispatch | Global PTT, any focused app | New agent session created silently in Solo | `⌃⌥Space` (configurable) |

One voice command = one agent. No fan-out in v1. HUD is a single cursor-following pill, colored white for dictation and green for dispatch.

Dispatch is silent-spawn: no focus-steal; a toast + dock badge confirms the dispatch; the session appears as a sidebar row and auto-pops the agent panel the next time Solo gains focus.

## Architecture

### Crate layout

```
solo/
├─ crates/solo-voice/              NEW
│   ├─ src/lib.rs                  pub surface
│   ├─ src/audio.rs                cpal ring-buffer capture
│   ├─ src/vad.rs                  silero-vad via `ort`
│   ├─ src/stt.rs                  sherpa-rs Parakeet, trait + impl
│   ├─ src/formatter.rs            FormatterProvider trait;
│   │                              ClaudeFormatter / CodexFormatter / LocalLlamaFormatter
│   ├─ src/pipeline.rs             state machine
│   ├─ src/history.rs              SQLite (rusqlite) — voice_transcripts table
│   └─ src/mode.rs                 VoiceMode { Dictation, Dispatch }
│
├─ crates/solo-protocol/           EXTENDED (see Protocol additions)
│
├─ apps/desktop/src-tauri/src/
│   ├─ voice_commands.rs           NEW — Tauri command surface
│   └─ voice/                      NEW — macOS platform glue (ported from VoiceFlow)
│       ├─ hotkey.rs               CGEvent tap
│       ├─ injection.rs            clipboard + synthesized Cmd+V
│       ├─ app_monitor.rs          NSWorkspace frontmost app
│       └─ hud.rs                  manages the cursor-pill window
│
├─ apps/desktop/src/
│   ├─ hud/                        NEW — second Tauri window (hud.html + hud.tsx)
│   ├─ stores/voiceStore.ts        NEW — replaces elevenlabsStore
│   ├─ hooks/useVoiceInput.ts      REWRITTEN against voiceStore
│   └─ components/settings/tabs/VoiceTab.tsx    REWRITTEN
│
└─ REMOVED:
    crates/solo-elevenlabs/
    apps/desktop/src-tauri/src/elevenlabs_commands.rs
    apps/desktop/src/stores/elevenlabsStore.ts
    apps/desktop/src/lib/tauri/elevenlabs.ts
    apps/desktop/src/lib/elevenlabs/
```

### Protocol additions (`crates/solo-protocol/src/lib.rs`)

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
pub enum VoiceMode { Dictation, Dispatch }

#[derive(TS, Serialize, Deserialize, Clone, Debug)]
#[ts(export)]
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
    pub id: String,                 // uuid v4
    pub mode: VoiceMode,
    pub raw_transcript: String,
    pub formatted: String,
    pub target_app_bundle_id: Option<String>,
    pub target_app_name: Option<String>,
    pub duration_ms: u32,
    pub linked_session_id: Option<String>,  // set on Dispatch mode
    pub created_at: i64,            // unix ms
}
```

BackendEvent variants (tagged union, colon-separated names):
- `voice:state` — `{ mode, state }`
- `voice:level` — `{ rms: f32 }` emitted at 50 Hz during Recording for HUD bars
- `voice:transcript` — `{ result: VoiceTranscriptResult }` emitted on successful Emitting
- `voice:error` — `{ message: String }`
- `voice:model_progress` — `{ model_id, bytes, total }` during downloads

After any change to `solo-protocol/src/lib.rs`: run `bun run gen:bindings` from `solo/`.

### Pipeline state machine

```
Idle
 └── voice_begin(mode) ──► Arming (lazy-load Parakeet + VAD if cold)
                             │
                             ▼
                         Recording (cpal thread → ring buffer; emits voice:level)
                             │
                             ▼ voice_end OR VAD detects end-of-speech
                         Transcribing (sherpa batch)
                             │
                             ▼
                         Formatting (FormatterProvider.format(text, mode, context))
                             │
                             ▼
                         Emitting
                         ├── Dictation: voice/injection.rs paste + history row
                         ├── Dispatch : agent_commands::create_session + toast + history row
                         └── ChatMic  : emit voice:transcript (frontend inserts into Lexical)
                             │
                             ▼
                         Idle
```

State lives in `Arc<Mutex<PipelineState>>` in Tauri managed state. Standard `std::sync::Mutex` (not tokio RwLock) because sherpa-rs STT is blocking I/O. All Tauri commands use `spawn_blocking` when they touch the mutex during STT/formatter calls.

Cancel (Esc) is always honored — aborts immediately from any non-Idle state, restores clipboard if mid-inject, hides HUD, does not write a history row.

## Feature detail

### Hotkey manager (ported)

Source: `voiceflow/platform/tauri/src-tauri/src/hotkey/{manager,event_tap,config}.rs` → `solo/apps/desktop/src-tauri/src/voice/hotkey.rs`.

- CGEvent tap at `kCGSessionEventTap`, filtering KeyDown, KeyUp, FlagsChanged.
- Dedicated thread owning a private `CFRunLoop`.
- `Arc<RwLock<ShortcutsConfig>>` holds three bindings: `dictation_ptt`, `dispatch_ptt`, `cancel`.
- Defaults: `Fn`, `⌃⌥Space`, `Esc`. User-configurable in Voice settings, re-registered live on change.
- Events pass through unconsumed when they don't match a binding.
- On match: KeyDown → `voice_commands::begin(mode)`; KeyUp → `voice_commands::end()`.
- Permission: **Input Monitoring** (prompted on first voice enable via `tauri-plugin-macos-permissions`).

### Text injection (ported)

Source: `voiceflow/.../injection/text.rs` → `solo/apps/desktop/src-tauri/src/voice/injection.rs`.

`inject_text(text: &str)`:

1. Read current clipboard via `NSPasteboard` (save)
2. Write `text` via `NSPasteboard`
3. `CGEventPost` synthesized `⌘V` down + up
4. Sleep 80 ms for paste to land
5. Restore saved clipboard

Only used in Dictation mode. Permission: **Accessibility** — prompted on first dictation attempt. If denied, dictation is disabled with a banner in Voice settings; dispatch continues to work.

On `CGEventPost` failure: toast "Paste failed — text copied to clipboard, paste manually." The user's dictated text is already on the clipboard from step 2, so manual paste succeeds.

### App monitor (ported)

Source: `voiceflow/.../context/app_monitor.rs` → `solo/apps/desktop/src-tauri/src/voice/app_monitor.rs`.

Uses `NSWorkspace.frontmostApplication`. No permission required. Polled at 200 ms while pipeline state is Arming or Recording. Returned data: `{ bundle_id, app_name, window_title }`.

Fed into formatter prompt as context: `"User is currently in app: <bundle_id>. Apply appropriate formatting."` Stored on `VoiceTranscriptResult.target_app_*` for history.

### HUD window (new)

- Second Tauri window defined in `tauri.conf.json` (`label: "voice-hud"`), `transparent: true`, `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`, `focus: false`, `visible: false`.
- Entry point: `apps/desktop/src/hud/hud.html` → `hud.tsx`. React renders the pill, subscribing to `voice:state` + `voice:level`.
- Rust manages show/hide/position via `voice/hud.rs`:
  - `show(mode)` → set window opacity, position near cursor, `show()`
  - `hide()` → `hide()`
  - Cursor-follow loop: spawned as a separate thread, runs at 60 Hz while visible. Calls `NSEvent.mouseLocation` via `objc2` crate (or equivalently `core-graphics::event::CGEvent::mouse_location`), and applies `window.set_position()` with a small offset of `(+16, +16)` px so the pill sits to the lower-right of the cursor.
- HUD renders three discrete looks by state:
  - Recording: pulse dot (white for dictation, green for dispatch) + 5-bar waveform driven by `voice:level`
  - Transcribing | Formatting: spinner replacing the dot, same label
  - Error: red dot, brief error text, auto-hide after 2 s

### Formatter

Trait:

```rust
pub struct AppContext {
    pub bundle_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
}

pub struct DictationOptions {
    pub strip_fillers: bool,
}

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
```

Default models per provider (hardcoded constants in `solo-voice/src/formatter.rs`; swappable without API changes):

| Provider | Constant | Default model |
|---|---|---|
| Claude | `DEFAULT_CLAUDE_FORMATTER_MODEL` | `claude-haiku-4-5` |
| Codex | `DEFAULT_CODEX_FORMATTER_MODEL` | `gpt-5-nano` |

Implementations:
- `ClaudeFormatter` — wraps Solo's existing Claude provider auth (`solo-auth::providers::claude`). Prompt cache enabled on the system prompt (the dictation/dispatch instructions don't change per-call — large cache-hit ratio).
- `CodexFormatter` — same pattern against OpenAI auth.
- `LocalLlamaFormatter` — `llama-cpp-rs` against `Llama-3.2-1B-Instruct-Q4_K_M.gguf`. Lazy-loads on first call; stays resident until app quit or user disables voice.

Provider selection: Voice settings radio — `Auto (cheapest from configured)` | `Claude Haiku` | `GPT-5 nano` | `Local Llama`. `Auto` picks Claude if authed, else Codex, else local (and errors into Voice settings if the local model isn't downloaded).

### Chat mic integration (Phase 1)

The mic button in `ChatInputContainer` calls `voice_commands::begin(mode: Dictation, target: ChatInput)`. The `target` tag suppresses the paste/dispatch tails — instead, the Emitting state emits `voice:transcript` only. `useVoiceInput` subscribes and inserts the formatted text at the Lexical cursor. No HUD for this surface (the mic button's own pulse signals state).

### Dictation flow (Phase 2)

See state machine above. End-to-end example: user in Slack holds `Fn` → hotkey tap fires → `voice_commands::begin(Dictation)` → HUD shows white pill at cursor → audio streams → user releases `Fn` → sherpa transcribes → Claude Haiku formats with dictation prompt + Slack-app-context → clipboard saved → formatted text pasted → clipboard restored → HUD hides → history row inserted.

### Dispatch flow (Phase 3)

User in Arc holds `⌃⌥Space` → HUD shows green pill → user speaks "refactor the auth module and add integration tests" → user releases → sherpa transcribes → Claude Haiku runs dispatch prompt, returns `{ title: "Refactor auth module", prompt: "<structured task>" }` → `agent_commands::create_session({ title, prompt, autoRun: true })` → dock badge increments → macOS notification "Agent dispatched: Refactor auth module" → history row written with `linked_session_id` → next time user focuses Solo, the new session panel auto-opens.

## Voice settings tab

Sections in order:

1. **Enable voice** master toggle. Off by default. Flipping on triggers permission prompts + prompts to download Parakeet if absent.
2. **Permissions** — three read-only indicators with `Grant` buttons (deep-link to System Settings panes):
   - Microphone
   - Input Monitoring (for hotkey tap)
   - Accessibility (for dictation paste only)
3. **Models**:
   - Parakeet TDT-0.6B — status + `Download` / `Remove`, progress bar
   - Local formatter (Llama-3.2-1B GGUF) — same UX; labeled `Optional — for offline formatting (~770 MB)`
4. **Formatter provider** — radio (`Auto` / `Claude Haiku` / `GPT-5 nano` / `Local Llama`)
5. **Shortcuts** — two recorder inputs + a cancel binding
6. **Behavior** — start/end chime, restore clipboard after paste, filler removal
7. **History** — searchable list of last N transcripts; per-row actions (copy, delete, "Open agent session" for dispatches)

## Model download

Model directory root: Solo's app data dir resolved via `AppHandle::path().app_data_dir()?` (on macOS, `~/Library/Application Support/com.solo.desktop/`), then `models/` subdirectory.

- **Parakeet**: `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8` from HuggingFace. ~250 MB. Downloaded via `reqwest` streaming to `<models>/parakeet-tdt-0.6b-v2.tmp`, SHA-256 verified against a manifest in `solo-voice/src/models.rs`, atomically renamed to `<models>/parakeet-tdt-0.6b-v2/`. HTTP `Range` for resume on interruption.
- **Local Llama (optional)**: `bartowski/Llama-3.2-1B-Instruct-GGUF`, Q4_K_M variant, ~770 MB. Downloaded to `<models>/llama-3.2-1b-instruct-q4km.gguf` with the same verify + atomic-rename pattern.
- **Progress**: `voice:model_progress` events drive the Voice settings progress bar.
- **Delivery**: HuggingFace direct. If rate-limiting becomes a real problem, mirror to S3/CloudFront later — no code change required if the manifest URLs are swappable.

## Error handling matrix

| Failure | User-facing response |
|---|---|
| Microphone permission denied | Voice stays disabled; Voice settings shows `Grant microphone` with System Settings deep-link |
| Input Monitoring denied | Hotkeys no-op silently; banner in Voice settings |
| Accessibility denied | Dictation disabled, dispatch unaffected; banner in Voice settings |
| Models not downloaded on `voice_begin` | Toast "Download models in Voice settings"; state → Error; pipeline never advances past Arming |
| sherpa init failure | Log full error, emit `voice:error`; toast suggests re-downloading |
| Formatter provider failure (Dictation) | Fall back to raw transcript — paste unformatted |
| Formatter provider failure (Dispatch) | Abort dispatch with toast; history row marked `failed` |
| Clipboard restore fails | Non-fatal; log warning |
| `CGEventPost` fails (paste) | Toast "Paste failed — text copied to clipboard, paste manually" (clipboard already contains the dictated text) |
| User presses Cancel during any stage | Abort, restore clipboard if mid-inject, hide HUD, no history row |

## Testing

### Unit (`solo-voice`)

- `formatter::prompt` snapshot tests for dictation and dispatch prompts across providers
- `pipeline` state-machine transitions using `MockStt` + `MockFormatter`
- `history` CRUD + migration tests (in-memory SQLite)
- `vad` regression against a 2-second fixture wav

### Integration (`apps/desktop/src-tauri/tests/`)

- `voice_dictation_happy_path.rs` — inject a sample wav directly into the pipeline (bypassing cpal), assert `voice:transcript` emitted with expected formatted text and history row written
- `voice_dispatch_creates_session.rs` — same setup, plus assert `agent_commands::create_session` was invoked with the structured `DispatchTask`

### Manual QA (added to `testing.md`)

- Dictation into: Slack, Notion, browser URL bar, Terminal, Solo's editor, Solo's chat input
- Dispatch from: Arc, Slack, Finder, an existing agent panel
- Cold-install permission flow
- Model download from cold — interrupt network mid-download, resume
- 30-second utterance without stall
- 5 rapid consecutive dictations without audio-resource leaks
- Cancel mid-Recording, mid-Transcribing, mid-Formatting

## Migration — ElevenLabs removal checklist

1. Delete `crates/solo-elevenlabs/`
2. Remove `solo-elevenlabs` from workspace `Cargo.toml` members
3. Drop elevenlabs state registration from `apps/desktop/src-tauri/src/lib.rs`
4. Delete `apps/desktop/src-tauri/src/elevenlabs_commands.rs` and strip from `generate_handler!`
5. Delete frontend: `stores/elevenlabsStore.ts`, `lib/tauri/elevenlabs.ts`, `lib/elevenlabs/`, existing `hooks/useVoiceInput.ts` (will be rewritten)
6. Strip elevenlabs keys from `settingsStore.ts`; add a one-shot migration that drops the `elevenlabs` key from persisted settings on first launch
7. Rewire `ChatInputContainer` and `components/agent/input/voice-button.tsx` against `voiceStore`
8. Regenerate bindings via `bun run gen:bindings`
9. Drop `tokio-tungstenite` and `base64` from root `Cargo.toml` if `cargo tree -i <dep>` shows no other consumer
10. Update `solo/CLAUDE.md` references from `solo-elevenlabs` to `solo-voice`

## Phasing

- **Phase 1 — pipeline + chat mic.** Section A crates/protocol, `solo-voice` end-to-end, chat mic rewired, ElevenLabs fully removed, Voice settings tab (enable + models + permissions + history). No hotkeys, no HUD, no dispatch. First shippable milestone.
- **Phase 2 — global dictation.** Hotkey tap, text injection, app monitor, cursor-pill HUD, dictation hotkey binding + Voice settings shortcut recorder. VoiceFlow-parity.
- **Phase 3 — agent dispatch.** Dispatch hotkey, dispatch-prompt formatter variant, silent-spawn + toast + dock badge + sidebar-row + auto-pop-on-focus flow, history-to-session linking.

## Decisions locked during brainstorming

| # | Decision |
|---|---|
| 1 | Product shape: all three surfaces layered (chat mic, dictation, dispatch) |
| 2 | Hotkey behavior: two hotkeys (dictation + dispatch) |
| 3 | STT backend: sherpa-onnx + Parakeet TDT-0.6B int8, batch (no streaming) |
| 4 | Formatter default: cheapest/fastest from configured provider (Claude Haiku preferred) |
| 5 | Local formatter: Llama-3.2-1B GGUF, opt-in download |
| 6 | Fan-out: one voice = one agent in v1 |
| 7 | Platform: macOS-only v1, trait-based portability for later |
| 8 | HUD: single cursor-pill, color/label per mode |
| 9 | Dispatch focus: silent spawn, toast + dock badge |
| 10 | Session visibility: sidebar row + auto-pop on first Solo focus |
| 11 | Transcript history: SQLite in Solo's app data dir |
| 12 | Model download: explicit opt-in via Voice settings |
| 13 | Crates: `solo-voice` + `voice_commands.rs`; ElevenLabs fully removed |
| 14 | Phasing: P1 pipeline+chat, P2 dictation, P3 dispatch |

## Open questions for the implementation plan

None. All ambiguities resolved during brainstorming.
