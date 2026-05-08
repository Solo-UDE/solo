//! CGEvent-tap hotkey manager. Spawns a dedicated OS thread that owns
//! a private CFRunLoop; the tap delivers KeyDown/KeyUp/FlagsChanged
//! events to our callback. Events pass through unmodified when they
//! don't match a bound shortcut.

use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventType, CGKeyCode,
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
            let state: Arc<std::sync::Mutex<TapState>> =
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
                move |_proxy, ty, event| {
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
                Err(_) => {
                    let _ = ready_tx.send(Err(
                        "CGEventTap::new failed: permission denied or no Input Monitoring access"
                            .to_string(),
                    ));
                    return;
                }
            };

            // mach_port is a public field on CGEventTap, not a method.
            let loop_src = match tap.mach_port.create_runloop_source(0) {
                Ok(s) => s,
                Err(_) => {
                    let _ = ready_tx.send(Err("create_runloop_source failed".into()));
                    return;
                }
            };

            let current_loop = CFRunLoop::get_current();
            unsafe {
                current_loop.add_source(&loop_src, kCFRunLoopCommonModes);
            }
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
            let code = event
                .get_integer_value_field(core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE)
                as CGKeyCode;
            let flags = event.get_flags();
            let shortcut = format_shortcut(flags, code);

            let down = matches!(ty, CGEventType::KeyDown);

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
        let flags = CGEventFlags::CGEventFlagControl | CGEventFlags::CGEventFlagAlternate;
        assert_eq!(format_shortcut(flags, 0x31), "ctrl+alt+space");
    }

    #[test]
    fn format_shortcut_escape() {
        assert_eq!(format_shortcut(CGEventFlags::empty(), 0x35), "escape");
    }
}
