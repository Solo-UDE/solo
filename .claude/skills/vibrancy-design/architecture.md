# Vibrancy Architecture

The vibrancy system has three layers that work together: native macOS effects (Rust/Tauri), CSS transparency rules, and React attribute coordination.

## Layer 1: Rust/Tauri Native Effects

In `apps/desktop/src-tauri/src/lib.rs`, the setup closure configures the native `NSVisualEffectView`:

```rust
#[cfg(target_os = "macos")]
{
    use tauri::Manager;
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_traffic_lights_inset(13.0, 13.0);
        let _ = window.set_effects(
            EffectsBuilder::new()
                .effect(Effect::Sidebar)
                .state(EffectState::FollowsWindowActiveState)
                .build(),
        );
    }
}
```

Key points:
- `Effect::Sidebar` applies the macOS sidebar material (medium vibrancy)
- `EffectState::FollowsWindowActiveState` dims when the window loses focus
- Traffic lights are inset `(13.0, 13.0)` to align with the custom titlebar
- `tauri-plugin-decorum` (v1.1.1) provides `set_traffic_lights_inset`

### Cargo dependencies

```toml
tauri = { workspace = true, features = ["macos-private-api"] }
tauri-plugin-decorum = "1.1.1"
```

## Layer 2: Tauri Window Configuration

In `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "app": {
    "macOSPrivateApi": true,
    "windows": [{
      "transparent": true,
      "titleBarStyle": "Overlay",
      "hiddenTitle": true,
      "decorations": true
    }]
  }
}
```

- `transparent: true` — makes the webview background transparent so the native effect shows through
- `titleBarStyle: "Overlay"` — hides the native title bar but keeps traffic lights
- `hiddenTitle: true` — removes the window title text
- `macOSPrivateApi: true` — required for vibrancy effects

## Layer 3: React Attribute Setup

In `apps/desktop/src/App.tsx`, a `useEffect` sets the `data-vibrancy` attribute:

```tsx
useEffect(() => {
    const isMac = navigator.platform.startsWith('Mac') ||
                  navigator.userAgent.includes('Macintosh');
    if (isMac) {
        document.documentElement.setAttribute('data-vibrancy', 'true');
    }
}, []);
```

This attribute is the CSS cascade trigger. All vibrancy-specific styles are scoped under `html[data-vibrancy]`.

## Layer 4: CSS Transparency Cascade

In `apps/desktop/src/index.css`:

```css
html[data-vibrancy] {
    --sidebar: transparent;
    background-color: transparent !important;
}

html[data-vibrancy] #root > div {
    background: transparent;
}

html[data-vibrancy] .titlebar-glass {
    background: rgb(255 255 255 / 0.03);
}
```

When vibrancy is active:
1. `--sidebar` becomes `transparent` — the sidebar `bg-sidebar` class renders as transparent
2. `html` and `#root > div` backgrounds become transparent — the native blur shows through
3. `.titlebar-glass` gets a barely-visible white tint (3% opacity) for subtle depth

## Non-macOS Fallback

When `data-vibrancy` is **not** set (Windows, Linux):
- `--sidebar` stays at its themed value (`oklch(0.95 ...)` light / `oklch(0.18 ...)` dark)
- `html` and `#root > div` use their normal background colors
- `.titlebar-glass` class has no special rule — the component's `bg-background/70` applies as a solid 70% opacity over the opaque background
- All components remain fully functional with solid backgrounds

## Data Flow Summary

```
macOS detected?
  ├── YES: Rust applies Effect::Sidebar → React sets data-vibrancy
  │         → CSS makes sidebar/root transparent → native blur shows through
  │         → Components use backdrop-blur-* for layered glass depth
  └── NO:  No native effect → No data-vibrancy attribute
            → CSS variables resolve to solid colors → Normal opaque UI
```

## Layout Constants

Defined in `apps/desktop/src/lib/constants.ts`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `HEIGHTS.titlebar` | `38px` | Titlebar overlay height, used as `pt-[38px]` on content |
| `SIDEBAR.expanded` | `256px` | Default sidebar width |
| `SIDEBAR.min` | `180px` | Minimum drag width |
| `SIDEBAR.max` | `400px` | Maximum drag width |
| `SIDEBAR.collapsed` | `0px` | Fully collapsed |
