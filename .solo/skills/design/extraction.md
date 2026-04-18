# Extraction Pipeline

How to capture the visual DNA of Codex.app (or any Electron app) and land it as structured data in `packages/ui/design-dump/`.

## Why extraction, not eyeballing

Reading a Codex screenshot and guessing at its color values produces plausible-but-wrong tokens — hue drift of 5° in OKLCH is invisible to the eye but shifts the entire palette's feel. Extraction gives us exact values from the renderer's own computed styles, eliminating the guesswork.

## Three extraction modes

| Mode | When to use | Invocation |
|---|---|---|
| **Automated (CDP)** | Normal case. Full dump, all archetypes, all assets. | `bun scripts/codex-extract/launch.ts` |
| **Attached (existing CDP)** | You already have Codex running with `--remote-debugging-port=9222` and want to extract after navigating to a specific screen. | `bun scripts/codex-extract/extract.ts --attach ws://127.0.0.1:9222/...` |
| **Dev-console snippet** | CDP refuses to attach (signed-app entitlement issue) or you want a quick one-off CSS dump without the harness. | See [`dev-console-snippet.js`](dev-console-snippet.js) |

## Automated mode — how it works

`launch.ts`:
1. Clears `./tmp-codex-profile/` to avoid polluting the user's real Codex profile.
2. Spawns `/Applications/Codex.app/Contents/MacOS/Codex --remote-debugging-port=9222 --user-data-dir=./tmp-codex-profile`.
3. Polls `http://127.0.0.1:9222/json` every 200ms (timeout 10s) until a `type: "page"` target appears.
4. Hands the `webSocketDebuggerUrl` to `extract.ts`.

`extract.ts`:
1. Opens a CDP WebSocket connection.
2. Enables the `DOM`, `CSS`, `Runtime`, `Page`, and `Network` domains.
3. Waits for `Page.loadEventFired` (+ a 500ms settle delay for fonts).
4. Runs each extractor in order. Extractors are pure — they take the CDP client + a config, return JSON.
5. Writes output to `packages/ui/design-dump/codex/`.

## Extractors

### stylesheets.ts

- Calls `CSS.getAllStyleSheets()` → list of sheet IDs.
- For each sheet, calls `CSS.getStyleSheetText(styleSheetId)` → raw CSS text.
- Groups by origin: `user-agent` (filtered out), `author` (kept).
- Writes each author sheet to `design-dump/codex/stylesheets/NN-<hash>.css` with a header comment recording source URL + extraction timestamp.
- **Fail mode**: a sheet with null text (dynamically injected without `href`) is captured via `CSS.takeComputedStyleUpdates` instead. Logged as `<dynamic>` in the output.

### computed.ts

Iterates over `archetypes.json` selectors. For each:
1. `DOM.querySelector(rootNodeId, selector)` → node ID, or `null` if not present.
2. If present: `CSS.getComputedStyleForNode(nodeId)` → full computed style object.
3. Also: `CSS.getMatchedStylesForNode(nodeId)` → the rules that matched, in specificity order.
4. Writes both to `design-dump/codex/computed-styles.json` keyed by archetype name.

Archetype shape:
```json
{
  "name": "primary-button",
  "selectors": [
    "button[data-variant='primary']",
    "button.btn-primary",
    "button[class*='PrimaryButton']"
  ],
  "states": ["default", "hover", "active", "focus", "disabled"]
}
```

States beyond `default` are captured by forcing pseudo-states via `CSS.forcePseudoState(nodeId, ['hover'])` before running `getComputedStyleForNode`.

### fonts.ts

- `Runtime.evaluate({ expression: "[...document.fonts].map(f => ({family: f.family, weight: f.weight, style: f.style, display: f.display, status: f.status, unicodeRange: f.unicodeRange}))" })`.
- Additionally scans stylesheets for `@font-face` rules and resolves their `src` URLs.
- Downloads small font files (<500KB) into `design-dump/codex/assets/fonts/` for offline reference.

### tokens.ts

Scans the document for CSS custom properties:
1. `document.documentElement`'s computed style (root-level `--*`).
2. Optional: enumerate descendants and collect `--*` declared on other elements (Codex may scope some tokens to subtrees).

Output shape:
```json
[
  { "name": "--color-bg", "value": "#0a0a0a", "scope": ":root" },
  { "name": "--radius-card", "value": "8px", "scope": ":root" },
  { "name": "--radius-inline-code", "value": "4px", "scope": ".prose" }
]
```

### keyframes.ts

Regex-scans each stylesheet for `@keyframes <name> { ... }`. Pairs each with the selectors that `animation-name` references (from computed styles). Output:
```json
{
  "pulse": {
    "definition": "@keyframes pulse { 0% {...} 100% {...} }",
    "consumers": [".streaming-dot", ".loading-pill"]
  }
}
```

### assets.ts

Walks the DOM for `<img>` `src`, SVG `<use>` hrefs, and `background-image` URLs in computed styles. Downloads files under 100KB. Larger files get a manifest entry (URL + dimensions) but are not fetched.

## Archetype catalog

Initial set in `archetypes.json`. Curate by opening Codex and using DevTools to inspect common UI regions. As of 2026-04-17, capture:

- `main-background` — body / root container
- `sidebar` — left nav surface
- `chat-area` — message scroll container
- `user-message` / `assistant-message` / `tool-message`
- `primary-button` / `secondary-button` / `ghost-button` / `icon-button`
- `text-input` / `textarea` / `select-trigger`
- `menu-item` / `menu-separator`
- `dialog-overlay` / `dialog-content`
- `tooltip`
- `tab` / `tab-indicator`
- `scrollbar-thumb`
- `code-block` / `inline-code`
- `badge` / `kbd`
- `link` / `link-visited`

Each archetype's `selectors` array tries multiple heuristics (data attrs, class names, tag+role combinations) — the first match wins. Multi-selector resilience is important because Codex's class names may be minified/hashed.

## Signed-app fallback

If `--remote-debugging-port=9222` is ignored (signed macOS apps strip unknown flags), the user launches Codex normally, opens DevTools (Cmd+Opt+I if available, or via `defaults write com.openai.codex DevTools -bool YES` + restart), pastes [`dev-console-snippet.js`](dev-console-snippet.js) into the console, and drops the downloaded `codex-dump.json` into `packages/ui/design-dump/codex/manual/`. A post-processor splits `manual/codex-dump.json` into the same layout as the CDP mode.

## Static-asset fallback

If DevTools is entirely unavailable:
```bash
cd /Applications/Codex.app/Contents/Resources/
npx @electron/asar extract app.asar /tmp/codex-unpacked/
```

Then grep `/tmp/codex-unpacked/` for `*.css`, `*.woff*`, and generated token files (Tailwind's JIT output). This yields static CSS but not runtime-resolved computed styles. Less preferred — the dynamic dump is richer.

## Output README

The dump directory always contains a `README.md` recording:
- Date of extraction
- Codex.app version (from `Contents/Info.plist` `CFBundleShortVersionString`)
- Mode used (automated / attached / dev-console / static-asar)
- Archetypes captured (vs. attempted-but-missing)
- Any warnings from the run

This is what future engineers read to know whether the dump is still current or needs re-running.
