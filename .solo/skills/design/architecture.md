# Architecture

Two layers, one data flow. Layer 0 produces tokens; Layer 1 consumes them.

## Data flow

```
  Codex.app (Electron renderer)
       │
       │  CDP over ws://127.0.0.1:9222   (scripts/codex-extract/)
       ▼
  design-dump/codex/*.{css,json}
       │
       │  hand-curated distillation
       ▼
  packages/ui/src/tokens/*.ts   ◄── source of truth
       │
       │  build-tokens.ts generator
       ▼
  packages/ui/src/tokens.css    ◄── generated, do not edit
       │
       │  @import "./tokens.css"
       ▼
  packages/ui/src/styles.css    ◄── base layer + third-party overrides
       │
       │  @theme inline references
       ▼
  apps/desktop/src/index.css    ◄── app entry, consumes @solo/ui/styles
       │
       │  Tailwind v4 JIT compile
       ▼
  rendered CSS classes
       ▲
       │
  @solo/ui primitives          ◄── consume token utilities only
       ▲
       │
  apps/desktop/src/components/ ◄── consume primitives, never raw markup
```

## Directory plan

```
solo/
├── scripts/codex-extract/                  Layer 0: extraction tooling
│   ├── launch.ts                           Spawns Codex with CDP port
│   ├── extract.ts                          CDP client + orchestrator
│   ├── extractors/
│   │   ├── stylesheets.ts                  CSS.getAllStyleSheets + text
│   │   ├── computed.ts                     getComputedStyle on archetypes
│   │   ├── fonts.ts                        document.fonts introspection
│   │   ├── tokens.ts                       CSS custom property scan
│   │   ├── keyframes.ts                    @keyframes regex + names
│   │   └── assets.ts                       Icon/image URL inventory
│   ├── archetypes.json                     Selectors catalog (editable)
│   └── README.md                           Usage + regeneration notes
│
├── packages/ui/
│   ├── design-dump/codex/                  Layer 0: extraction output
│   │   ├── stylesheets/*.css               Committed
│   │   ├── computed-styles.json            Committed
│   │   ├── tokens.json                     Committed
│   │   ├── fonts.json                      Committed
│   │   ├── keyframes.json                  Committed
│   │   ├── assets/                         Gitignored (size)
│   │   └── README.md                       Committed (version, date)
│   │
│   ├── scripts/build-tokens.ts             Layer 0: ts → css generator
│   │
│   └── src/
│       ├── tokens/                         Layer 0: token source of truth
│       │   ├── colors.ts
│       │   ├── typography.ts
│       │   ├── spacing.ts
│       │   ├── radii.ts
│       │   ├── shadows.ts
│       │   ├── motion.ts
│       │   ├── z-index.ts
│       │   └── index.ts                    Barrel, typed exports
│       │
│       ├── tokens.css                      GENERATED — do not hand-edit
│       │
│       ├── styles.css                      REWRITTEN — imports tokens.css
│       │
│       └── components/                     Layer 1: primitives
│           ├── Button.tsx
│           ├── IconButton.tsx
│           ├── Input.tsx
│           ├── Textarea.tsx
│           ├── Panel.tsx
│           ├── Skeleton.tsx
│           ├── Badge.tsx
│           ├── Kbd.tsx
│           ├── Separator.tsx
│           ├── Spinner.tsx
│           ├── Switch.tsx
│           ├── Checkbox.tsx
│           ├── Radio.tsx
│           ├── Tooltip.tsx
│           ├── Dialog.tsx
│           ├── Menu.tsx
│           ├── ContextMenu.tsx
│           ├── Tabs.tsx
│           ├── ScrollArea.tsx
│           ├── Avatar.tsx
│           ├── Toast.tsx
│           ├── Select.tsx
│           ├── Combobox.tsx
│           └── Popover.tsx
│
└── apps/desktop/src/
    ├── index.css                           SLIMMED — imports @solo/ui/styles
    └── routes/__ui-gallery/                Layer 1: hidden dev route
        └── page.tsx                        Renders every primitive in every state
```

## Layer boundaries

**Layer 0 — Foundation** owns:
- Extraction scripts and their output
- Token source files and the CSS generator
- Skill reconciliation document

Layer 0 has zero React dependencies. It produces artifacts (JSON, CSS) and token TypeScript modules. Changes to Layer 0 propagate to Layer 1 via regeneration, not direct import.

**Layer 1 — Primitives** owns:
- React components in `packages/ui/src/components/`
- The hidden gallery route

Layer 1 consumes Layer 0 tokens exclusively. It never hardcodes a color, font size, radius, shadow, or motion value.

**App code** (`apps/desktop/src/components/`) consumes primitives exclusively. It never writes its own button/input/dialog markup. Panel-level composition (how primitives are arranged inside the file explorer, terminal, agent panel, etc.) belongs to the panel's own spec, not this skill.

## Data-shape rules

1. **tokens.json** (from extraction) is untyped — it's a raw dump, keyed by custom-property name.
2. **tokens/*.ts** is fully typed — no `any`, no `Record<string, string>` escape hatches. Tokens are literal-typed so TypeScript catches rename/typo errors at `@solo/ui` build time.
3. **tokens.css** mirrors `tokens/*.ts` one-to-one. Every TS token has a corresponding `--name` CSS variable.
4. **archetypes.json** is hand-curated and committed. Extraction failures against specific archetypes don't block the run — they log and continue.

## Regeneration triggers

Run the Codex extraction when:
- Codex.app updates to a new version (the dump README records the version captured)
- A panel redesign needs a fresh reference for a component we didn't extract before
- A new archetype is added to `archetypes.json`

Run `build-tokens.ts` when:
- Any file in `packages/ui/src/tokens/` changes
- A new token category is added (new file in `tokens/`)

Run the gallery route when:
- Any primitive is added or changes
- A token change that affects primitives lands (sanity check visually)
