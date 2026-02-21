# 04 - Design Kit System

Source: Reference prompt system — `agents/design-kit/prompts.ts` (1,288 lines)

## Overview

The design kit system is a multi-stage pipeline that transforms user references (screenshots, assets, text descriptions) into a complete, tokenized design system expressed as CSS custom properties. It works by first generating a holistic XML design kit document, then running specialized per-token prompts to extract each design dimension in depth, and finally converting everything to Tailwind CSS v4 compatible tokens.

---

## All 15 Exports

### Core Kit Prompts

| Export | Lines | Description |
|--------|-------|-------------|
| `DESIGN_KIT_MAKER_PROMPT` | ~114 | Main prompt that generates a complete XML design kit from references. Defines the output schema (name, metadata, color_system, typography, spacing, shadows, borders_and_radius, animations, components, layout, assets_usage). |
| `buildDesignKitMakerUserPrompt` | ~10 | Template function: wraps `userRequest` + `references` in XML tags. |
| `DESIGN_KIT_EDITOR_SYSTEM_PROMPT` | ~32 | Evolves an existing design kit by incorporating new references while preserving prior decisions. Minimize change surface; prefer additive, backwards-compatible updates. |
| `buildDesignKitEditorUserPrompt` | ~14 | Template function: wraps `existingDesignKit` + `newReferences` + `userRequest`. |
| `DESIGN_KIT_REMOVER_SYSTEM_PROMPT` | ~40 | Removes specific reference influences from a design kit while preserving remaining references. Handles three cases: solely from removed ref (replace), shared (strengthen remaining), critical tokens (select best alternative). |
| `buildDesignKitRemoverUserPrompt` | ~16 | Template function: wraps `existingDesignKit` + `referencesToRemove` + `remainingReferences` + `userRequest`. |

### CSS Token Generation

| Export | Lines | Description |
|--------|-------|-------------|
| `DEFAULT_CSS_STYLES` | ~84 | Default `:root` and `.dark` CSS blocks with all shadcn/UI token variables (--background, --foreground, --primary, etc.) as starting template for modification. |
| `COLORS_TOKENS_MODIFIER_SYSTEM_PROMPT` | ~35 | Takes the default style blocks + design kit, modifies token values to match. HEX only. Preserves all existing tokens, may add new ones. |
| `buildColorsTokensModifierUserPrompt` | ~10 | Template function: wraps `defaultStyleBlock` + `designKit`. |

### Per-Token Specialized Prompts

| Export | Lines | Description |
|--------|-------|-------------|
| `METADATA_SYSTEM_PROMPT` | ~46 | Generates kit name, description, aesthetic philosophy, target audience, use cases, and 5-7 design principles. |
| `COLOR_SYSTEM_SYSTEM_PROMPT` | ~48 | Comprehensive color system: primary brand color with tints/shades, 10-12 neutral shades, semantic colors (success/warning/error/info), interactive state colors, dark mode considerations, WCAG compliance. |
| `TYPOGRAPHY_SYSTEM_PROMPT` | ~50 | Font families (sans, serif, mono) with Google Fonts URLs, complete type scale (Display through Caption), responsive considerations with `clamp()`, special treatments (letter-spacing, tabular figures). |
| `SPACING_SYSTEM_PROMPT` | ~62 | Base-8 spacing scale (xs through 6xl), container system with breakpoints, component-specific patterns (cards, forms, buttons, nav), responsive multipliers, optical adjustments. |
| `SHADOWS_SYSTEM_PROMPT` | ~80 | 7-level elevation scale (flat through high emphasis) with multi-layered shadows, interactive transitions, inner shadows, colored shadows, glow effects, text shadows, dark mode adjustments, performance notes. |
| `BORDERS_AND_RADIUS_SYSTEM_PROMPT` | ~65 | Radius scale (none through full/pill), nested radius math (outer - padding = inner), border widths (0-4px), styles (solid/dashed/dotted/double), focus ring specs, gradient borders, transitions. |
| `ANIMATIONS_SYSTEM_PROMPT` | ~110 | Duration scale (instant 0ms through slowest 800ms), 7 easing functions with cubic-bezier values, GPU-accelerated properties, common patterns (fade, slide, scale, rotation, stagger), reduced-motion media query. |
| `COMPONENTS_SYSTEM_PROMPT` | ~135 | Detailed specs for: buttons (primary/secondary/ghost + size variants), inputs (with validation states), cards (elevated/interactive/compact), badges, avatars, toggles, checkboxes, modals, tooltips, navigation, data display. |
| `LAYOUT_SYSTEM_PROMPT` | ~155 | 12-column grid, responsive breakpoints (xs through 2xl), container system (fluid/fixed/prose), layout patterns (hero, nav, sidebar, card grids, forms, content, footer), CSS Grid templates, Flexbox patterns, accessibility. |
| `ASSETS_USAGE_SYSTEM_PROMPT` | ~35 | Asset usage guidelines: brand assets with absolute URLs, logo usage rules, icon sizing, font implementation, image treatments. Prefers provided asset URLs over alternatives. |

Each per-token prompt also has a corresponding `build*UserPrompt` template function.

---

## DESIGN_KIT_MAKER_PROMPT Detail

The main kit maker prompt defines:

**Role:** "Globally renowned website and web app designer whose work graces Awwwards & FWA shortlists"

**Design Philosophy:**
- Sophisticated Minimalism: every element serves a clear purpose
- Human-Centered: prioritize user needs over designer ego
- Timeless Elegance: enduring design principles
- Strategic Innovation: novel elements only when they genuinely enhance UX
- Professional Excellence: appropriate for enterprise contexts
- Contextual Component Strategy: existing blocks for landing pages, custom for apps

**Design Principles:**
- Visual Hierarchy: one professional typeface family, clear type scale, readability first
- Color Strategy: monochromatic foundation, single accent color, one subtle secondary if needed, functional colors for app states
- Spatial Design: generous whitespace, consistent grid, density by context
- Interactive Design: subtle animations, predictable patterns, functionality first, accessibility first

**Output Schema (XML):**
```xml
<name>Design kit name</name>
<metadata>Description, aesthetic, target audience, use cases</metadata>
<color_system>Primary, neutrals, semantic, secondary, backgrounds</color_system>
<typography>Sans, mono, serif with Google Fonts URLs</typography>
<spacing>Base unit 8px, scale xs-3xl, container values</spacing>
<shadows>Elevation system, special effects</shadows>
<borders_and_radius>Radius scale, border styles</borders_and_radius>
<animations>Transitions, easings, animated properties</animations>
<components>Buttons, inputs, cards, other patterns</components>
<layout>Grid, breakpoints, layout patterns</layout>
<assets_usage>Brand assets and usage rules</assets_usage>
```

---

## Pipeline Flow

```
User Request + References
        |
        v
  DESIGN_KIT_MAKER_PROMPT  -->  XML Design Kit Document
        |
        v
  Per-Token Prompts (can run in parallel):
  +-- METADATA_SYSTEM_PROMPT
  +-- COLOR_SYSTEM_SYSTEM_PROMPT
  +-- TYPOGRAPHY_SYSTEM_PROMPT
  +-- SPACING_SYSTEM_PROMPT
  +-- SHADOWS_SYSTEM_PROMPT
  +-- BORDERS_AND_RADIUS_SYSTEM_PROMPT
  +-- ANIMATIONS_SYSTEM_PROMPT
  +-- COMPONENTS_SYSTEM_PROMPT
  +-- LAYOUT_SYSTEM_PROMPT
  +-- ASSETS_USAGE_SYSTEM_PROMPT
        |
        v
  COLORS_TOKENS_MODIFIER_SYSTEM_PROMPT
  (DEFAULT_CSS_STYLES + design kit --> modified :root/.dark blocks)
        |
        v
  globals.css with design tokens
```

**Editing flow:** When references are added or removed, `DESIGN_KIT_EDITOR_SYSTEM_PROMPT` or `DESIGN_KIT_REMOVER_SYSTEM_PROMPT` is used to evolve the existing kit incrementally rather than regenerating from scratch.

---

## Key Design Decisions

1. **XML as intermediate format:** The design kit is stored as XML, making it parseable by downstream tools and easy to diff when editing.

2. **Per-token parallelism:** Each design dimension (colors, typography, spacing, etc.) has its own specialized prompt, allowing parallel generation.

3. **Additive editing:** The editor prompt emphasizes minimal change surface and backwards compatibility, preserving token names and semantics.

4. **HEX-only colors:** All color values must be HEX, enforced across multiple prompts, for consistency with the CSS token modifier.

5. **Reference-driven:** Everything flows from user-provided references (screenshots, assets, writeups). The per-token prompts always include `<inputs>` sections expecting `User Request` + `References`.
