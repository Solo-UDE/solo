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
