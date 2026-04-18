# Manual QA

## Voice (Phase 1)

- [ ] Open Settings → Voice, click `Enable voice` → macOS Microphone permission prompt appears
- [ ] Click `Download` for Parakeet → progress bar updates, completes ~250 MB
- [ ] Open the agent chat, click the mic button → recording starts (icon changes)
- [ ] Speak a short sentence, click mic again → transcript appears in chat input
- [ ] Click `Copy` in Voice history → clipboard contains the formatted text
- [ ] Click `Delete` in Voice history → row removed
- [ ] Disable voice, re-enable → Parakeet still marked installed, history preserved

## Voice (Phase 2 — global dictation)

- [ ] Open Settings → Voice → Shortcuts → record `Fn` as Dictation PTT; backend stores it.
- [ ] Click `Grant` for Input Monitoring → macOS prompt appears; status turns green.
- [ ] Click `Grant` for Accessibility → macOS prompt appears; status turns green.
- [ ] In Slack (or any focused app), hold `Fn` → cursor-pill HUD appears, waveform animates.
- [ ] Release `Fn` → transcript formats, pastes at caret, clipboard is restored to its prior contents.
- [ ] Press `Esc` while holding `Fn` (or during Transcribing) → HUD hides, no paste.
- [ ] Disable Accessibility → attempting dictation shows "Paste failed — text copied to clipboard".
- [ ] Change Dispatch PTT to `ctrl+alt+v`; hotkey remap takes effect without voice re-enable.

## Voice (Phase 3 — agent dispatch)

- [ ] From Arc or any non-Solo app, hold `⌃⌥Space` and say "refactor the auth module and add integration tests".
- [ ] Release → green HUD pill hides, no focus-steal, macOS notification "Agent dispatched: Refactor auth module" fires.
- [ ] Solo's dock badge shows `1`.
- [ ] Click Solo in the dock → agent panel auto-opens on the new session; dock badge clears.
- [ ] History row for the dispatch exists with `linked_session_id` matching the new session.
- [ ] Dispatch formatter produces non-JSON → toast "Dispatch failed" instead of silent no-op.
