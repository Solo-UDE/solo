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
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSArray, NSString};

    // The UTI for plain text — mirrors NSPasteboardTypeString constant value.
    const PLAIN_TEXT_UTI: &str = "public.utf8-plain-text";

    // Save + overwrite clipboard
    let saved = autoreleasepool(|_| unsafe {
        let pb = NSPasteboard::generalPasteboard();
        let ns_type = NSString::from_str(PLAIN_TEXT_UTI);
        let current = pb.stringForType(&ns_type);
        pb.clearContents();
        let ns_text = NSString::from_str(text);
        let ns_type2 = NSString::from_str(PLAIN_TEXT_UTI);
        let ns_types: objc2::rc::Retained<NSArray<NSString>> = NSArray::from_vec(vec![ns_type2]);
        pb.declareTypes_owner(&ns_types, None);
        let ns_type3 = NSString::from_str(PLAIN_TEXT_UTI);
        pb.setString_forType(&ns_text, &ns_type3);
        current.map(|s| s.to_string())
    });

    // Synthesize ⌘V
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| InjectionError("CGEventSource failed".into()))?;
    const V_KEY: u16 = 0x09;
    let down = CGEvent::new_keyboard_event(source.clone(), V_KEY, true)
        .map_err(|_| InjectionError("v-down event failed".into()))?;
    down.set_flags(CGEventFlags::CGEventFlagCommand);
    let up = CGEvent::new_keyboard_event(source, V_KEY, false)
        .map_err(|_| InjectionError("v-up event failed".into()))?;
    up.set_flags(CGEventFlags::CGEventFlagCommand);

    down.post(CGEventTapLocation::HID);
    up.post(CGEventTapLocation::HID);

    thread::sleep(Duration::from_millis(80));

    // Restore clipboard
    autoreleasepool(|_| unsafe {
        if let Some(prior) = saved {
            let pb = NSPasteboard::generalPasteboard();
            pb.clearContents();
            let ns_prior = NSString::from_str(&prior);
            let ns_type = NSString::from_str(PLAIN_TEXT_UTI);
            let ns_types: objc2::rc::Retained<NSArray<NSString>> =
                NSArray::from_vec(vec![NSString::from_str(PLAIN_TEXT_UTI)]);
            pb.declareTypes_owner(&ns_types, None);
            pb.setString_forType(&ns_prior, &ns_type);
        }
    });

    Ok(InjectionOutcome::Pasted)
}

#[cfg(not(target_os = "macos"))]
pub fn inject_text(_text: &str) -> Result<InjectionOutcome, InjectionError> {
    Err(InjectionError("inject_text: macOS-only in P2".into()))
}
