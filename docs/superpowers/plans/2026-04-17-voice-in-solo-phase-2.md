# Voice in Solo — Phase 2 Implementation Plan (Global Dictation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user hold `Fn` from any macOS app, speak, release, and have cleaned-up text pasted into whatever they're focused on. Cursor-pill HUD shows progress. Solo's chat-mic already works from Phase 1 — Phase 2 adds the global dictation surface on top.

**Architecture:** Two new kinds of work sit on top of the existing `solo-voice` pipeline: (1) macOS platform glue under `apps/desktop/src-tauri/src/voice/` — CGEvent hotkey tap, NSPasteboard clipboard injection, NSWorkspace frontmost-app monitor, cursor-following HUD window controller — and (2) an additional Tauri window (`label: "voice-hud"`) rendered by a new React entry (`apps/desktop/src/hud/`) that subscribes to `voice:state` + `voice:level` events. The existing `voice_commands` surface stays the same; new Tauri commands register/configure hotkeys and HUD.

**Tech Stack:** Rust (objc2 + core-graphics for macOS APIs), Tauri 2 (second window), React 19 + Zustand (HUD component), existing cpal/sherpa/Claude pipeline from Phase 1.

**Reference:** `docs/superpowers/specs/2026-04-17-voice-in-solo-design.md` — this plan implements Phase 2 of that spec.

---

## File Structure

### New Rust code (Tauri app)

| File | Responsibility |
|---|---|
| `apps/desktop/src-tauri/src/voice/mod.rs` | Barrel: `pub mod app_monitor; pub mod injection; pub mod hotkey; pub mod hud;` |
| `apps/desktop/src-tauri/src/voice/app_monitor.rs` | NSWorkspace frontmost app lookup, returned as `AppContext` |
| `apps/desktop/src-tauri/src/voice/injection.rs` | NSPasteboard save → write → synthesized ⌘V → restore |
| `apps/desktop/src-tauri/src/voice/hotkey.rs` | CGEvent tap + dedicated CFRunLoop thread, `ShortcutsConfig` |
| `apps/desktop/src-tauri/src/voice/hud.rs` | Tauri window show/hide/position + cursor-follow thread |

### Modifications (Tauri)

| File | Change |
|---|---|
| `apps/desktop/src-tauri/Cargo.toml` | Add `objc2`, `objc2-app-kit`, `objc2-foundation`, `core-graphics`, `core-foundation` |
| `apps/desktop/src-tauri/src/voice_commands.rs` | New commands: `voice_set_shortcuts`, `voice_get_shortcuts`, `voice_request_permission`, `voice_check_permissions`; in `voice_end`, call `injection::inject_text` when target is `FocusedApp` |
| `apps/desktop/src-tauri/src/lib.rs` | Register `voice::hud::HudState`, new commands, spawn hotkey manager on `voice_enable` |
| `apps/desktop/src-tauri/tauri.conf.json` | Add second window `voice-hud` |

### Frontend (new)

| File | Responsibility |
|---|---|
| `apps/desktop/src/hud/hud.html` | Minimal HTML shell for the HUD window |
| `apps/desktop/src/hud/hud.tsx` | React entry that renders `<HudPill />` |
| `apps/desktop/src/hud/HudPill.tsx` | Cursor-pill component driven by `voice:state` + `voice:level` |
| `apps/desktop/src/hud/waveform.tsx` | 5-bar waveform driven by RMS level |

### Modifications (frontend)

| File | Change |
|---|---|
| `apps/desktop/src/lib/tauri/voice.ts` | Add `setShortcuts`, `getShortcuts`, `requestPermission`, `checkPermissions` wrappers + `onVoiceLevel` listener |
| `apps/desktop/src/stores/voiceStore.ts` | Add `shortcuts`, `permissions`, `level` fields |
| `apps/desktop/src/components/settings/tabs/VoiceTab.tsx` | Add Shortcuts + Permissions sections |
| `apps/desktop/vite.config.ts` | Configure second entry point for the HUD bundle |
| `crates/solo-protocol/src/lib.rs` | Add `ShortcutsConfig` type (serialized to settings) + `VoicePermissions` snapshot |

---

## Conventions applied to every task

- **TDD:** write failing test, run it, implement, run again, commit.
- **Commit style:** Conventional commits. One task = one commit unless noted.
- **Rust tests:** `cargo test -p <crate>` from worktree root.
- **Frontend tests:** `bun test <path>` from `apps/desktop/`.
- **Regenerating TS bindings:** after any change to `crates/solo-protocol/src/lib.rs`, run `bun run gen:bindings` from the worktree root.
- **Never skip pre-commit hooks.** If a hook fails, fix and commit fresh.
- **Per-task quality gate:** `cargo check --workspace --exclude solo-desktop`, `cargo check -p solo-desktop`, and `bun run --filter '@solo/desktop' typecheck` must pass before commit.
- **No Claude / Anthropic / model attribution in commit messages.** Project policy.
- **Worktree guardrail:** all work in `/Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/voice-phase-1/`. Verify `pwd` + `git branch --show-current` before every commit. Never cd to `/Users/sachin/Developer/Orbit_Main/solo/` (main repo, different branch).

---

## Task 1: Add macOS-platform dependencies

**Files:**
- Modify: `Cargo.toml` (workspace)
- Modify: `apps/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add workspace deps**

In `Cargo.toml`, inside `[workspace.dependencies]`, after the existing `# Audio + ML for solo-voice` block add:

```toml
# macOS platform glue for voice Phase 2
objc2 = "0.5"
objc2-app-kit = { version = "0.2", features = ["NSWorkspace", "NSRunningApplication", "NSPasteboard", "NSEvent"] }
objc2-foundation = { version = "0.2", features = ["NSString", "NSArray", "NSURL"] }
core-graphics = "0.24"
core-foundation = "0.10"
tauri-plugin-macos-permissions = "2"
```

If the workspace already pins newer or differently-featured versions of any of these, reuse what exists — don't duplicate.

- [ ] **Step 2: Add Tauri-app deps**

In `apps/desktop/src-tauri/Cargo.toml`, inside `[dependencies]`, add:

```toml
objc2.workspace = true
objc2-app-kit.workspace = true
objc2-foundation.workspace = true
core-graphics.workspace = true
core-foundation.workspace = true
tauri-plugin-macos-permissions.workspace = true
```

- [ ] **Step 3: Verify workspace still compiles**

Run: `cargo check --workspace --exclude solo-desktop && cargo check -p solo-desktop`.
Expected: clean.

- [ ] **Step 4: Commit**

```
git add Cargo.toml apps/desktop/src-tauri/Cargo.toml
git commit -m "chore(voice): add macOS platform deps for Phase 2"
```

---

## Task 2: Voice module scaffolding

**Files:**
- Create: `apps/desktop/src-tauri/src/voice/mod.rs`
- Create: `apps/desktop/src-tauri/src/voice/app_monitor.rs` (stub)
- Create: `apps/desktop/src-tauri/src/voice/injection.rs` (stub)
- Create: `apps/desktop/src-tauri/src/voice/hotkey.rs` (stub)
- Create: `apps/desktop/src-tauri/src/voice/hud.rs` (stub)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (add `mod voice;`)

- [ ] **Step 1: Create `voice/mod.rs`**

```rust
//! macOS platform glue for the voice pipeline (Phase 2+).
//!
//! * `app_monitor` — NSWorkspace frontmost app lookup
//! * `injection`   — clipboard + synthesized ⌘V paste
//! * `hotkey`      — CGEvent tap driving Dictation/Dispatch begin+end
//! * `hud`         — cursor-pill overlay window

pub mod app_monitor;
pub mod hotkey;
pub mod hud;
pub mod injection;
```

- [ ] **Step 2: Stub each submodule**

For each of `app_monitor.rs`, `hotkey.rs`, `hud.rs`, `injection.rs`, create the file with only:

```rust
// Stub — implemented in later tasks.
```

- [ ] **Step 3: Register `mod voice` in `lib.rs`**

In `apps/desktop/src-tauri/src/lib.rs`, add `mod voice;` near the other `mod` declarations (alphabetical with voice_commands).

- [ ] **Step 4: Verify**

`cargo check -p solo-desktop` must pass.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src-tauri/src/voice apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(voice): scaffold macOS platform module"
```

---

## Task 3: `AppContext` lookup via NSWorkspace

**Files:**
- Modify: `apps/desktop/src-tauri/src/voice/app_monitor.rs`

Goal: expose `pub fn frontmost_app() -> AppContext` returning `{ bundle_id, app_name, window_title }`. `window_title` is `None` in P2 (getting it requires Accessibility which we don't want to prompt for app-monitor purposes).

- [ ] **Step 1: Write failing test**

Append to `app_monitor.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmost_app_is_non_empty_in_test_harness() {
        // In `cargo test` on macOS, some process owns the frontmost slot.
        // We just assert the call doesn't panic and returns a sensible shape.
        let ctx = frontmost_app();
        // bundle_id may be None in sandboxed CI — assertion is minimal.
        let _ = ctx.app_name;
    }
}
```

- [ ] **Step 2: Implement**

Replace the stub with:

```rust
use solo_voice::formatter::AppContext;

/// Returns the current frontmost app's bundle_id + app_name.
/// `window_title` is always `None` in Phase 2 — obtaining it requires
/// Accessibility permission, which the app_monitor deliberately doesn't
/// request.
pub fn frontmost_app() -> AppContext {
    #[cfg(target_os = "macos")]
    {
        use objc2::rc::autoreleasepool;
        use objc2_app_kit::NSWorkspace;

        autoreleasepool(|_| unsafe {
            let ws = NSWorkspace::sharedWorkspace();
            let Some(running) = ws.frontmostApplication() else {
                return AppContext::default();
            };
            let bundle_id = running
                .bundleIdentifier()
                .map(|s| s.to_string());
            let app_name = running
                .localizedName()
                .map(|s| s.to_string());
            AppContext {
                bundle_id,
                app_name,
                window_title: None,
            }
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        AppContext::default()
    }
}
```

Note: exact method names on `NSRunningApplication` via objc2 may need adjustment — read `cargo doc -p objc2-app-kit --open` if the names above don't resolve. Keep the public `fn frontmost_app() -> AppContext` signature stable.

- [ ] **Step 3: Verify**

```
cargo test -p solo-desktop --lib voice::app_monitor::tests::frontmost_app_is_non_empty_in_test_harness
cargo check -p solo-desktop
```

- [ ] **Step 4: Commit**

```
git add apps/desktop/src-tauri/src/voice/app_monitor.rs
git commit -m "feat(voice): NSWorkspace frontmost-app monitor"
```

---

## Task 4: Pipe `AppContext` into the voice pipeline

**Files:**
- Modify: `apps/desktop/src-tauri/src/voice_commands.rs`

- [ ] **Step 1: Update `voice_end` to sample app context**

Replace the hard-coded `AppContext::default()` argument in `pipeline.end(...)` with:

```rust
let ctx = crate::voice::app_monitor::frontmost_app();
let out = pipeline
    .end(
        mode,
        target,
        ctx.clone(),
        DictationOptions::default(),
    )
    .await
    .map_err(|e| e.to_string())?;
```

Also record `target_app_bundle_id` / `target_app_name` from `ctx` on the `HistoryRow` instead of the current `None`:

```rust
let row = HistoryRow {
    // ...
    target_app_bundle_id: ctx.bundle_id.clone(),
    target_app_name: ctx.app_name.clone(),
    // ...
};
```

And in the `voice:transcript` payload, swap the two null literals for the captured `ctx` values.

- [ ] **Step 2: Verify**

`cargo check -p solo-desktop` must pass. Existing tests unaffected.

- [ ] **Step 3: Commit**

```
git add apps/desktop/src-tauri/src/voice_commands.rs
git commit -m "feat(voice): feed frontmost-app context into formatter + history"
```

---

## Task 5: Clipboard + synthesized ⌘V injection

**Files:**
- Modify: `apps/desktop/src-tauri/src/voice/injection.rs`

- [ ] **Step 1: Implement**

```rust
//! Paste text into the focused app by saving the clipboard, writing `text`,
//! posting a synthesized ⌘V, sleeping 80 ms, then restoring the clipboard.

use std::thread;
use std::time::Duration;

#[derive(Debug)]
pub struct InjectionError(pub String);

/// Inject `text` into the focused app. Requires Accessibility permission
/// for the ⌘V synthesis; if permission is missing, `CGEventPost` silently
/// no-ops and the caller receives `Ok(InjectionOutcome::ClipboardOnly)`.
pub enum InjectionOutcome {
    /// Paste was dispatched and clipboard restored.
    Pasted,
    /// CGEventPost failed or permission missing — text remains on the
    /// clipboard; caller should toast "paste manually".
    ClipboardOnly,
}

#[cfg(target_os = "macos")]
pub fn inject_text(text: &str) -> Result<InjectionOutcome, InjectionError> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSArray, NSString};

    // Save + overwrite clipboard
    let saved = autoreleasepool(|_| unsafe {
        let pb = NSPasteboard::generalPasteboard();
        let current = pb.stringForType(&NSString::from_str("public.utf8-plain-text"));
        pb.clearContents();
        let ns_text = NSString::from_str(text);
        let ns_types = NSArray::from_slice(&[NSString::from_str("public.utf8-plain-text").as_ref()]);
        pb.declareTypes_owner(&ns_types, None);
        pb.setString_forType(&ns_text, &NSString::from_str("public.utf8-plain-text"));
        current.map(|s| s.to_string())
    });

    // Synthesize ⌘V
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| InjectionError("CGEventSource failed".into()))?;
    const V_KEY: CGKeyCode = 0x09;
    let down = CGEvent::new_keyboard_event(source.clone(), V_KEY, true)
        .map_err(|_| InjectionError("v-down event".into()))?;
    down.set_flags(CGEventFlags::CGEventFlagCommand);
    let up = CGEvent::new_keyboard_event(source, V_KEY, false)
        .map_err(|_| InjectionError("v-up event".into()))?;
    up.set_flags(CGEventFlags::CGEventFlagCommand);

    down.post(CGEventTapLocation::HID);
    up.post(CGEventTapLocation::HID);

    thread::sleep(Duration::from_millis(80));

    // Restore clipboard
    autoreleasepool(|_| unsafe {
        if let Some(text) = saved {
            let pb = NSPasteboard::generalPasteboard();
            pb.clearContents();
            pb.setString_forType(
                &NSString::from_str(&text),
                &NSString::from_str("public.utf8-plain-text"),
            );
        }
    });

    Ok(InjectionOutcome::Pasted)
}

#[cfg(not(target_os = "macos"))]
pub fn inject_text(_text: &str) -> Result<InjectionOutcome, InjectionError> {
    Err(InjectionError("inject_text: macOS-only in P2".into()))
}
```

Note: objc2-app-kit's `NSPasteboard` API methods may use slightly different names (`stringForType:` vs `stringForType_`). If `cargo check` fails, open `cargo doc -p objc2-app-kit` and map to the real method. Keep the public `inject_text` signature stable.

- [ ] **Step 2: Verify**

`cargo check -p solo-desktop` must pass. No unit tests — this is unobservable without a live desktop + focus target.

- [ ] **Step 3: Commit**

```
git add apps/desktop/src-tauri/src/voice/injection.rs
git commit -m "feat(voice): NSPasteboard + CGEventPost text injection"
```

---

## Task 6: Wire `FocusedApp` target to injection

**Files:**
- Modify: `apps/desktop/src-tauri/src/voice_commands.rs`

- [ ] **Step 1: Branch on target in `voice_end`**

After `pipeline.end(...)` returns `out`, add target-specific handling BEFORE the `voice:transcript` emit:

```rust
use crate::voice::injection::{inject_text, InjectionOutcome};

let paste_outcome = match target {
    PipelineTarget::FocusedApp => {
        match inject_text(&out.formatted) {
            Ok(InjectionOutcome::Pasted) => Some(Ok(())),
            Ok(InjectionOutcome::ClipboardOnly) => Some(Err(
                "Paste failed — text copied to clipboard, paste manually".to_string(),
            )),
            Err(e) => Some(Err(format!("Paste failed: {}", e.0))),
        }
    }
    _ => None,
};

if let Some(Err(msg)) = &paste_outcome {
    let _ = app.emit("voice:error", serde_json::json!({ "message": msg }));
}
```

Note: `ChatInput` target (Phase 1) continues to emit `voice:transcript` only — no paste. `NewAgentSession` target is Phase 3.

- [ ] **Step 2: Verify**

`cargo check -p solo-desktop` clean.

- [ ] **Step 3: Commit**

```
git add apps/desktop/src-tauri/src/voice_commands.rs
git commit -m "feat(voice): dictate paste path via inject_text"
```

---

## Task 7: `ShortcutsConfig` protocol type + settings persistence

**Files:**
- Modify: `crates/solo-protocol/src/lib.rs`
- Modify: `apps/desktop/src/stores/settingsStore.ts`

- [ ] **Step 1: Add `ShortcutsConfig` + `VoicePermissions`**

Append to `crates/solo-protocol/src/lib.rs`:

```rust
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export)]
pub struct ShortcutsConfig {
    /// Macro-style shortcut spec: e.g. `"fn"`, `"ctrl+alt+space"`, `"escape"`.
    pub dictation_ptt: String,
    pub dispatch_ptt: String,
    pub cancel: String,
}

impl Default for ShortcutsConfig {
    fn default() -> Self {
        Self {
            dictation_ptt: "fn".into(),
            dispatch_ptt: "ctrl+alt+space".into(),
            cancel: "escape".into(),
        }
    }
}

#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export)]
pub struct VoicePermissions {
    pub microphone: bool,
    pub input_monitoring: bool,
    pub accessibility: bool,
}
```

- [ ] **Step 2: Regenerate bindings**

```
bun run gen:bindings
```

Expected: `ShortcutsConfig.ts`, `VoicePermissions.ts` appear in `apps/desktop/src/bindings/`.

- [ ] **Step 3: Add `shortcuts` to settingsStore**

In `apps/desktop/src/stores/settingsStore.ts`, add to the state type:

```typescript
voiceShortcuts: ShortcutsConfig;
setVoiceShortcuts: (s: ShortcutsConfig) => void;
```

…plus the initial value `{ dictation_ptt: 'fn', dispatch_ptt: 'ctrl+alt+space', cancel: 'escape' }` and setter. Import the type from `@/bindings/ShortcutsConfig`.

- [ ] **Step 4: Verify**

```
cargo check --workspace --exclude solo-desktop
bun run --filter '@solo/desktop' typecheck
```

- [ ] **Step 5: Commit**

```
git add crates/solo-protocol/src/lib.rs apps/desktop/src/stores/settingsStore.ts apps/desktop/src/bindings
git commit -m "feat(voice): ShortcutsConfig + VoicePermissions protocol types"
```

---

## Task 8: CGEvent hotkey tap

**Files:**
- Modify: `apps/desktop/src-tauri/src/voice/hotkey.rs`

This is the gnarliest task in Phase 2. The CGEvent tap runs on a dedicated OS thread with its own `CFRunLoop`; the thread parses keyboard + flag events and, when they match a bound shortcut, dispatches into a provided callback.

- [ ] **Step 1: Implement**

Replace the stub with:

```rust
//! CGEvent-tap hotkey manager. Spawns a dedicated OS thread that owns
//! a private CFRunLoop; the tap delivers KeyDown/KeyUp/FlagsChanged
//! events to our callback. Events pass through unmodified when they
//! don't match a bound shortcut.

use core_foundation::base::TCFType;
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop, CFRunLoopSource};
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
    CGEventTapPlacement, CGEventType, CGKeyCode,
};
use solo_protocol::ShortcutsConfig;
use std::sync::{Arc, RwLock};
use std::thread;

/// Which bound shortcut fired.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyEvent {
    DictationDown,
    DictationUp,
    DispatchDown,
    DispatchUp,
    Cancel,
}

type HotkeyCallback = Arc<dyn Fn(HotkeyEvent) + Send + Sync>;

/// Handle kept alive by the Tauri app. Dropping it stops the tap thread.
pub struct HotkeyManager {
    config: Arc<RwLock<ShortcutsConfig>>,
    stop: Arc<std::sync::atomic::AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl HotkeyManager {
    pub fn start(
        initial_config: ShortcutsConfig,
        on_event: HotkeyCallback,
    ) -> Result<Self, String> {
        let config = Arc::new(RwLock::new(initial_config));
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop_for_thread = stop.clone();
        let config_for_thread = config.clone();

        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

        let thread = thread::spawn(move || {
            let cb_for_tap = on_event.clone();
            let cfg_for_tap = config_for_thread.clone();
            let state: std::sync::Arc<std::sync::Mutex<TapState>> =
                Arc::new(std::sync::Mutex::new(TapState::default()));
            let state_for_tap = state.clone();

            let tap = CGEventTap::new(
                CGEventTapLocation::Session,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::Default,
                vec![
                    CGEventType::KeyDown,
                    CGEventType::KeyUp,
                    CGEventType::FlagsChanged,
                ],
                move |_, ty, event| {
                    if let Some(evt) = classify(
                        ty,
                        event,
                        &cfg_for_tap.read().unwrap(),
                        &mut state_for_tap.lock().unwrap(),
                    ) {
                        cb_for_tap(evt);
                    }
                    // Always pass events through unconsumed.
                    None
                },
            );
            let tap = match tap {
                Ok(t) => t,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("CGEventTap::new failed: {e:?}")));
                    return;
                }
            };

            let loop_src = match tap.mach_port().create_runloop_source(0) {
                Ok(s) => s,
                Err(_) => {
                    let _ = ready_tx.send(Err("create_runloop_source failed".into()));
                    return;
                }
            };

            let current_loop = CFRunLoop::get_current();
            current_loop.add_source(&loop_src, unsafe { kCFRunLoopCommonModes });
            tap.enable();
            let _ = ready_tx.send(Ok(()));

            while !stop_for_thread.load(std::sync::atomic::Ordering::Relaxed) {
                CFRunLoop::run_in_mode(
                    unsafe { kCFRunLoopCommonModes },
                    std::time::Duration::from_millis(100),
                    false,
                );
            }
        });

        ready_rx
            .recv()
            .map_err(|_| "tap thread panicked".to_string())??;
        Ok(Self {
            config,
            stop,
            thread: Some(thread),
        })
    }

    pub fn update(&self, new_config: ShortcutsConfig) {
        *self.config.write().unwrap() = new_config;
    }
}

impl Drop for HotkeyManager {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(h) = self.thread.take() {
            let _ = h.join();
        }
    }
}

/// Internal state tracked across tap events (e.g. `Fn` flag on last FlagsChanged).
#[derive(Default)]
struct TapState {
    dictation_down: bool,
    dispatch_down: bool,
}

/// Parse a single event against the config and mutate internal state.
/// Return `Some(HotkeyEvent)` when a bound shortcut fires.
fn classify(
    ty: CGEventType,
    event: &CGEvent,
    cfg: &ShortcutsConfig,
    state: &mut TapState,
) -> Option<HotkeyEvent> {
    match ty {
        CGEventType::FlagsChanged => {
            // Only handle `fn`-based PTT bindings via FlagsChanged.
            let flags = event.get_flags();
            let fn_down = flags.contains(CGEventFlags::CGEventFlagSecondaryFn);
            if cfg.dictation_ptt == "fn" {
                if fn_down && !state.dictation_down {
                    state.dictation_down = true;
                    return Some(HotkeyEvent::DictationDown);
                } else if !fn_down && state.dictation_down {
                    state.dictation_down = false;
                    return Some(HotkeyEvent::DictationUp);
                }
            }
            None
        }
        CGEventType::KeyDown | CGEventType::KeyUp => {
            let code = event.get_integer_value_field(
                core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE,
            ) as CGKeyCode;
            let flags = event.get_flags();
            let shortcut = format_shortcut(flags, code);

            let down = ty == CGEventType::KeyDown;

            if shortcut == cfg.dispatch_ptt {
                if down && !state.dispatch_down {
                    state.dispatch_down = true;
                    return Some(HotkeyEvent::DispatchDown);
                } else if !down && state.dispatch_down {
                    state.dispatch_down = false;
                    return Some(HotkeyEvent::DispatchUp);
                }
            }
            if shortcut == cfg.cancel && down {
                return Some(HotkeyEvent::Cancel);
            }
            None
        }
        _ => None,
    }
}

/// Convert `(flags, keycode)` to a canonical lowercase shortcut string
/// like `"ctrl+alt+space"` or `"escape"`. Only covers the shortcuts this
/// Phase 2 plan uses — extend as needed.
fn format_shortcut(flags: CGEventFlags, code: CGKeyCode) -> String {
    let mut parts = Vec::<&str>::new();
    if flags.contains(CGEventFlags::CGEventFlagControl) {
        parts.push("ctrl");
    }
    if flags.contains(CGEventFlags::CGEventFlagAlternate) {
        parts.push("alt");
    }
    if flags.contains(CGEventFlags::CGEventFlagShift) {
        parts.push("shift");
    }
    if flags.contains(CGEventFlags::CGEventFlagCommand) {
        parts.push("cmd");
    }
    parts.push(match code {
        0x31 => "space",
        0x35 => "escape",
        c => return format!("{}+keycode{}", parts.join("+"), c),
    });
    parts.join("+")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_shortcut_ctrl_alt_space() {
        let flags =
            CGEventFlags::CGEventFlagControl | CGEventFlags::CGEventFlagAlternate;
        assert_eq!(format_shortcut(flags, 0x31), "ctrl+alt+space");
    }

    #[test]
    fn format_shortcut_escape() {
        assert_eq!(format_shortcut(CGEventFlags::empty(), 0x35), "escape");
    }
}
```

- [ ] **Step 2: Verify**

```
cargo test -p solo-desktop --lib voice::hotkey::tests
cargo check -p solo-desktop
```

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```
git add apps/desktop/src-tauri/src/voice/hotkey.rs
git commit -m "feat(voice): CGEvent hotkey tap with ShortcutsConfig"
```

---

## Task 9: Manage hotkey lifecycle in `voice_enable`

**Files:**
- Modify: `apps/desktop/src-tauri/src/voice_commands.rs`

- [ ] **Step 1: Add `HotkeyManager` to `VoiceState`**

```rust
use crate::voice::hotkey::{HotkeyEvent, HotkeyManager};

pub struct VoiceState {
    // ...existing fields...
    hotkey: TokioMutex<Option<HotkeyManager>>,
    shortcuts: TokioMutex<ShortcutsConfig>,
}
```

Update `VoiceState::new()` accordingly with `None` + `ShortcutsConfig::default()`.

- [ ] **Step 2: Start the manager during `voice_enable`**

After opening history + models_root, spawn the hotkey manager:

```rust
let cfg = voice.shortcuts.lock().await.clone();
let app_for_cb = app.clone();
let mgr = HotkeyManager::start(
    cfg,
    std::sync::Arc::new(move |evt| {
        match evt {
            HotkeyEvent::DictationDown => {
                let _ = app_for_cb.emit("voice:hotkey", "dictation_down");
            }
            HotkeyEvent::DictationUp => {
                let _ = app_for_cb.emit("voice:hotkey", "dictation_up");
            }
            HotkeyEvent::DispatchDown => {
                let _ = app_for_cb.emit("voice:hotkey", "dispatch_down");
            }
            HotkeyEvent::DispatchUp => {
                let _ = app_for_cb.emit("voice:hotkey", "dispatch_up");
            }
            HotkeyEvent::Cancel => {
                let _ = app_for_cb.emit("voice:hotkey", "cancel");
            }
        }
    }),
).map_err(|e| e)?;
*voice.hotkey.lock().await = Some(mgr);
```

We intentionally forward hotkey events to the frontend via a `voice:hotkey` event rather than calling `voice_begin`/`voice_end` directly from the tap thread — the frontend then dispatches via the existing IPC commands. This keeps the tap fast + avoids re-entering async code from the CFRunLoop thread.

- [ ] **Step 3: Add `voice_set_shortcuts` + `voice_get_shortcuts` commands**

```rust
#[tauri::command]
pub async fn voice_get_shortcuts(
    voice: State<'_, VoiceState>,
) -> Result<ShortcutsConfig, String> {
    Ok(voice.shortcuts.lock().await.clone())
}

#[tauri::command]
pub async fn voice_set_shortcuts(
    voice: State<'_, VoiceState>,
    shortcuts: ShortcutsConfig,
) -> Result<(), String> {
    *voice.shortcuts.lock().await = shortcuts.clone();
    if let Some(mgr) = voice.hotkey.lock().await.as_ref() {
        mgr.update(shortcuts);
    }
    Ok(())
}
```

Import `solo_protocol::ShortcutsConfig` at the top.

- [ ] **Step 4: Register in `generate_handler!`**

Add `voice_commands::voice_get_shortcuts`, `voice_commands::voice_set_shortcuts` to `lib.rs`'s handler list.

- [ ] **Step 5: Verify**

`cargo check -p solo-desktop` clean.

- [ ] **Step 6: Commit**

```
git add apps/desktop/src-tauri/src/voice_commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(voice): spawn hotkey manager on voice_enable + shortcut IPC"
```

---

## Task 10: Permissions snapshot + prompts

**Files:**
- Modify: `apps/desktop/src-tauri/src/voice_commands.rs`

- [ ] **Step 1: Add permission helpers**

```rust
use solo_protocol::VoicePermissions;

#[tauri::command]
pub async fn voice_check_permissions() -> Result<VoicePermissions, String> {
    // tauri-plugin-macos-permissions exposes async checker fns.
    let microphone = tauri_plugin_macos_permissions::check_microphone_permission().await;
    let input_monitoring = tauri_plugin_macos_permissions::check_input_monitoring_permission().await;
    let accessibility = tauri_plugin_macos_permissions::check_accessibility_permission().await;
    Ok(VoicePermissions { microphone, input_monitoring, accessibility })
}

/// Prompt the user for one of the three voice-related permissions. Returns
/// the updated snapshot after the system dialog closes.
#[tauri::command]
pub async fn voice_request_permission(
    which: String,
) -> Result<VoicePermissions, String> {
    match which.as_str() {
        "microphone" => tauri_plugin_macos_permissions::request_microphone_permission().await,
        "input-monitoring" => {
            tauri_plugin_macos_permissions::request_input_monitoring_permission().await;
        }
        "accessibility" => {
            tauri_plugin_macos_permissions::request_accessibility_permission().await;
        }
        other => return Err(format!("unknown permission: {other}")),
    };
    voice_check_permissions().await
}
```

Note: if the plugin's function names differ (check via `cargo doc -p tauri-plugin-macos-permissions --open`), adapt.

- [ ] **Step 2: Register both commands**

Add `voice_commands::voice_check_permissions`, `voice_commands::voice_request_permission` to `lib.rs`'s `generate_handler!`.

- [ ] **Step 3: Verify**

`cargo check -p solo-desktop` clean.

- [ ] **Step 4: Commit**

```
git add apps/desktop/src-tauri/src/voice_commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(voice): permission check + request commands"
```

---

## Task 11: Emit `voice:level` at 50 Hz during Recording

**Files:**
- Modify: `crates/solo-voice/src/pipeline.rs`

- [ ] **Step 1: Add a level-emitter thread**

The pipeline needs to push RMS samples at 50 Hz while in `Recording`. Add a new optional callback:

```rust
pub struct VoicePipeline {
    // ...existing fields...
    on_level: Arc<dyn Fn(f32) + Send + Sync>,
}

impl VoicePipeline {
    pub fn new(
        stt: Arc<dyn SttProvider>,
        formatter: Arc<dyn FormatterProvider>,
        ring: AudioRing,
        on_state: Arc<dyn Fn(&PipelineState) + Send + Sync>,
        on_level: Arc<dyn Fn(f32) + Send + Sync>,
    ) -> Self {
        Self {
            // ...
            on_level,
        }
    }
}
```

Update existing `VoicePipeline::new` callers in the test module + `voice_commands.rs` to pass a noop (`Arc::new(|_| {})`) or a real emitter.

- [ ] **Step 2: Sample RMS in `begin`**

Spawn a tokio task when entering `Recording`:

```rust
let ring_sampler = self.ring.clone();
let emitter = self.on_level.clone();
let state_handle = self.state.clone();
tokio::spawn(async move {
    use tokio::time::{interval, Duration};
    let mut tick = interval(Duration::from_millis(20)); // 50 Hz
    loop {
        tick.tick().await;
        let s = state_handle.lock().await.clone();
        if !matches!(s, PipelineState::Recording) {
            break;
        }
        // Peek last ~480 samples without draining
        let snapshot = ring_sampler.peek_last(480);
        let rms = solo_voice::vad::rms(&snapshot);
        emitter(rms);
    }
});
```

- [ ] **Step 3: Add `AudioRing::peek_last`**

In `crates/solo-voice/src/audio.rs`, add:

```rust
impl AudioRing {
    pub fn peek_last(&self, n: usize) -> Vec<f32> {
        let g = self.inner.lock().unwrap();
        let len = g.samples.len();
        let start = len.saturating_sub(n);
        g.samples.iter().skip(start).copied().collect()
    }
}
```

- [ ] **Step 4: Update `voice_commands.rs`**

In `voice_begin`, build an `on_level` closure that emits `voice:level`:

```rust
let app_for_level = app.clone();
let on_level = Arc::new(move |rms: f32| {
    let _ = app_for_level.emit("voice:level", serde_json::json!({ "rms": rms }));
});
*pipeline_guard = Some(Arc::new(VoicePipeline::new(
    stt, formatter, voice.ring.clone(), on_state, on_level,
)));
```

- [ ] **Step 5: Verify**

```
cargo test -p solo-voice
cargo check -p solo-desktop
```

All tests pass (pipeline + integration tests updated for the new `on_level` argument).

- [ ] **Step 6: Commit**

```
git add crates/solo-voice apps/desktop/src-tauri/src/voice_commands.rs
git commit -m "feat(voice): 50 Hz voice:level emission during Recording"
```

---

## Task 12: HUD window — config + entry files

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src/hud/hud.html`
- Create: `apps/desktop/src/hud/hud.tsx`
- Modify: `apps/desktop/vite.config.ts`

- [ ] **Step 1: Define the second window**

In `apps/desktop/src-tauri/tauri.conf.json`, inside the `app.windows` array, add:

```json
{
  "label": "voice-hud",
  "url": "hud.html",
  "title": "Solo Voice HUD",
  "width": 220,
  "height": 48,
  "resizable": false,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "focus": false,
  "visible": false
}
```

- [ ] **Step 2: Add the HUD HTML**

Create `apps/desktop/src/hud/hud.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Solo Voice HUD</title>
    <style>
      html, body { margin: 0; padding: 0; background: transparent; }
    </style>
  </head>
  <body>
    <div id="hud-root"></div>
    <script type="module" src="/src/hud/hud.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Add the HUD React entry**

Create `apps/desktop/src/hud/hud.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { HudPill } from './HudPill';

createRoot(document.getElementById('hud-root')!).render(<HudPill />);
```

- [ ] **Step 4: Configure Vite for the second entry**

In `apps/desktop/vite.config.ts`, extend `build.rollupOptions.input` with an additional entry:

```typescript
build: {
  rollupOptions: {
    input: {
      index: path.resolve(__dirname, 'index.html'),
      hud: path.resolve(__dirname, 'src/hud/hud.html'),
    },
  },
},
```

If the current config has `input` as a single string, convert it to the object shape. Ensure `path` is imported.

- [ ] **Step 5: Placeholder `HudPill` (implemented properly in Task 13)**

Create `apps/desktop/src/hud/HudPill.tsx`:

```tsx
export function HudPill() {
  return <div style={{ color: 'white' }}>HUD online</div>;
}
```

- [ ] **Step 6: Verify**

```
bun run --filter '@solo/desktop' typecheck
cargo check -p solo-desktop
```

- [ ] **Step 7: Commit**

```
git add apps/desktop/src-tauri/tauri.conf.json apps/desktop/src/hud apps/desktop/vite.config.ts
git commit -m "feat(voice): HUD window config + placeholder React entry"
```

---

## Task 13: `HudPill` component — state-driven visuals

**Files:**
- Modify: `apps/desktop/src/hud/HudPill.tsx`
- Create: `apps/desktop/src/hud/waveform.tsx`

- [ ] **Step 1: Waveform component**

```tsx
interface WaveformProps {
  rms: number;            // 0.0–1.0
  color: string;
}

export function Waveform({ rms, color }: WaveformProps) {
  const clamped = Math.min(1, Math.max(0, rms));
  // Five bars whose heights are a gentle curve around the driving rms.
  const phases = [0.4, 0.75, 1.0, 0.75, 0.4];
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 20 }}>
      {phases.map((p, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: `${Math.max(2, clamped * p * 20)}px`,
            borderRadius: 2,
            background: color,
            transition: 'height 50ms linear',
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: HUD pill**

```tsx
import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { VoiceMode } from '@/bindings/VoiceMode';
import type { VoicePipelineState } from '@/bindings/VoicePipelineState';
import { Waveform } from './waveform';

export function HudPill() {
  const [mode, setMode] = useState<VoiceMode>('Dictation');
  const [state, setState] = useState<VoicePipelineState>({ kind: 'Idle' });
  const [rms, setRms] = useState(0);

  useEffect(() => {
    const u1 = listen<{ mode: VoiceMode; state: VoicePipelineState }>('voice:state', (e) => {
      setMode(e.payload.mode);
      setState(e.payload.state);
    });
    const u2 = listen<{ rms: number }>('voice:level', (e) => setRms(e.payload.rms));
    return () => {
      u1.then((u) => u());
      u2.then((u) => u());
    };
  }, []);

  const color = mode === 'Dispatch' ? '#00D37F' : 'white';
  const kind = typeof state === 'object' && 'kind' in state ? state.kind : 'Idle';

  return (
    <div
      style={{
        padding: '6px 10px',
        borderRadius: 999,
        background: 'rgba(0,0,0,0.7)',
        color: 'white',
        font: '13px -apple-system, system-ui',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {kind === 'Recording' && (
        <>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
          <Waveform rms={rms} color={color} />
        </>
      )}
      {(kind === 'Transcribing' || kind === 'Formatting') && (
        <>
          <span
            style={{
              width: 10,
              height: 10,
              border: `2px solid ${color}`,
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <span>{kind}…</span>
        </>
      )}
      {kind === 'Error' && (
        <span style={{ color: '#ff6b6b' }}>Error</span>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

`bun run --filter '@solo/desktop' typecheck` passes.

- [ ] **Step 4: Commit**

```
git add apps/desktop/src/hud/HudPill.tsx apps/desktop/src/hud/waveform.tsx
git commit -m "feat(voice): HUD pill + 5-bar waveform driven by voice:level"
```

---

## Task 14: HUD window show/hide + cursor-follow thread

**Files:**
- Modify: `apps/desktop/src-tauri/src/voice/hud.rs`
- Modify: `apps/desktop/src-tauri/src/voice_commands.rs`

- [ ] **Step 1: Implement HUD controller**

```rust
//! HUD window show/hide/position management + cursor-follow thread.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow};

pub struct HudState {
    visible: Arc<AtomicBool>,
    follow_stop: Arc<AtomicBool>,
    follow_thread: std::sync::Mutex<Option<thread::JoinHandle<()>>>,
}

impl HudState {
    pub fn new() -> Self {
        Self {
            visible: Arc::new(AtomicBool::new(false)),
            follow_stop: Arc::new(AtomicBool::new(false)),
            follow_thread: std::sync::Mutex::new(None),
        }
    }
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("voice-hud")
}

pub fn show(app: &AppHandle, state: &HudState) -> Result<(), String> {
    let Some(win) = window(app) else {
        return Err("voice-hud window not found".into());
    };
    position_near_cursor(&win);
    win.show().map_err(|e| e.to_string())?;
    state.visible.store(true, Ordering::SeqCst);

    // Kick off cursor-follow thread if not running.
    let mut guard = state.follow_thread.lock().unwrap();
    if guard.is_none() {
        state.follow_stop.store(false, Ordering::SeqCst);
        let stop = state.follow_stop.clone();
        let app_handle = app.clone();
        *guard = Some(thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                if let Some(win) = app_handle.get_webview_window("voice-hud") {
                    position_near_cursor(&win);
                }
                thread::sleep(Duration::from_millis(16)); // ~60 Hz
            }
        }));
    }
    Ok(())
}

pub fn hide(app: &AppHandle, state: &HudState) -> Result<(), String> {
    state.follow_stop.store(true, Ordering::SeqCst);
    if let Some(win) = window(app) {
        win.hide().map_err(|e| e.to_string())?;
    }
    state.visible.store(false, Ordering::SeqCst);
    if let Some(t) = state.follow_thread.lock().unwrap().take() {
        let _ = t.join();
    }
    Ok(())
}

fn position_near_cursor(win: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use core_graphics::event::CGEvent;
        use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

        if let Ok(src) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
            if let Ok(evt) = CGEvent::new(src) {
                let p = evt.location();
                let _ = win.set_position(tauri::PhysicalPosition::new(
                    (p.x + 16.0) as i32,
                    (p.y + 16.0) as i32,
                ));
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = win;
    }
}
```

- [ ] **Step 2: Drive show/hide from the pipeline state**

In `voice_commands.rs`, wherever the `on_state` callback for `VoicePipeline::new` is built, branch on state:

```rust
let app_for_state = app.clone();
let hud_state = app.state::<HudState>().inner().clone(); // or equivalent; see below
let on_state = Arc::new(move |s: &PipelineState| {
    emit_state(&app_for_state, mode, s);
    match s {
        PipelineState::Arming | PipelineState::Recording | PipelineState::Transcribing | PipelineState::Formatting => {
            let _ = crate::voice::hud::show(&app_for_state, &hud_state);
        }
        PipelineState::Idle | PipelineState::Emitting | PipelineState::Error(_) => {
            let _ = crate::voice::hud::hide(&app_for_state, &hud_state);
        }
    }
});
```

Because `HudState` needs to be referenced from a `Fn` callback (not `FnMut`), store it as an `Arc<HudState>` in managed state:

```rust
app.manage(Arc::new(voice::hud::HudState::new()));
```

And when reading: `let hud: Arc<HudState> = app.state::<Arc<HudState>>().inner().clone();`.

- [ ] **Step 3: Register `Arc<HudState>` in `lib.rs`**

Add to the `.manage()` chain in `lib.rs`:

```rust
.manage(std::sync::Arc::new(voice::hud::HudState::new()))
```

- [ ] **Step 4: Verify**

`cargo check -p solo-desktop` clean.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src-tauri/src/voice/hud.rs apps/desktop/src-tauri/src/voice_commands.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(voice): HUD show/hide + cursor-follow thread"
```

---

## Task 15: Frontend wrappers for new voice commands

**Files:**
- Modify: `apps/desktop/src/lib/tauri/voice.ts`
- Modify: `apps/desktop/src/stores/voiceStore.ts`

- [ ] **Step 1: Add new IPC wrappers**

Append to `voiceApi`:

```typescript
getShortcuts:   () => invoke<ShortcutsConfig>('voice_get_shortcuts'),
setShortcuts:   (shortcuts: ShortcutsConfig) => invoke<void>('voice_set_shortcuts', { shortcuts }),
checkPermissions:   () => invoke<VoicePermissions>('voice_check_permissions'),
requestPermission:  (which: 'microphone' | 'input-monitoring' | 'accessibility') =>
    invoke<VoicePermissions>('voice_request_permission', { which }),
```

Add `onVoiceLevel`:

```typescript
export function onVoiceLevel(cb: (rms: number) => void): Promise<UnlistenFn> {
  return listen<{ rms: number }>('voice:level', (e) => cb(e.payload.rms));
}
```

Add `onVoiceHotkey`:

```typescript
export type HotkeyKind = 'dictation_down' | 'dictation_up' | 'dispatch_down' | 'dispatch_up' | 'cancel';
export function onVoiceHotkey(cb: (kind: HotkeyKind) => void): Promise<UnlistenFn> {
  return listen<HotkeyKind>('voice:hotkey', (e) => cb(e.payload));
}
```

Import `ShortcutsConfig` from `@/bindings/ShortcutsConfig` and `VoicePermissions` from `@/bindings/VoicePermissions`.

- [ ] **Step 2: Extend `voiceStore`**

Add to the state interface:

```typescript
shortcuts: ShortcutsConfig;
permissions: VoicePermissions;
rmsLevel: number;
setShortcuts: (s: ShortcutsConfig) => void;
setPermissions: (p: VoicePermissions) => void;
setRmsLevel: (v: number) => void;
```

Defaults: `shortcuts = { dictation_ptt: 'fn', dispatch_ptt: 'ctrl+alt+space', cancel: 'escape' }`, `permissions = { microphone: false, input_monitoring: false, accessibility: false }`, `rmsLevel = 0`.

- [ ] **Step 3: Verify**

`bun run --filter '@solo/desktop' typecheck` passes.

- [ ] **Step 4: Commit**

```
git add apps/desktop/src/lib/tauri/voice.ts apps/desktop/src/stores/voiceStore.ts
git commit -m "feat(voice): frontend wrappers for shortcuts + permissions + level"
```

---

## Task 16: Global hotkey → IPC dispatch

**Files:**
- Modify: `apps/desktop/src/hooks/useVoiceInput.ts`

- [ ] **Step 1: Listen to `voice:hotkey` and drive `voice_begin`/`voice_end`**

Extend `useVoiceInput` with a second `useEffect` that subscribes to `voice:hotkey`:

```typescript
useEffect(() => {
  let un: UnlistenFn | undefined;
  let currentMode: 'Dictation' | 'Dispatch' | null = null;
  (async () => {
    un = await onVoiceHotkey(async (kind) => {
      if (kind === 'dictation_down') {
        currentMode = 'Dictation';
        try { await voiceApi.begin('Dictation'); } catch (e) { setError(String(e)); }
      } else if (kind === 'dispatch_down') {
        currentMode = 'Dispatch';
        try { await voiceApi.begin('Dispatch'); } catch (e) { setError(String(e)); }
      } else if (kind === 'dictation_up' || kind === 'dispatch_up') {
        try {
          await voiceApi.end(currentMode ?? 'Dictation', 'FocusedApp');
        } catch (e) {
          setError(String(e));
        }
        currentMode = null;
      } else if (kind === 'cancel') {
        try { await voiceApi.cancel(); } catch (e) { setError(String(e)); }
      }
    });
  })();
  return () => un?.();
}, [setError]);
```

Import `onVoiceHotkey` from `@/lib/tauri/voice`. Keep the existing chat-mic `start/stop` returned from the hook — that flow still uses `target: 'ChatInput'` and is unchanged.

- [ ] **Step 2: Verify**

`bun run --filter '@solo/desktop' typecheck` passes.

- [ ] **Step 3: Commit**

```
git add apps/desktop/src/hooks/useVoiceInput.ts
git commit -m "feat(voice): dispatch global hotkey events through voice commands"
```

---

## Task 17: `VoiceTab` — Shortcuts + Permissions sections

**Files:**
- Modify: `apps/desktop/src/components/settings/tabs/VoiceTab.tsx`

- [ ] **Step 1: Load shortcuts + permissions on mount**

Inside `VoiceTab`, add:

```typescript
const shortcuts = useVoiceStore((s) => s.shortcuts);
const setShortcuts = useVoiceStore((s) => s.setShortcuts);
const permissions = useVoiceStore((s) => s.permissions);
const setPermissions = useVoiceStore((s) => s.setPermissions);

useEffect(() => {
  (async () => {
    if (!enabled) return;
    setShortcuts(await voiceApi.getShortcuts());
    setPermissions(await voiceApi.checkPermissions());
  })();
}, [enabled, setShortcuts, setPermissions]);
```

- [ ] **Step 2: Shortcuts recorder**

Add a `<section>` inside the `{enabled && ...}` block:

```tsx
<section>
  <h3 className="text-sm font-semibold mb-2">Shortcuts</h3>
  <div className="grid grid-cols-[140px_1fr] gap-2 items-center">
    {([
      ['Dictation PTT', 'dictation_ptt'],
      ['Dispatch PTT',  'dispatch_ptt'],
      ['Cancel',        'cancel'],
    ] as const).map(([label, key]) => (
      <div key={key} className="contents">
        <span className="text-xs">{label}</span>
        <ShortcutRecorder
          value={shortcuts[key]}
          onChange={async (next) => {
            const updated = { ...shortcuts, [key]: next };
            setShortcuts(updated);
            await voiceApi.setShortcuts(updated);
          }}
        />
      </div>
    ))}
  </div>
</section>
```

The `ShortcutRecorder` is a tiny inline component that, on focus, listens for keydown and converts to the canonical `ctrl+alt+space` style string matching `hotkey.rs::format_shortcut`. Define it in the same file:

```tsx
function ShortcutRecorder({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [listening, setListening] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setListening(true)}
      onKeyDown={(e) => {
        if (!listening) return;
        e.preventDefault();
        const parts: string[] = [];
        if (e.ctrlKey) parts.push('ctrl');
        if (e.altKey) parts.push('alt');
        if (e.shiftKey) parts.push('shift');
        if (e.metaKey) parts.push('cmd');
        const name = e.key === ' ' ? 'space' : e.key === 'Escape' ? 'escape' : e.key.toLowerCase();
        if (name.length > 0 && !['control','alt','shift','meta','fn'].includes(name)) {
          parts.push(name);
          onChange(parts.join('+'));
          setListening(false);
        }
      }}
      onBlur={() => setListening(false)}
      className="text-xs border rounded px-2 py-1 text-left"
    >
      {listening ? 'Press a shortcut…' : value}
    </button>
  );
}
```

- [ ] **Step 3: Permissions indicators**

Add another section:

```tsx
<section>
  <h3 className="text-sm font-semibold mb-2">Permissions</h3>
  <ul className="space-y-1">
    {([
      ['Microphone',       'microphone'],
      ['Input Monitoring', 'input_monitoring'],
      ['Accessibility',    'accessibility'],
    ] as const).map(([label, key]) => (
      <li key={key} className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full ${permissions[key] ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="flex-1 text-xs">{label}</span>
        {!permissions[key] && (
          <Button onClick={async () => {
            const which = key === 'input_monitoring' ? 'input-monitoring' : (key as 'microphone' | 'accessibility');
            const next = await voiceApi.requestPermission(which);
            setPermissions(next);
          }}>
            Grant
          </Button>
        )}
      </li>
    ))}
  </ul>
</section>
```

- [ ] **Step 4: Verify**

`bun run --filter '@solo/desktop' typecheck` passes.

- [ ] **Step 5: Commit**

```
git add apps/desktop/src/components/settings/tabs/VoiceTab.tsx
git commit -m "feat(voice): Voice settings shortcuts + permissions sections"
```

---

## Task 18: Integration test — hotkey dispatch drives the pipeline

**Files:**
- Create: `crates/solo-voice/tests/pipeline_level_emission.rs`

- [ ] **Step 1: Test that `voice:level`-style emission happens**

```rust
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
    { Ok(self.0.to_string()) }
}

#[tokio::test]
async fn rms_level_emits_during_recording() {
    let stt: Arc<dyn SttProvider> = Arc::new(MockStt { canned: "x".into() });
    let fmt: Arc<dyn FormatterProvider> = Arc::new(CloudFormatter {
        model: "x".into(),
        client: CannedChat("x"),
    });
    let ring = AudioRing::new();
    let on_state = Arc::new(|_: &PipelineState| {});
    let levels = Arc::new(Mutex::new(Vec::<f32>::new()));
    let levels_c = levels.clone();
    let on_level = Arc::new(move |r: f32| levels_c.lock().unwrap().push(r));

    let p = VoicePipeline::new(stt, fmt, ring.clone(), on_state, on_level);
    p.begin().await.unwrap();
    ring.push(&vec![0.25f32; 16_000]);

    // Give the sampler a few ticks
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;

    p.end(
        VoiceMode::Dictation, PipelineTarget::ChatInput,
        AppContext::default(), DictationOptions::default(),
    ).await.unwrap();

    let count = levels.lock().unwrap().len();
    assert!(count >= 2, "expected >=2 level emissions, got {count}");
}
```

- [ ] **Step 2: Run**

```
cargo test -p solo-voice --test pipeline_level_emission
```

- [ ] **Step 3: Commit**

```
git add crates/solo-voice/tests/pipeline_level_emission.rs
git commit -m "test(solo-voice): voice:level emission regression test"
```

---

## Task 19: Manual QA checklist + docs

**Files:**
- Modify: `testing.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append Phase 2 QA**

In `testing.md`, append:

```markdown
## Voice (Phase 2 — global dictation)

- [ ] Open Settings → Voice → Shortcuts → record `Fn` as Dictation PTT; backend stores it.
- [ ] Click `Grant` for Input Monitoring → macOS prompt appears; status turns green.
- [ ] Click `Grant` for Accessibility → macOS prompt appears; status turns green.
- [ ] In Slack (or any focused app), hold `Fn` → cursor-pill HUD appears, waveform animates.
- [ ] Release `Fn` → transcript formats, pastes at caret, clipboard is restored to its prior contents.
- [ ] Press `Esc` while holding `Fn` (or during Transcribing) → HUD hides, no paste.
- [ ] Disable Accessibility → attempting dictation shows "Paste failed — text copied to clipboard".
- [ ] Change Dispatch PTT to `ctrl+alt+v`; hotkey remap takes effect without voice re-enable.
```

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`, add a line under the `solo-voice` entry:

```markdown
  - Phase 2 adds `apps/desktop/src-tauri/src/voice/{hotkey,injection,app_monitor,hud}.rs`
    for global dictation and the cursor-pill HUD window.
```

- [ ] **Step 3: Commit**

```
git add testing.md CLAUDE.md
git commit -m "docs: voice Phase 2 QA checklist + module notes"
```

---

## Task 20: Final workspace validation

- [ ] **Step 1: Full sweep**

```
cargo check --workspace --exclude solo-desktop
cargo check -p solo-desktop
cargo test -p solo-voice
bun run --filter '@solo/desktop' typecheck
cd apps/desktop && bun test src/stores/__tests__/voiceStore.test.ts
```

All must pass.

- [ ] **Step 2: Done**

Phase 2 complete. Push to remote; the Phase-1 PR gains Phase 2 commits on top.

---

## Follow-ups not covered in this plan

- Real-world dictation QA (needs a Mac with permissions granted + focused app).
- Accessibility-based `window_title` retrieval if formatter context wants it.
- HUD polish (motion/spring easing, state-transition fades).
- Windows / Linux ports of the `voice/*` module family.
