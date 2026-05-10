# Virtualization Console Scripts

Run these in the Tauri webview DevTools console while the app is open.

- `virtualization-smoke.js` checks mounted virtualized lists, scrolls them, and reports rendered vs total items.
- `virtualization-scroll-container-audit.js` scans the current screen for suspicious scroll containers that are not virtualized.

Navigate to each high and medium priority surface, paste the scripts, and inspect the console tables. Missing expected surfaces in the smoke script usually mean that screen/popover is not currently mounted.
