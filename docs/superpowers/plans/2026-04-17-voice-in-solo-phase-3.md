# Voice in Solo — Phase 3 Implementation Plan (Agent Dispatch)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user hold `⌃⌥Space` from any macOS app, speak a task ("refactor the auth module and add integration tests"), and silently spawn an agent session in Solo with that prompt — no focus-steal. A native macOS notification + dock badge confirms. The session shows up as a sidebar row and auto-opens the agent panel the next time Solo gains focus.

**Architecture:** Builds on the Phase 1 pipeline (formatter's `format_dispatch` already returns `DispatchTask { title, prompt }`) and on the Phase 2 hotkey tap + HUD (which already emits `voice:hotkey` → `dispatch_{down,up}`). Phase 3 wires the `voice_end(mode=Dispatch, target=NewAgentSession)` tail to Solo's existing `agent_commands::create_session` call, adds a toast/notification/dock-badge UX, populates `linked_session_id` in history, and hooks "auto-pop agent panel on focus" into Solo's existing focus-change listener.

**Tech Stack:** Tauri 2 (notifications + dock badge), existing `solo-agent` + `solo-voice`, React 19 + Zustand, `tauri-plugin-notification`.

**Reference:** `docs/superpowers/specs/2026-04-17-voice-in-solo-design.md` — this plan implements Phase 3.

---

## File Structure

### Modifications (Rust)

| File | Change |
|---|---|
| `apps/desktop/src-tauri/Cargo.toml` | Add `tauri-plugin-notification` if not present |
| `apps/desktop/src-tauri/src/voice_commands.rs` | `voice_end` with `target: NewAgentSession` creates an agent session, populates `linked_session_id` in history, emits `voice:dispatched` event, updates dock badge via `app.set_badge_count` |
| `apps/desktop/src-tauri/src/lib.rs` | Register `tauri_plugin_notification` |
| `crates/solo-voice/src/pipeline.rs` | `end()` now returns `Option<DispatchTask>` alongside formatted text so voice_commands can pass title/prompt to session creation |

### Modifications (Frontend)

| File | Change |
|---|---|
| `apps/desktop/src/lib/tauri/voice.ts` | Add `onVoiceDispatched` listener |
| `apps/desktop/src/stores/voiceStore.ts` | Track `pendingDispatch` session id |
| `apps/desktop/src/hooks/useVoiceInput.ts` | On `voice:dispatched`, show Solo's in-app toast + store pending session |
| `apps/desktop/src/App.tsx` (or equivalent focus-hook) | On window focus, if `pendingDispatch` set, open the agent panel and clear it |

### No file-deletions required.

---

## Conventions applied to every task

Identical to Phase 2 — see that plan. TDD, per-task quality gate, no Claude attribution, worktree guardrails.

---

## Task 1: Add `tauri-plugin-notification` dep

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add dep**

In `apps/desktop/src-tauri/Cargo.toml`, inside `[dependencies]`, add:

```toml
tauri-plugin-notification = "2"
```

(Skip if the plugin is already a dep — grep the file first.)

- [ ] **Step 2: Register plugin**

In `apps/desktop/src-tauri/src/lib.rs`, inside the `.plugin(...)` chain on the `Builder`, add:

```rust
.plugin(tauri_plugin_notification::init())
```

- [ ] **Step 3: Verify**

`cargo check -p solo-desktop`

- [ ] **Step 4: Commit**

```
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/src/lib.rs
git commit -m "chore(voice): add tauri-plugin-notification for dispatch toasts"
```

---

## Task 2: Pipeline's `end()` returns the DispatchTask

**Files:**
- Modify: `crates/solo-voice/src/pipeline.rs`
- Modify: `apps/desktop/src-tauri/src/voice_commands.rs`

Currently `pipeline.end(...)` returns `PipelineOutput`. For Dispatch mode the formatter call returns a `DispatchTask { title, prompt }`, but `pipeline.end()` currently collapses it into a single formatted string. Fix: add an optional `dispatch_task: Option<DispatchTask>` field to `PipelineOutput`.

- [ ] **Step 1: Extend `PipelineOutput`**

```rust
#[derive(Debug, Clone)]
pub struct PipelineOutput {
    pub id: String,
    pub mode: VoiceMode,
    pub raw_transcript: String,
    pub formatted: String,
    pub duration_ms: u32,
    pub dispatch_task: Option<crate::formatter::DispatchTask>,
}
```

- [ ] **Step 2: Populate in `end()`**

Replace the Dispatch branch with:

```rust
VoiceMode::Dispatch => {
    let task = self
        .formatter
        .format_dispatch(&raw, context.clone())
        .await?;
    let formatted = format!("{}\n\n{}", task.title, task.prompt);
    (formatted, Some(task))
}
```

…and mirror the Dictation branch to return `(formatted, None)`. Then construct `PipelineOutput` with `dispatch_task: <option>`.

- [ ] **Step 3: Update existing tests**

In `pipeline.rs::tests`, `happy_path_dictation` — assert `out.dispatch_task.is_none()`. Add a new test `happy_path_dispatch_returns_task` that uses a `CannedChat` returning valid JSON and asserts `out.dispatch_task` is `Some` with the expected title/prompt.

- [ ] **Step 4: Update voice_commands**

In `voice_end`, after `pipeline.end(...)`, pass through the task for Dispatch flow (details in Task 3).

- [ ] **Step 5: Verify**

```
cargo test -p solo-voice
cargo check -p solo-desktop
```

- [ ] **Step 6: Commit**

```
git add crates/solo-voice/src/pipeline.rs apps/desktop/src-tauri/src/voice_commands.rs
git commit -m "feat(solo-voice): surface DispatchTask on PipelineOutput"
```

---

## Task 3: `voice_end` for NewAgentSession target

**Files:**
- Modify: `apps/desktop/src-tauri/src/voice_commands.rs`

Goal: when `target == NewAgentSession`, invoke Solo's existing agent-session creation (the same code path used by the chat UI's "new session" button). Capture the returned session id and record it as `history_row.linked_session_id`. Also emit `voice:dispatched` + post a macOS notification + bump the dock badge.

- [ ] **Step 1: Identify the agent session-create helper**

Run: `rg -n 'create_session\|create_agent_session\|agent_new' apps/desktop/src-tauri/src/`. Expected: a Tauri command in `agent_commands.rs` that accepts a prompt + title and returns a session id. Note its exact signature.

- [ ] **Step 2: Branch on target**

In `voice_end`, extend the target switch:

```rust
use tauri_plugin_notification::NotificationExt;

match target {
    PipelineTarget::ChatInput => { /* unchanged — emit voice:transcript */ }
    PipelineTarget::FocusedApp => { /* Phase 2 — inject_text */ }
    PipelineTarget::NewAgentSession => {
        let Some(task) = out.dispatch_task.as_ref() else {
            return Err("dispatch target requires Dispatch mode".into());
        };
        let session_id = crate::agent_commands::create_session_internal(
            &app,
            task.title.clone(),
            task.prompt.clone(),
            /* auto_run: */ true,
        ).await
        .map_err(|e| e.to_string())?;

        // History row with linked session
        if let Some(h) = voice.history.lock().await.as_ref() {
            let _ = h.insert(&HistoryRow {
                id: out.id.clone(),
                mode: format!("{:?}", out.mode),
                raw_transcript: out.raw_transcript.clone(),
                formatted: out.formatted.clone(),
                target_app_bundle_id: ctx.bundle_id.clone(),
                target_app_name: ctx.app_name.clone(),
                duration_ms: out.duration_ms,
                linked_session_id: Some(session_id.clone()),
                created_at: chrono::Utc::now().timestamp_millis(),
            });
        }

        // Notify
        let _ = app.notification().builder()
            .title("Agent dispatched")
            .body(&task.title)
            .show();

        // Dock badge +1
        let _ = app.set_badge_count(Some(1));

        // Frontend event
        let _ = app.emit("voice:dispatched", serde_json::json!({
            "session_id": session_id,
            "title": task.title,
        }));
    }
}
```

`agent_commands::create_session_internal` is the *non-Tauri-command* helper that the Tauri command delegates to. If there's no such helper (i.e. everything lives inside `#[tauri::command] pub async fn create_session(...)`), extract a helper fn that the command + our voice path both call. Keep the signature private-ish: `pub(crate) async fn create_session_internal(app: &AppHandle, title: String, prompt: String, auto_run: bool) -> Result<String, String>`.

- [ ] **Step 3: Verify**

`cargo check -p solo-desktop`. If the signature of `create_session_internal` differs, adapt.

- [ ] **Step 4: Commit**

```
git add apps/desktop/src-tauri/src
git commit -m "feat(voice): dispatch creates agent session + notification + dock badge"
```

---

## Task 4: Frontend `voice:dispatched` listener + pending state

**Files:**
- Modify: `apps/desktop/src/lib/tauri/voice.ts`
- Modify: `apps/desktop/src/stores/voiceStore.ts`

- [ ] **Step 1: Listener wrapper**

```typescript
export interface DispatchEvent {
  session_id: string;
  title: string;
}

export function onVoiceDispatched(cb: (p: DispatchEvent) => void): Promise<UnlistenFn> {
  return listen<DispatchEvent>('voice:dispatched', (e) => cb(e.payload));
}
```

- [ ] **Step 2: voiceStore — `pendingDispatch`**

Add to the store:

```typescript
pendingDispatch: DispatchEvent | null;
setPendingDispatch: (d: DispatchEvent | null) => void;
```

Initial value `null`.

- [ ] **Step 3: Verify**

`bun run --filter '@solo/desktop' typecheck`

- [ ] **Step 4: Commit**

```
git add apps/desktop/src/lib/tauri/voice.ts apps/desktop/src/stores/voiceStore.ts
git commit -m "feat(voice): frontend dispatch event listener + pending state"
```

---

## Task 5: Wire `voice:dispatched` — toast + pending session

**Files:**
- Modify: `apps/desktop/src/hooks/useVoiceInput.ts`

- [ ] **Step 1: Subscribe inside the hook**

```typescript
useEffect(() => {
  let un: UnlistenFn | undefined;
  (async () => {
    un = await onVoiceDispatched((ev) => {
      // In-app toast (matches Solo's existing toast pattern — import toast from 'sonner' if used)
      toast.success(`Agent dispatched: ${ev.title}`);
      useVoiceStore.getState().setPendingDispatch(ev);
    });
  })();
  return () => un?.();
}, []);
```

Import `toast` from `'sonner'` (Solo uses it elsewhere per memory). Import `onVoiceDispatched` from `@/lib/tauri/voice`.

- [ ] **Step 2: Verify**

Typecheck clean.

- [ ] **Step 3: Commit**

```
git add apps/desktop/src/hooks/useVoiceInput.ts
git commit -m "feat(voice): toast on agent dispatch + remember pending session"
```

---

## Task 6: Auto-pop agent panel on Solo focus

**Files:**
- Modify: `apps/desktop/src/App.tsx` (or whichever component owns focus-change logic — grep first)

- [ ] **Step 1: Find the focus-change hook**

Run: `rg -n 'onFocusChanged\|focus-change\|WebviewWindow.focus\|tauri.*focus' apps/desktop/src/`. Expected: a `window:focus` or `tauri://focus` listener in `App.tsx` or a hook.

- [ ] **Step 2: On focus, pop the agent panel if pending**

Extend the existing focus listener:

```typescript
import { useVoiceStore } from '@/stores/voiceStore';
import { openSessionInAgentPanel } from '@/stores/agentStore'; // or the actual helper

useEffect(() => {
  const un = onAppFocused(() => {
    const pending = useVoiceStore.getState().pendingDispatch;
    if (pending) {
      openSessionInAgentPanel(pending.session_id);
      useVoiceStore.getState().setPendingDispatch(null);
      // Clear dock badge
      import('@tauri-apps/api').then(({ invoke }) => invoke('voice_clear_badge'));
    }
  });
  return () => un.then((u) => u());
}, []);
```

Substitute with Solo's real focus listener + panel-opening call. If Solo doesn't yet have a helper like `openSessionInAgentPanel`, create one in `agentStore.ts` that sets the active session and marks the agent panel visible. Don't over-build — just enough to make the dispatched session visible.

- [ ] **Step 3: Add `voice_clear_badge` command**

In `voice_commands.rs`:

```rust
#[tauri::command]
pub async fn voice_clear_badge(app: AppHandle) -> Result<(), String> {
    app.set_badge_count(None).map_err(|e| e.to_string())
}
```

Register in `lib.rs` generate_handler.

- [ ] **Step 4: Verify**

```
cargo check -p solo-desktop
bun run --filter '@solo/desktop' typecheck
```

- [ ] **Step 5: Commit**

```
git add apps/desktop/src-tauri/src apps/desktop/src/App.tsx apps/desktop/src/stores/agentStore.ts
git commit -m "feat(voice): auto-pop dispatched agent session on Solo focus"
```

---

## Task 7: Integration test — dispatch creates a session

**Files:**
- Create: `crates/solo-voice/tests/pipeline_dispatch.rs`

- [ ] **Step 1: Test**

```rust
//! End-to-end: mode=Dispatch returns a DispatchTask on PipelineOutput.

use solo_voice::{
    audio::AudioRing,
    formatter::{ChatClient, CloudFormatter, DictationOptions, AppContext, FormatterProvider},
    mode::{PipelineTarget, VoiceMode},
    pipeline::{PipelineState, VoicePipeline},
    stt::{MockStt, SttProvider},
};
use std::sync::Arc;
use async_trait::async_trait;

struct CannedChat(&'static str);
#[async_trait]
impl ChatClient for CannedChat {
    async fn simple_completion(&self, _m: &str, _s: &str, _u: &str)
        -> solo_voice::error::Result<String>
    { Ok(self.0.to_string()) }
}

#[tokio::test]
async fn dispatch_returns_task() {
    let stt: Arc<dyn SttProvider> = Arc::new(MockStt { canned: "refactor auth".into() });
    let json = r#"{"title":"Refactor auth","prompt":"Refactor the auth module."}"#;
    let fmt: Arc<dyn FormatterProvider> = Arc::new(CloudFormatter {
        model: "x".into(),
        client: CannedChat(json),
    });
    let ring = AudioRing::new();
    let p = VoicePipeline::new(
        stt, fmt, ring.clone(),
        Arc::new(|_: &PipelineState| {}),
        Arc::new(|_: f32| {}),
    );
    p.begin().await.unwrap();
    ring.push(&vec![0.1f32; 16_000]);
    let out = p.end(
        VoiceMode::Dispatch, PipelineTarget::NewAgentSession,
        AppContext::default(), DictationOptions::default(),
    ).await.unwrap();
    let task = out.dispatch_task.expect("dispatch task");
    assert_eq!(task.title, "Refactor auth");
    assert_eq!(task.prompt, "Refactor the auth module.");
}
```

- [ ] **Step 2: Run**

```
cargo test -p solo-voice --test pipeline_dispatch
```

- [ ] **Step 3: Commit**

```
git add crates/solo-voice/tests/pipeline_dispatch.rs
git commit -m "test(solo-voice): dispatch flow returns DispatchTask"
```

---

## Task 8: Manual QA checklist

**Files:**
- Modify: `testing.md`

- [ ] **Step 1: Append Phase 3 QA**

```markdown
## Voice (Phase 3 — agent dispatch)

- [ ] From Arc or any non-Solo app, hold `⌃⌥Space` and say "refactor the auth module and add integration tests".
- [ ] Release → green HUD pill hides, no focus-steal, macOS notification "Agent dispatched: Refactor auth module" fires.
- [ ] Solo's dock badge shows `1`.
- [ ] Click Solo in the dock → agent panel auto-opens on the new session; dock badge clears.
- [ ] History row for the dispatch exists with `linked_session_id` matching the new session.
- [ ] Dispatch formatter produces non-JSON → toast "Dispatch failed" instead of silent no-op.
```

- [ ] **Step 2: Commit**

```
git add testing.md
git commit -m "docs: voice Phase 3 manual QA checklist"
```

---

## Task 9: Final workspace validation

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

Phase 3 complete. The claude/voice-phase-1 branch now contains Phase 1 + 2 + 3.

---

## Follow-ups not covered in this plan

- Fan-out (one utterance → multiple agents) — spec locks to single-agent in v1; revisit later.
- Agent-panel multi-tab UX for parallel dispatched sessions.
- Linear / GitHub issue dispatch as alternative targets.
- Dispatch cancellation mid-agent-run.
