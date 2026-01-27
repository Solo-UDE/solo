---
name: orbit-ui-skill
description: Applies modern soft UI design patterns using shadows instead of borders, spring-based animations, and consistent design tokens. Use when styling React components, building user interfaces, creating animations, implementing design systems, working with Tailwind CSS, or when the user mentions UI, styling, buttons, inputs, modals, panels, cards, or animations.
---

# Solo IDE UI Design System

Modern, soft UI patterns for polished interfaces in Solo IDE.

## Quick Reference

| What you need | File |
|---------------|------|
| **Tailwind v4 + shadcn/ui setup** | [tailwind-v4-shadcn.md](tailwind-v4-shadcn.md) |
| Visual design (colors, spacing, components) | [design-system.md](design-system.md) |
| Radix UI component patterns | [radix-components.md](radix-components.md) |
| Lucide React icons | [lucide-icons.md](lucide-icons.md) |
| Zustand state management | [zustand-patterns.md](zustand-patterns.md) |
| Motion & animations | [animations.md](animations.md) |
| Drop-in CSS variables | [tokens.css](tokens.css) |

---

## CRITICAL: Tailwind v4 Pattern

**Always use this CSS structure:**

```css
@import "tailwindcss";
@import "tw-animate-css";

:root { /* Light mode OKLCH colors */ }
.dark { /* Dark mode OKLCH colors */ }

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* ... map all colors */
}
```

**See [tailwind-v4-shadcn.md](tailwind-v4-shadcn.md) for complete guide.**

---

## Tech Stack

- **UI Framework:** React 19 + TypeScript 5.7
- **Styling:** Tailwind CSS v4 + `@theme inline` + OKLCH colors
- **Animation:** `tw-animate-css` (NOT tailwindcss-animate)
- **Components:** Radix UI primitives + shadcn-style wrappers
- **Icons:** Lucide React
- **State:** Zustand (pure functions, no middleware)
- **Editor:** CodeMirror 6
- **Terminal:** xterm.js

---

## Core Philosophy

- **Shadows over borders** - soft elevation, no hard 1px lines
- **Generous spacing** - breathing room between elements
- **Soft corners** - 8-14px radius on most elements
- **Subtle interactions** - scale transforms, 150-200ms transitions
- **Backdrop blur** - glassmorphism on floating elements
- **OKLCH colors** - proper opacity modifier support

---

## The Three Easing Curves

```css
/* Spring - buttons, cards, micro-interactions */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

/* Smooth - modals, panels, page transitions */
--ease-smooth: cubic-bezier(0.16, 1, 0.3, 1);

/* Snappy - toggles, tooltips, loaders */
--ease-snappy: cubic-bezier(0.4, 0, 0.2, 1);
```

---

## Standard Values

| Token | Value |
|-------|-------|
| Button/Input height | 34-40px |
| Border radius (inputs) | 8-10px |
| Border radius (panels) | 12-14px |
| Border radius (floating) | 14-16px |
| Transition duration | 150-200ms |
| Hover scale | 1.02-1.05 |
| Press scale | 0.95-0.97 |

---

## Quick Patterns

**Floating Panel:**
```
bg-card/95 backdrop-blur-md rounded-[14px]
shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)]
```

**Button Primary:**
```
h-[34px] px-3.5 rounded-[10px] bg-primary text-primary-foreground
hover:brightness-110 active:scale-[0.97] transition-all duration-200
```

**Button Ghost:**
```
h-[34px] px-3 rounded-[10px] bg-transparent
hover:bg-muted hover:scale-[1.02] active:scale-[0.97]
```

**Input (shadcn/ui style):**
```
h-9 px-3 rounded-lg bg-card border border-border/60
focus:border-primary/50 focus:ring-2 focus:ring-primary/20
placeholder:text-muted-foreground
```

**Icon Button:**
```
w-8 h-8 rounded-lg hover:bg-muted hover:scale-105 active:scale-95
```

---

## Don'ts

- Hard 1px borders on containers
- Uppercase labels
- Instant state changes (always use transitions)
- Bright focus rings
- Red delete buttons at rest
- Small click targets (min 32px)
- Using HEX colors in `@theme` (use OKLCH)
- Using `tailwindcss-animate` (use `tw-animate-css`)

---

## Layout Dimensions

```typescript
SIDEBAR: { collapsed: 40, expanded: 256, min: 200, max: 400 }
HEIGHTS: { headerBar: 35, statusBar: 24, panelHeader: 32 }
PANEL_SIZES: { activity: { default: 400, min: 300, max: 600 } }
```

---

## Performance

Only animate GPU-accelerated properties:
```css
/* Good */ transform, opacity
/* Avoid */ width, height, top, left, margin, padding
```

Always respect `prefers-reduced-motion`.
