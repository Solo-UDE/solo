# Design Tokens

The single source of truth for Solo's visual language. Tokens live in TypeScript (`packages/ui/src/tokens/*.ts`), are generated into CSS (`packages/ui/src/tokens.css`), and consumed by every primitive via Tailwind v4's `@theme inline` mechanism in `apps/desktop/src/index.css`.

## Principles

1. **Every token has a source.** Either (a) an empirical value from `design-dump/codex/`, (b) an existing Solo token being carried forward, or (c) a skill-rule-required value. The source is noted in a trailing `// …` comment on the token line.
2. **Tokens are literally typed.** No `Record<string, string>`. Use `as const` so callers get autocompletion on token names.
3. **Tokens never reference each other at TS level.** Composition (e.g. a button's hover color being `color-mix(in oklch, primary 90%, black)`) happens in CSS, not TS. TS tokens are leaf values.
4. **Dark-mode parity.** Every color token has a `light` and a `dark` value. Typography/spacing/radii/shadows have dark-mode overrides only when the visual weight must change (shadows soften in dark; everything else stays).
5. **No magic numbers.** If a component needs a value between tokens, add a token. Don't pass arbitrary values in Tailwind classes.

## File layout

```
packages/ui/src/tokens/
├── colors.ts
├── typography.ts
├── spacing.ts
├── radii.ts
├── shadows.ts
├── motion.ts
├── z-index.ts
└── index.ts          barrel: re-exports every token group
```

Each file exports a `const` object with a fixed shape. `index.ts` re-exports them as named exports AND as a bundled `tokens` object for iteration.

## Token categories

### 1. Colors (`colors.ts`)

Shape:
```ts
export const colorTokens = {
  light: {
    background: 'oklch(0.972 0.004 85)',      // Codex bg
    foreground: 'oklch(0.24 0.008 85)',       // Codex fg
    card: 'oklch(0.992 0.003 85)',
    // ...
  },
  dark: { /* same keys, dark values */ },
} as const;

export type ColorToken = keyof typeof colorTokens.light;
```

**Required key groups:**

- **Surfaces**: `background`, `foreground`, `card`, `cardForeground`, `popover`, `popoverForeground`, `muted`, `mutedForeground`, `accent`, `accentForeground`, `sidebar`, `sidebarForeground`, `sidebarBorder`, `chatArea`, `toolOutputBg`
- **Semantic**: `primary`, `primaryForeground`, `secondary`, `secondaryForeground`, `destructive`, `destructiveForeground`, `ring`, `border`, `input`
- **Status**: `success`, `successMuted`, `successForeground`, `warning`, `warningMuted`, `warningForeground`, `info`, `infoMuted`, `infoForeground`, `statusSuccess`, `statusWarning`, `statusError`
- **File types**: `fileFolder`, `fileCode`, `fileConfig`, `fileText`, `fileImage`
- **Agent**: `agentUserBg`, `agentAssistantBg`, `agentToolBg`, `agentStreaming`
- **Repo identity** (10): `repoBlue{,Muted,Fg}`, `repoOrange{,Muted,Fg}`, `repoEmerald{,Muted,Fg}`, `repoViolet{,Muted,Fg}`, `repoRose{,Muted,Fg}`, `repoAmber{,Muted,Fg}`, `repoCyan{,Muted,Fg}`, `repoTeal{,Muted,Fg}`, `repoPink{,Muted,Fg}`, `repoLime{,Muted,Fg}`
- **Syntax** (10): `syntaxKeyword`, `syntaxString`, `syntaxType`, `syntaxFunction`, `syntaxVariable`, `syntaxComment`, `syntaxNumber`, `syntaxControl`, `syntaxOperator`, `syntaxBracket`
- **Orbit Geist scale** (10): `orbit100` through `orbit1000`

**Format rules:**

- Use OKLCH. RGB/HSL/hex are only allowed for scale values (`orbit100`–`orbit1000`) where legacy hex is already documented.
- No `gray-*` / `slate-*` defaults (skill rule).
- Primary is Solo green. Never indigo (skill rule).
- Destructive is warm red, distinct enough from warning amber (contrast testing: run both through OKLCH delta-E, require ≥15 difference).

### 2. Typography (`typography.ts`)

```ts
export const typographyTokens = {
  fontFamily: {
    sans: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
    mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    chat: '"Atkinson Hyperlegible Next Variable", "Atkinson Hyperlegible Next", sans-serif',
  },
  fontSize: {
    '2xs': '0.6875rem',   // 11px - chrome labels only
    xs:   '0.75rem',      // 12px - chrome body
    sm:   '0.8125rem',    // 13px - app baseline
    base: '0.875rem',     // 14px - relaxed body
    md:   '1rem',         // 16px - form inputs (mobile rule doesn't apply, still good minimum)
    lg:   '1.125rem',     // 18px
    xl:   '1.25rem',      // 20px
    '2xl':'1.5rem',       // 24px
    '3xl':'1.75rem',      // 28px
    '4xl':'2rem',         // 32px
    '5xl':'2.5rem',       // 40px
    '6xl':'3rem',         // 48px
  },
  fontWeight: {
    normal: 400,
    book:   430,   // chat body (existing)
    medium: 500,
    semibold: 600,
    bold:   700,
  },
  lineHeight: {
    tight:   1.2,
    normal:  1.5,
    chat:    1.68,
    relaxed: 1.8,
  },
  letterSpacing: {
    tight:   '-0.01em',
    normal:  '0',
    wide:    '0.025em',
  },
  fontFeatureSettings: {
    default: '"rlig" 1, "calt" 1',
    chat:    '"rlig" 1, "calt" 1, "cv11" 1',
    tabular: '"tnum" 1',
  },
} as const;
```

Notes:
- `sans` uses SF Pro (native macOS). Deviation from skill's Inter default — documented in `reconciliation.md`.
- `'2xs'` (11px) is permitted only in dev-tool chrome (status bars, keyboard shortcut labels, scopes never reached by reading text). The primitives gallery tests this rule.
- `book` (430) is from existing chat body — keep for prose legibility without the heaviness of 500.

### 3. Spacing (`spacing.ts`)

Base-4 scale, aligned with Tailwind defaults. Exposed for JS consumers (animation libraries, measured layouts) that need programmatic access.

```ts
export const spacingTokens = {
  0:   '0',
  px:  '1px',
  0.5: '0.125rem',
  1:   '0.25rem',
  1.5: '0.375rem',
  2:   '0.5rem',
  // ... standard Tailwind scale
  96:  '24rem',
} as const;
```

### 4. Radii (`radii.ts`)

```ts
export const radiiTokens = {
  none: '0',
  sm:   '0.25rem',    // 4px
  md:   '0.375rem',   // 6px
  lg:   '0.625rem',   // 10px
  xl:   '0.875rem',   // 14px
  '2xl':'1rem',       // 16px
  full: '9999px',
} as const;
```

Concentric-radius rule applies: nested rounded elements derive inner radius via `calc(var(--radius-outer) - var(--padding))`.

### 5. Shadows (`shadows.ts`)

Elevation scale (light mode):
```ts
export const shadowTokens = {
  light: {
    none: '0 0 #0000',
    xs:   '0 1px 2px 0 rgb(0 0 0 / 0.04)',
    sm:   '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md:   '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
    lg:   '0 10px 15px -3px rgb(0 0 0 / 0.10), 0 4px 6px -4px rgb(0 0 0 / 0.06)',
    xl:   '0 20px 25px -5px rgb(0 0 0 / 0.10), 0 8px 10px -6px rgb(0 0 0 / 0.08)',
    glass:
      '0 16px 30px -26px rgb(0 0 0 / 0.18), 0 6px 12px -10px rgb(0 0 0 / 0.10)',
    shell:
      '0 20px 48px -34px rgb(0 0 0 / 0.20), 0 6px 16px -14px rgb(0 0 0 / 0.12)',
    glowPrimary:
      '0 4px 16px -2px color-mix(in oklch, var(--primary) 25%, transparent), 0 0 0 1px color-mix(in oklch, var(--primary) 8%, transparent)',
  },
  dark: {
    /* softened for dark mode (not removed — desktop app, no invert concern) */
  },
} as const;
```

**Deviation**: the skill says "Remove all shadows in dark mode." We *soften* instead. Rationale in `reconciliation.md`.

### 6. Motion (`motion.ts`)

```ts
export const motionTokens = {
  duration: {
    instant: 0,
    fast:    100,
    base:    150,
    medium:  200,
    slow:    300,
    slower:  500,
  },
  easing: {
    spring:   'cubic-bezier(0.34, 1.56, 0.64, 1)',
    smooth:   'cubic-bezier(0.16, 1, 0.3, 1)',
    snappy:   'cubic-bezier(0.4, 0, 0.2, 1)',
    outQuart: 'cubic-bezier(0.165, 0.85, 0.45, 1)',
  },
  keyframes: {
    fadeInScale: '@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }',
    fadeOut:     '@keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }',
    popIn:       '@keyframes pop-in { from { opacity: 0; transform: scale(0.9) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }',
    slideUp:     '@keyframes slide-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }',
    streamingDot:'@keyframes streaming-dot { 0%,100% { opacity: 0.3; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }',
    shimmer:     '@keyframes shimmer { 0% { background-position: 200% center; } 100% { background-position: -200% center; } }',
    flowTokenIn: '@keyframes flow-token-in { from { opacity: 0; } to { opacity: 1; } }',
  },
} as const;
```

Every animation uses these tokens. No ad-hoc `duration-[237ms]` or inline cubic-bezier.

### 7. Z-index (`zIndex.ts`)

```ts
export const zIndexTokens = {
  base:     0,
  dropdown: 10,
  sticky:   20,
  overlay:  30,
  modal:    40,
  popover:  50,
  tooltip:  60,
  toast:    70,
} as const;
```

## Generator (`scripts/build-tokens.ts`)

Reads every file in `packages/ui/src/tokens/*.ts`, writes `packages/ui/src/tokens.css`:

```css
:root {
  --background: oklch(0.972 0.004 85);
  --foreground: oklch(0.24 0.008 85);
  /* ... colors (light) */
  /* ... typography */
  /* ... spacing */
  /* ... radii */
  /* ... shadows (light) */
  /* ... motion */
  /* ... z-index */
}

html.dark {
  --background: oklch(0.145 0.006 75);
  /* ... colors (dark) */
  /* ... shadows (dark) */
}

@keyframes fade-in-scale { ... }
/* ... keyframes */
```

Run via `bun run --filter @solo/ui build-tokens`. Runs automatically before every `packages/ui` typecheck so `tokens.css` never drifts.

## Tailwind integration

`apps/desktop/src/index.css` maps these CSS variables into Tailwind theme tokens:

```css
@import "@solo/ui/styles";  /* pulls in tokens.css */

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* ... etc */
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --radius-sm: var(--radius-sm);
  /* ... etc */
  --animate-fade-in-scale: fade-in-scale var(--duration-medium) var(--ease-smooth);
}
```

Primitives then use `bg-background`, `rounded-md`, `animate-fade-in-scale` — standard Tailwind utilities, but every value flows from tokens.

## Naming rules

- **kebab-case for CSS variables**: `--color-background`, `--font-mono`.
- **camelCase for TS tokens**: `colorTokens.light.background`.
- **Never use hex-like suffixes** (`--color-primary-500`) — use semantic names (`primary`, `primaryForeground`). The only exception is the Orbit Geist 10-step scale (`orbit100`…`orbit1000`) where numeric indexing is the semantic.
- **Group prefix must match category**: color tokens start with `color-`, radii with `radius-`, motion with `duration-`/`ease-`, etc.

## Adding a token

1. Add to `packages/ui/src/tokens/<category>.ts` with a comment noting its source.
2. Run `bun run --filter @solo/ui build-tokens` to regenerate `tokens.css`.
3. If it's a color/font/radius/shadow/motion token, add the corresponding `@theme inline` entry in `apps/desktop/src/index.css`.
4. If a primitive uses it, grep for whichever arbitrary value it replaces and swap to the utility.
5. Run `bun run check` to typecheck.
6. If visual, open `?__gallery=1` and eyeball the affected primitives.

## Removing a token

1. `rg --type-add "react:*.{ts,tsx,css}" "--token-name\|tokenName" -t react` — make sure nothing references it.
2. Delete from `tokens/<category>.ts`.
3. Rebuild CSS, typecheck.
