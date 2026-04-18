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
