# Risks & Open Questions

Known obstacles, with mitigations where available.

## 1. Codex.app may refuse `--remote-debugging-port`

**Symptom**: Launcher spawns Codex but `http://127.0.0.1:9222/json` never returns a page target; eventually times out.

**Why**: macOS strips unknown command-line flags from signed, notarized apps unless the app's entitlements include `com.apple.security.cs.allow-unsigned-executable-memory` and `com.apple.security.cs.disable-library-validation`. Codex may lack these.

**Mitigations, in order**:
1. Try a lower port (some apps reserve 9222). `--remote-debugging-port=9223`.
2. Set `ELECTRON_EXTRA_LAUNCH_ARGS=--remote-debugging-port=9222` in the environment before launching from Finder.
3. Fall back to the dev-console snippet. Requires DevTools being openable in Codex (Cmd+Opt+I). If DevTools is disabled:
   ```bash
   defaults write com.openai.codex DevTools -bool YES
   ```
   Then relaunch Codex. If that doesn't enable DevTools either:
4. Fall back to static asar extraction:
   ```bash
   npx @electron/asar extract /Applications/Codex.app/Contents/Resources/app.asar /tmp/codex-unpacked/
   ```
   This gives us the bundled CSS files directly but loses runtime-resolved computed styles and custom-property values.

## 2. Codex may use minified/hashed class names

**Symptom**: `archetypes.json` selectors don't match — `computed-styles.json` comes back empty for many archetypes.

**Why**: Production Electron apps typically ship with class names like `_1a2b3c` to reduce bundle size. Our heuristic selectors (`.PrimaryButton`, `[data-variant='primary']`) won't match.

**Mitigations**:
1. Add `[class*=…]` heuristics — `[class*="primary"]`, `[class*="Button"]` — to catch partial names.
2. Use DOM structure + role matching: `button[role='button']:first-of-type` within a dialog footer catches primary buttons positionally.
3. Manual selector discovery: open Codex's DevTools, hover over each archetype target, copy its selector, paste into `archetypes.json`. One-time cost.

## 3. Codex may not expose CSS custom properties

**Symptom**: `tokens.json` comes back sparse — only a handful of `--*` properties, none matching the rich palette the app visibly has.

**Why**: Modern CSS-in-JS frameworks (Tailwind JIT, styled-components, emotion) can emit inline styles or `@layer`-scoped rules without declaring variables on `:root`.

**Mitigations**:
1. Rely on `computed-styles.json` — we get resolved values per archetype even when they aren't tokenized.
2. Scan all rule text for `--*` declarations (not just `:root`) via regex; the extractor already does this.
3. Where Codex uses inline styles, scan the `style` attribute of key elements via `Runtime.evaluate`.
4. Accept that not every Codex "token" will be a variable — distill values from computed styles into Solo tokens regardless.

## 4. Inter ↔ SF Pro metrics mismatch

**Symptom**: Even with identical font-size tokens, text renders differently in Solo (SF Pro) vs Codex (possibly Inter or a custom font).

**Why**: SF Pro and Inter have different x-heights, cap heights, and letter-spacing defaults.

**Mitigations**:
1. Accept the drift — Solo is a native macOS app; SF Pro is the right call for system integration.
2. Adjust `letterSpacing` tokens to compensate if specific UI regions read noticeably different (usually minor).
3. If exact Codex text fidelity is required in a specific surface (e.g., a chat bubble), use Atkinson Hyperlegible (already in the font stack).

## 5. Shadow tokens don't translate 1:1

**Symptom**: Codex shadows look right at their intensity level, but the same rgba values look too heavy in Solo (or too light).

**Why**: Shadow perception depends on surrounding surface brightness and the CRT simulation of the display. Codex's exact shadow values may target a different baseline bg.

**Mitigations**:
1. Normalize: extract Codex shadows, then re-express relative to Solo's surface brightness delta.
2. Use OKLCH-interpolated shadows so they track with light/dark mode automatically.
3. Soft-clamp opacity values: dark-mode shadows never exceed 0.55 opacity at their strongest stop.

## 6. react-mosaic drop-target animations fight our motion tokens

**Symptom**: react-mosaic's built-in drop-target transitions conflict with Solo's motion vocabulary — they transition on `all` (fighting our `transition-[specific-props]` rule).

**Why**: Third-party library; we can't edit its CSS directly.

**Mitigations**:
1. Keep the mosaic overrides as-is in `apps/desktop/src/index.css` under the "REACT-MOSAIC OVERRIDES" section (already there).
2. Accept that mosaic's internal motion may differ slightly from our tokens — scope mosaic's own animations to the drop-target interaction only, which is a rare path.
3. If mosaic's motion becomes jarring, fork or replace the library (out of scope for this brainstorm).

## 7. Monaco's theme API and our token system

**Symptom**: Syntax highlighting colors come from Monaco's theme JSON, not from `tokens/colors.ts`. Any token change to `syntax-*` colors requires regenerating the Monaco theme.

**Why**: Monaco uses its own theme schema; it doesn't read CSS variables at runtime.

**Mitigations**:
1. Generate Monaco theme JSON from `tokens/colors.ts` at build time (small build script, run alongside `build-tokens`).
2. Or: accept the duplication, document both sources, add a manual-sync note to `tokens.md`.
3. Long-term: evaluate CodeMirror (which does respect CSS variables) as a replacement.

## 8. Tailwind v4 class merging edge cases

**Symptom**: `cn('rounded-md', 'rounded-sm')` should produce `rounded-sm` after twMerge, but some arbitrary-value overrides don't merge cleanly.

**Why**: twMerge's rule set may lag behind Tailwind v4 features.

**Mitigations**:
1. Keep `tailwind-merge` on a recent version (currently 3.4.1 in `@solo/ui`).
2. For primitives, never emit conflicting classes in the first place — branch on the variant/size prop before emitting.
3. If a specific utility family doesn't merge, explicitly `cn({'rounded-md': !override, 'rounded-sm': override})`.

## 9. Radix portal positioning vs our app shell

**Symptom**: Radix dialogs / popovers render in a portal at `document.body`, potentially escaping the `isolate` container and z-index stacking context, or rendering behind the Tauri titlebar.

**Why**: Radix portals bypass the React tree; z-index stacking is per-stacking-context.

**Mitigations**:
1. Use `portalProps` to target a specific container inside our main shell (`<div id="app-portal-root" />` just below the main `isolate` container).
2. Ensure our z-index token scale covers all Radix layers (modal=40, popover=50, tooltip=60, toast=70).
3. Test portal behavior in the gallery route against the titlebar and split panes.

## 10. Dark-mode drift during live token edits

**Symptom**: Editing a color in `colors.ts` updates light mode but not dark (or vice versa); developer forgets to update the other variant.

**Why**: Dark parity is a human-followed convention, not a type-system-enforced one.

**Mitigations**:
1. TypeScript type constraint: the `ColorTokens` type requires both `light` and `dark` keys with identical shapes. Adding a key to one requires adding it to the other — TS error otherwise.
2. Build-tokens script emits a warning if any color token has identical `light` and `dark` values (possible intent, possible omission).
3. Gallery route has a top-level "switch mode" button to eyeball both modes quickly.

## 11. The "extract Codex" step is aesthetically sensitive

**Symptom**: Distilled tokens from Codex don't feel right — Solo starts looking like a Codex clone rather than Solo-flavored.

**Why**: Extraction gives us values, not judgment. Values applied uncritically produce pastiche.

**Mitigations**:
1. Treat Codex extraction as a reference, not a prescription. Solo's accent is green; Codex's accent (whatever it is) doesn't override that.
2. Keep the Orbit Geist scale and warm-stone base — those are Solo-identity tokens, not Codex-derived.
3. When reconciling Codex-extracted values against Solo-existing values, prefer the Solo value unless the Codex value is materially better (clearer, more accessible, better-tuned for dark mode).

## 12. Extraction dump grows large over time

**Symptom**: `packages/ui/design-dump/codex/` accumulates dumps from multiple Codex versions; repo size balloons.

**Mitigations**:
1. Store only the most-recent dump's structured files; prior versions git-rm'd.
2. `assets/` is gitignored — don't accumulate icon binaries.
3. Stylesheets are text, compress well, can safely be committed.
4. If the dump exceeds 10MB, store in a separate git-lfs branch or move to an external asset repo.

## Open questions

- **Should the skill be Claude-Code-discoverable** (add to `.claude/skills/`) in addition to `.solo/skills/`? The user's current scheme is `.solo/` for Solo-native skills; answer depends on whether Solo's own agent routing consumes this or if only Claude Code does.
- **Is `__ui-gallery` a route or a dev-only environment variable**? Routes require wiring into the app's router (which depends on the router chosen); an env-gated dev component is simpler but less explorable.
- **Do we commit `tokens.css` or gitignore it**? Generated files are typically gitignored, but committing tokens.css means dev environments don't need the generator to see styles — argues for committing. Default: commit, with a CI check that regeneration produces no diff.

These are answered when this skill is invoked for the first time against a real task.
