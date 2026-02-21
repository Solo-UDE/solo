# Solo Prompt Engineering Documentation

This directory documents the prompt engineering behind Solo IDE -- the complete collection of system prompts, agent instructions, design rules, tool definitions, and model routing logic that power the Solo AI coding and design agents.

Originally ported from the reference codebase (Electron), these prompts have been adapted and hardened for Solo IDE (Tauri) with additional policies for icon consistency, emoji prohibition, performance best practices, and accessibility.

## Why This Matters

The single biggest differentiator between Solo and generic AI coding tools is **prompt quality**. The `<frontend_aesthetics>` block alone (documented in `01-frontend-aesthetics.md`) transformed AI-generated frontends from cookie-cutter templates into genuinely distinctive designs. Understanding these prompts is understanding what makes Solo work.

## Recent Hardening (2025)

### Phosphor Icons Integration

All agent prompts now enforce **Phosphor Icons** (`@phosphor-icons/react`) as the exclusive icon library:

- **Reference file**: `server/src/agents/coding/prompts/phosphor-icons-reference.ts` — 1,512 icon names extracted from `phosphor-icons/Fonts/regular/selection.json`
- **System prompt**: `<icon_policy>` block injects the full icon catalog so the model picks from real, existing names
- **All agents updated**: design-kit, template, clone prompts all reference Phosphor instead of Lucide
- **Emoji ban**: `<no_emoji_policy>` block prohibits emoji characters everywhere in generated code

### Vercel React Best Practices

Performance rules from Vercel Engineering (45 rules across 8 categories) are embedded in the `<performance_best_practices>` block:

- **CRITICAL**: Waterfall elimination (Promise.all, Suspense boundaries)
- **CRITICAL**: Bundle size (tree-shaking, dynamic imports, no barrel files)
- **HIGH**: Server components by default, minimal client serialization
- **MEDIUM**: Re-render optimization, GPU-only animations

Full reference: `.claude/skills/vercel-react-best-practices/AGENTS.md`

### Accessibility Baseline

`<accessibility_basics>` block ensures generated code includes semantic HTML, keyboard navigation, alt text, and `prefers-reduced-motion` support.

## File Index

| # | File | What It Covers | Priority |
|---|------|---------------|----------|
| 0 | `README.md` | This overview and quick-reference | -- |
| 1 | `01-frontend-aesthetics.md` | The anti-AI-slop design rules | **Critical** |
| 2 | `02-system-prompts-coding.md` | All coding agent system prompts | High |
| 3 | `03-design-system-agents.md` | Design generation pipeline prompts | High |
| 4 | `04-design-kit-system.md` | Complete design kit engine prompts | High |
| 5 | `05-specialized-agents.md` | Database, template, payments, clone agents | Medium |
| 6 | `06-model-routing.md` | Router system and model selection | Medium |
| 7 | `07-tool-definitions.md` | Tool description prompts | Medium |

## Source File Mapping

Each document maps to source files in the Solo server codebase (`solo-oauth/server/`):

| Document | Solo Source File(s) | Key Changes |
|----------|---------------------|-------------|
| `01-frontend-aesthetics.md` | `agents/coding/prompts/system.ts` | + icon_policy, no_emoji_policy, performance, a11y |
| `02-system-prompts-coding.md` | `agents/coding/prompts/system.ts` | Phosphor icon list injection via reference file |
| `03-design-system-agents.md` | `agents/design/prompts.ts`, `agents/design/tools/prompts.ts` | -- |
| `04-design-kit-system.md` | `agents/design-kit/prompts.ts` | Lucide -> Phosphor in ASSETS_USAGE |
| `05-specialized-agents.md` | `agents/template/prompts.ts`, `agents/clone/prompts.ts` | Lucide -> Phosphor in all |
| `06-model-routing.md` | `agents/coding/router.ts` | -- |
| `07-tool-definitions.md` | `agents/coding/tools/prompts.ts` | -- |

## Prompt Composition Architecture

Solo uses a composition pattern for prompts:

1. **Base blocks** -- Reusable XML-tagged sections like `<frontend_aesthetics>`, `<icon_policy>`, `<performance_best_practices>` that encode domain knowledge.
2. **Variant templates** -- Task-specific prompts (generate, edit, refactor) that include relevant base blocks via string interpolation.
3. **Runtime injection** -- The `buildSystemPrompt()` function interpolates workspace context, model info, and the Phosphor icon catalog at request time.
4. **Router dispatch** -- The router system classifies incoming requests and selects both the prompt variant and the model.

This architecture means a change to `<icon_policy>` instantly enforces Phosphor Icons across all agent variants.

## New Prompt Blocks Added

| Block | Purpose | Location |
|-------|---------|----------|
| `<icon_policy>` | Enforce Phosphor Icons, ban other icon libs | `system.ts` |
| `<no_emoji_policy>` | Ban emoji in all generated code/UI | `system.ts` |
| `<performance_best_practices>` | Vercel React perf rules (waterfall, bundle, SSR) | `system.ts` |
| `<accessibility_basics>` | Semantic HTML, keyboard nav, alt text, motion | `system.ts` |

## Quick Reference: Most Impactful Sections

### 1. `<frontend_aesthetics>` Block

**The single most impactful prompt block.** This XML block prevents AI-generated UIs from looking like "AI slop" by enforcing distinctive typography, dominant-color-with-accent palettes, staggered animation reveals, and atmospheric backgrounds.

### 2. `<icon_policy>` + `<no_emoji_policy>` Blocks

**Consistency enforcement.** The icon policy injects 1,512 real Phosphor icon names into the prompt so the model never hallucinates icon names or falls back to emoji/Lucide.

### 3. `<performance_best_practices>` Block

**Quality guardrails.** Embeds Vercel's top performance rules directly into every code generation request, preventing common mistakes like sequential awaits and barrel file imports.
