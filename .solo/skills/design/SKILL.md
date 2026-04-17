---
name: design
description: Solo IDE UI/UX design system. Use when building or refining Solo's interface, adding or modifying primitives in @solo/ui, defining or consuming design tokens, migrating existing ad-hoc CSS into the primitive system, or extracting design references from external Electron apps (e.g. Codex). Covers the full chain from empirical extraction to token distillation to primitive implementation.
enabled: true
priority: 30
---

# Solo Design System

This skill is the authoritative source for Solo IDE's visual language, primitive library, and the tooling that produced them. It exists in two layers:

**Layer 0 — Foundation.** How we capture a design reference (Codex.app, or any Electron app) via DevTools extraction, distill the dump into a token set, and reconcile the result against the Inspirations UI skill's rules.

**Layer 1 — Primitives.** How `@solo/ui` components are designed, what conventions they follow, and which primitives exist in the library.

This skill never invents aesthetics in isolation. Every token has a source: either an empirical extraction value, an existing Solo token being carried forward, or a skill guideline requirement. If you can't name the source, the token doesn't belong.

## When to invoke

- Adding a new primitive to `packages/ui/src/components/`
- Changing the value of any design token (color, type, spacing, radius, shadow, motion, z-index)
- Moving ad-hoc Tailwind markup out of an app component into a primitive
- Slimming `apps/desktop/src/index.css` by migrating styles into primitives or `@utility` blocks
- Running the Codex extraction pipeline (or any Electron-app-extraction variant)
- Resolving a tension between the Inspirations UI skill and Solo's needs
- Reviewing UI work for token compliance and skill-rule compliance

## When not to invoke

- Panel-level redesigns (file explorer, terminal, agent chat, editor chrome, settings, auth). Those are Layer-1.x subsystems and get their own specs that *consume* this skill.
- Rust/IPC/state changes — see `solo-conventions` skill.
- Third-party CSS overrides (react-mosaic, streamdown, shiki, tw-animate-css) — those are kept in `apps/desktop/src/index.css` under their respective sections and don't flow through this skill's token pipeline.

## Supporting files

Load the file that matches your task:

| File | When to load |
|---|---|
| [`architecture.md`](architecture.md) | Understanding the Layer 0 + Layer 1 directory and data-flow shape before changing anything structural |
| [`extraction.md`](extraction.md) | Running a new Codex (or other Electron app) extraction; diagnosing extractor failures |
| [`dev-console-snippet.js`](dev-console-snippet.js) | The pastable one-liner for extracting CSS from a running Electron app without launching via CDP |
| [`tokens.md`](tokens.md) | Adding/changing a token; understanding the token shape, naming rules, and token→Tailwind mapping |
| [`primitives.md`](primitives.md) | Adding a new primitive; understanding variant/size/tone conventions; resolving prop-API decisions |
| [`reconciliation.md`](reconciliation.md) | Any rule from `Inspirations/Skills/ui/design-guidelines/` that Solo deviates from and why |
| [`sequencing.md`](sequencing.md) | Bootstrapping the system from scratch, or understanding the intended build order when multiple layers change together |
| [`risks.md`](risks.md) | Hit an unexpected obstacle — check whether it's a known risk with a documented mitigation before debugging from scratch |

## Invariants

These cannot be violated without updating this skill first:

1. **No raw color/font/radius/shadow/motion literals inside `@solo/ui` components.** Only token-derived utilities. Enforced by grep in CI: `rg "bg-(white|black|gray|slate|zinc|stone|neutral)|rounded-\[|shadow-\[|duration-\[" packages/ui/src/components/` must return zero matches.
2. **Tokens flow in one direction.** `tokens/*.ts` is the source of truth; `tokens.css` is generated; `@theme inline` in `index.css` references the CSS variables only. Do not edit `tokens.css` by hand.
3. **Primitives never bake in margin.** Call sites own spacing. Every primitive accepts `className` and merges it last.
4. **Every deviation from the Inspirations UI skill lives in `reconciliation.md`.** A deviation that isn't documented is a bug.
5. **Radix for anything stateful.** Switch, Checkbox, Dialog, Tooltip, Menu, Tabs, ScrollArea, Select, Popover, ContextMenu all wrap Radix primitives. No from-scratch open/close/selected-state implementations.
6. **The design-dump is gitignored for assets, committed for structured data.** `packages/ui/design-dump/codex/*.json` and `*.css` are committed; `packages/ui/design-dump/codex/assets/` is gitignored.

## Entry routing

| Prompt shape | Start by reading |
|---|---|
| "Add a $PRIMITIVE to @solo/ui" | `primitives.md` → `tokens.md` → existing primitive (e.g. `Button.tsx`) as exemplar |
| "Change the primary color" | `tokens.md` → `reconciliation.md` (skill rules about accents) → `packages/ui/src/tokens/colors.ts` |
| "Pull the latest Codex design" | `extraction.md` → `dev-console-snippet.js` (fallback) → `architecture.md` |
| "Solo's CSS is too long — slim it" | `sequencing.md` (step 9) → `primitives.md` (what's migratable) → `architecture.md` |
| "Does rule X from the Inspirations skill apply?" | `reconciliation.md` first; update it if the rule isn't catalogued |

## Commands

Token regeneration after editing `tokens/*.ts`:

```bash
cd solo && bun run --filter @solo/ui build-tokens
```

Run Codex extraction (requires Codex.app installed):

```bash
cd solo && bun scripts/codex-extract/launch.ts
```

Verify primitive compliance:

```bash
cd solo && bun run check && rg "bg-(white|black|gray|slate|zinc|stone|neutral)|rounded-\[|shadow-\[" packages/ui/src/components/
```
