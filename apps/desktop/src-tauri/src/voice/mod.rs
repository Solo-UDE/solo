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
