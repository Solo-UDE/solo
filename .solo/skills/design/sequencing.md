# Implementation Sequencing

The bootstrap order for building this system from scratch, or for re-running after a major overhaul.

## Phase order

```
1. Extraction tooling         ┐
2. Run extraction             ├── Layer 0
3. Token source files         │
4. Token CSS generator        │
5. Skill reconciliation       ┘
───────────────────────────────────
6. Rewrite existing primitives┐
7. Add new primitives         ├── Layer 1
8. Gallery route              │
9. Migrate app call sites     │
10. Slim index.css            ┘
───────────────────────────────────
11. Verify & commit per-file
```

Each phase gates the next. A partial Phase 3 doesn't enable Phase 6 — primitives can't be rewritten until their tokens exist.

## Phase 1 — Extraction tooling

Build `scripts/codex-extract/`:
- `launch.ts` — spawn logic
- `extract.ts` — CDP client + orchestrator
- `extractors/*.ts` — six extractors (stylesheets, computed, fonts, tokens, keyframes, assets)
- `archetypes.json` — initial selector catalog
- `snippets/dev-console.js` — the fallback snippet (symlinked from `.solo/skills/design/dev-console-snippet.js`)

**Gate**: `bun scripts/codex-extract/launch.ts --dry-run` succeeds — exits cleanly without actually running Codex, printing what it *would* do.

## Phase 2 — Run extraction

With Codex.app installed:
```bash
cd solo && bun scripts/codex-extract/launch.ts
```

Output lands in `packages/ui/design-dump/codex/`. Commit the structured files (`*.json`, `stylesheets/*.css`, `README.md`); gitignore `assets/`.

**Gate**: `design-dump/codex/computed-styles.json` contains entries for ≥10 archetypes. If fewer, update `archetypes.json` with better selectors and re-run.

## Phase 3 — Token source files

Create `packages/ui/src/tokens/*.ts` as per `tokens.md`. Seed from:
- `design-dump/codex/tokens.json` (Codex's CSS custom properties)
- `design-dump/codex/computed-styles.json` (resolved values for archetypes when tokens aren't named)
- Current Solo tokens in `packages/ui/src/styles.css` and `apps/desktop/src/index.css`

Every token line has a trailing comment recording its source.

**Gate**: `bun run --filter @solo/ui typecheck` passes.

## Phase 4 — Token CSS generator

Create `packages/ui/scripts/build-tokens.ts`. Wire it into `packages/ui/package.json`:

```json
{
  "scripts": {
    "build-tokens": "bun scripts/build-tokens.ts",
    "typecheck": "bun run build-tokens && tsc --noEmit"
  }
}
```

Run it to generate `packages/ui/src/tokens.css`. Update `packages/ui/src/styles.css` to `@import "./tokens.css"` at the top.

Update `apps/desktop/src/index.css` `@theme inline` block to consume the new CSS variables (most already exist — confirm each maps cleanly).

**Gate**: `bun run check` passes; visual comparison of the app before/after shows no regressions (tokens should resolve to the same values the app was already using).

## Phase 5 — Skill reconciliation

Write `packages/ui/src/skill-reconciliation.md` based on the template in `.solo/skills/design/reconciliation.md`. For each rule in the Inspirations skill's `design-guidelines/`:
1. Mark as ✓/✗/N/A
2. If ✗, write the rationale

This is a documentation phase — no code changes.

**Gate**: every file in `Inspirations/Skills/ui/design-guidelines/` appears in the reconciliation doc.

## Phase 6 — Rewrite existing primitives

In this order (dependency-respecting):

1. **Spinner** (new — Button depends on it)
2. **Button** (rewrite)
3. **IconButton** (rewrite — depends on same token patterns as Button)
4. **Input** (rewrite)
5. **Textarea** (new)
6. **Panel** (rewrite)
7. **Skeleton** (rewrite)

Each rewrite:
- Removes raw color/radius/shadow/motion literals
- Uses only token-derived utilities
- Doc comment with variants/sizes/skill-compliance notes

**Gate** per primitive:
```bash
rg "bg-(white|black|gray|slate|zinc|stone|neutral)|rounded-\[|shadow-\[|duration-\[" packages/ui/src/components/<Name>.tsx
# → zero matches
bun run check
```

## Phase 7 — Add new primitives

In priority order (dependencies first, then by frequency of need):

1. **Separator** (Radix — needed by menus and dialogs)
2. **Kbd**
3. **Badge**
4. **Tooltip** (Radix — needed by IconButton hover labels throughout the app)
5. **Dialog** (Radix — confirm/alert flows)
6. **Menu** (Radix DropdownMenu — everywhere context menus are used)
7. **ContextMenu** (Radix — file tree, editor right-click)
8. **Tabs** (Radix — editor tabs, settings, panels)
9. **ScrollArea** (Radix — agent chat, file tree, anywhere custom scrollbars matter)
10. **Switch** (Radix — settings toggles)
11. **Checkbox** (Radix — multi-select lists)
12. **Radio** (Radix — exclusive choice in settings)
13. **Select** (Radix — dropdowns in forms)
14. **Combobox** (cmdk — command palette, file search)
15. **Popover** (Radix — transient overlays)
16. **Avatar** (user presence in chat)
17. **Toast** (Sonner — notifications)

**Gate** per primitive: same as Phase 6.

## Phase 8 — Gallery route

Create `apps/desktop/src/routes/__ui-gallery/page.tsx`. Wire into router so `?__gallery=1` (or an env-gated condition in dev) renders it.

**Gate**: every primitive appears in the gallery, every variant and size demoed, hover/focus/disabled states reachable.

## Phase 9 — Migrate app call-sites

Walk `apps/desktop/src/components/` breadth-first. For each file:

1. Identify primitive use (button / input / dialog / menu / tab / tooltip markup).
2. Replace with `<Button>` / `<Input>` / etc.
3. Commit per-file with a descriptive message.

**Do not** redesign panel layouts in this phase. Swap primitives only. Panel-level redesigns are subsequent Layer-1.x brainstorms.

**Gate** per file:
```bash
bun run check
```

## Phase 10 — Slim `apps/desktop/src/index.css`

The current file is ~1400 lines. Much of it is migratable:
- Motion keyframes → `tokens/motion.ts` (already done in Phase 3)
- `@theme inline` color mappings → consume tokens directly
- `.glow-active`, `.glow-active-text`, `.shadow-glass`, `.shell-shadow`, `.glow-primary`, `.hover-lift` → `@utility` blocks in `styles.css`
- Chat-surface styles (`.chat-surface`) → if only used in agent chat, move to agent panel; otherwise make `@utility`
- Streamdown / Shiki / mosaic overrides → **keep** as-is (third-party)
- `.titlebar-glass`, `.split-divider`, `.sidebar-reopen-sliver` → IDE-shell-specific, stay in `index.css` under an "IDE Shell" section

Target: ~500–600 lines, clearly sectioned.

**Gate**: app renders identically before/after (screenshot comparison via the gallery and dev mode).

## Phase 11 — Verify & commit per-file

1. `bun run check` — passes
2. `cargo clippy --workspace` — passes
3. `bun run test` — passes
4. Visual check via gallery + dev mode
5. Commit per-file per user convention (no Claude attribution, one commit per file, descriptive subject)

## Partial re-runs

Not every change requires the full 11-phase sweep.

| Change | Phases to run |
|---|---|
| Add a new color token | 3, 4 (regenerate CSS), any affected primitive |
| Add a new primitive | 7 (just the new primitive), 8 (add to gallery) |
| Update Codex extraction | 1 (if tool change), 2 (re-run), 3 (reconcile values), 4 |
| Migrate a panel off ad-hoc markup | 9 (that panel's files only), 11 |
| Revise a skill-deviation rationale | 5 only |

## Estimated scope

Phases 1–5 (Layer 0): ~1–2 days.
Phases 6–8 (Layer 1 primitives): ~2–3 days.
Phases 9–10 (migration & slimming): ~1–2 days.
Phase 11 (verify & commit): ~0.5 days.

Total: ~5–7 focused working days if done serially. Can parallelize Phases 6 and 7 (primitive rewrites are independent) and Phase 9 (per-file migrations are independent) with a dispatching-parallel-agents approach.
