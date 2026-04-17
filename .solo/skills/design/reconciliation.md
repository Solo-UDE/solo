# Skill Reconciliation

This document catalogues every rule in `Inspirations/Skills/ui/design-guidelines/` and records how Solo responds. Three possible statuses:

- **✓ Enforced** — the rule applies universally and Solo follows it.
- **✗ Deviated** — the rule is inappropriate for a desktop IDE; Solo does something else, with a rationale.
- **N/A** — the rule targets a context that doesn't exist in Solo (landing pages, pricing cards, testimonials, etc.).

A deviation that isn't documented here is a bug. If you encounter one while reviewing or coding, add an entry first, then write the code.

## general.md — Markup rules

| Rule | Status | Notes |
|---|---|---|
| No `text-*`/`leading-*` on inline elements | ✓ Enforced | Primitives apply size to the containing block. |
| No redundant display classes | ✓ Enforced | Grep in CI. |
| No conflicting classes on same property | ✓ Enforced | Grep in CI. |
| `role="list"` on `<ul>`/`<ol>` without list-style | ✓ Enforced | — |

## general.md — Tailwind rules

| Rule | Status | Notes |
|---|---|---|
| `antialiased` on root | ✓ Enforced | `body { -webkit-font-smoothing: antialiased }` in `index.css`. |
| `isolate` on main app container | ✓ Enforced | Applied to `#root > div`. |
| `@import` with remote URLs before `@import "tailwindcss"` | N/A | Solo has no remote CSS imports. |
| `tabular-nums` on numeric content | ✓ Enforced | `body { font-variant-numeric: tabular-nums }` globally. |
| Use `gap-*` not `m*-*` between flex/grid children | ✓ Enforced | Grep in CI. |
| `size-{n}` over `h-{n} w-{n}` | ✓ Enforced | — |
| Shorthand `p-8` over `px-8 py-8` | ✓ Enforced | — |
| `--spacing(…)` over raw pixel values | ✓ Enforced | — |
| No `theme()` calls | ✓ Enforced | — |
| `rem` for arbitrary font sizes | ✓ Enforced | — |
| No named line-height values (`tight`, `snug`) | ✓ Enforced | Use scale values only. |
| No inline `style` for static CSS | ✓ Enforced | Arbitrary property syntax instead. |
| Bare values over `[…]` for integers and 0.25-multiples | ✓ Enforced | — |
| `not-*` variants over `hidden` + conditional re-show | ✓ Enforced | — |
| `min-h-dvh/svh/lvh`, never `min-h-screen` | ✓ Enforced | — |
| `bg-linear-*` over `bg-gradient-*` | ✓ Enforced | — |
| `shrink-*`/`grow-*` | ✓ Enforced | — |

## colors.md

| Rule | Status | Notes |
|---|---|---|
| Never default to indigo | ✓ Enforced | Primary is Solo green. Info is blue but not indigo. |
| Never default to `gray-*`/`slate-*` | ✓ Enforced | Uses warm-stone OKLCH neutrals. |

## typography.md

| Rule | Status | Notes |
|---|---|---|
| Never `text-xs` for body text | ✗ **Deviated** | Dev-tool chrome (status bar, file-tree labels, kbd chips, scope text) uses `text-xs` and occasionally `text-2xs` (11px). **Rationale:** a desktop IDE prioritizes information density; users pay for screen real estate by choosing this product category. The rule is enforced in user-reachable prose (chat, docs, settings body) but not in chrome. |
| Never `font-bold` for headings | ✓ Enforced | Use `font-semibold` or `font-medium`. |
| Never `leading-*` on headings | ✓ Enforced | Default line-height from text size. |
| `text-balance` on headings, `text-pretty` on paragraphs | ✓ Enforced | — |
| `tracking-tight` on headings > text-xl | ✓ Enforced | — |
| No `uppercase` except with monospace + `tracking-wide` | ✓ Enforced | — |
| Always Inter variable font | ✗ **Deviated** | Uses SF Pro on macOS. **Rationale:** native macOS app; matches system chrome; avoids font-loading FOUC at startup. **Validated against Codex extraction (2026-04-17):** Codex uses the *same* system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` — exposed as `--default-font-family`) and loads no webfonts except KaTeX (math rendering). The deviation is not a Solo-specific choice — it's the native-desktop convention Codex shares. Atkinson Hyperlegible kept in chat for prose legibility. |

## buttons.md

| Rule | Status | Notes |
|---|---|---|
| Shadow + solid gray border pairing | ✓ Enforced | Use `ring-1 ring-black/5` instead. |
| Primary button ring solid, not opacity | ✓ Enforced | — |
| Dangerous actions muted by default | ✓ Enforced | `destructive` variant uses `bg-destructive/10`. |
| Max one primary per page | ✓ Enforced | Gallery route checks this across visible states. |
| Less horizontal padding | ✓ Enforced | `px-2.5` at md, `px-3.5` at lg — smaller than web defaults. |
| Compact `text-sm`, 28–38px total height | ✓ Enforced (adapted) | Solo's sm=24px, md=28px, lg=32px. The lower bound (20/24) is a dev-tool-density concession. |
| Max 2 button sizes per UI | ✗ **Deviated** | Solo uses 4 sizes (xs/sm/md/lg). **Rationale:** dev-tool UIs have multiple density contexts (kbd chips, toolbar icons, dialog actions, form submits) that don't compress into 2 sizes. |
| Asymmetric padding for icon buttons | ✓ Enforced | Button computes this automatically. |
| Custom focus ring on solid buttons | ✓ Enforced | `focus-visible:outline` pattern. |
| 48×48 touch target | ✗ **Deviated** | **Rationale:** desktop mouse-only application. Touch targets N/A. |

## form-controls.md

| Rule | Status | Notes |
|---|---|---|
| No shadow + solid gray border on inputs | ✓ Enforced | Use `ring-1 ring-black/10`. |
| `max-w-xs` for compact forms | ✓ Enforced | — |
| Min 16px font on mobile | N/A | Desktop-only. |
| No `outline-offset-*` on input/textarea focus rings | ✓ Enforced | — |
| Inset 2px focus outline with `-outline-offset-1` | ✓ Enforced | — |
| `name` attribute on all form controls | ✓ Enforced | — |
| Every `<input>/<select>/<textarea>` has label/`aria-label` | ✓ Enforced | — |
| Explicit `type` on `<button>` | ✓ Enforced | Button defaults to `type="button"`. |
| Custom chevron for `<select>` | ✓ Enforced (via Radix Select) | — |
| Native `<input type="checkbox">` with CSS-only state | ✓ Enforced (via Radix Checkbox) | — |

## shadows.md

| Rule | Status | Notes |
|---|---|---|
| No shadow + solid gray border pairing | ✓ Enforced | — |
| Elevated elements not darker than canvas | ✓ Enforced | Cards are `var(--card)`, slightly lighter than `var(--background)`. |

## border-radius.md

| Rule | Status | Notes |
|---|---|---|
| Concentric radii via `calc()` | ✓ Enforced | Via `--radius` scale. |
| `min()` with viewport units for image radii | N/A | Desktop — fixed viewport scaling. |

## interactivity.md

| Rule | Status | Notes |
|---|---|---|
| No `hover:*` on non-interactive elements | ✓ Enforced | Grep in CI. |
| No `transition-*` for hover color changes | ✗ **Deviated (soft)** | **Rationale:** the skill's stance is that color-only hover transitions are visual noise. Solo's existing motion vocabulary includes subtle color transitions for primary actions and chat tool widgets. We enforce the rule for incidental elements (file tree items, menu items — instant on hover) but permit it for primary buttons and code-block hover-reveal buttons where the transition is part of the affordance language. |

## dark-mode.md

| Rule | Status | Notes |
|---|---|---|
| Maintain contrast ratios, not invert | ✓ Enforced | OKLCH hand-tuning for both modes. |
| Large colored panels → use bg + divider | ✓ Enforced | No branded hero panels in Solo. |
| Cards slightly lighter than page bg | ✓ Enforced | `--card` is 2–3% lighter than `--background` in dark. |
| `dark:inset-ring dark:inset-ring-white/5` on cards | ✓ Enforced | Via `--border` in `@theme inline`. |
| Remove all shadows in dark mode (`dark:shadow-none`) | ✗ **Deviated** | **Rationale:** shadows are *softened* not removed. Dark-mode shadows at 25–52% opacity are essential for floating panels (dialogs, popovers) to read as elevated against the near-black canvas. The skill's rationale (shadows don't translate to dark UI) assumes web surfaces where the dark mode is often an afterthought; Solo's dark mode is first-class and tuned. |
| Faint decorative quote marks | N/A | No testimonials. |
| Single heading color in dark mode | ✓ Enforced | — |
| Hide decorative bg images in dark | N/A | No decorative bg images. |
| `dark:invert` + `dark:grayscale` on inverted images | N/A | No `dark:invert` usage. |
| `scheme-only-dark` on dark-only sites | N/A | Solo supports both modes. |

## surfaces.md

| Rule | Status | Notes |
|---|---|---|
| Don't default to white cards on gray bg | ✓ Enforced | Cards on same-surface with border/shadow only. |
| Lightest separation that works | ✓ Enforced | Whitespace first, then dividers, then cards. |
| Cards only for independently interactive content | ✓ Enforced | File-tree rows, menu items, etc. use hover tint, not cards. |
| Divider-separated items padding rules | ✓ Enforced | Primitives respect this. |
| Opacity-based dividers (`divide-gray-950/5`) | ✓ Enforced | Uses `--border` with opacity modifiers. |

## Skill files that are N/A

These exist in the Inspirations skill but don't apply to Solo:

- `assets-api.md` — web asset pipeline
- `avatars.md` — testimonial avatars (Solo's user avatars are N/A marketing-style, but Avatar primitive exists)
- `dashboards.md` — dashboard layouts (Solo is an IDE, not a dashboard app)
- `description-lists.md` — definition lists
- `feature-lists.md` — marketing feature sections
- `flexbox-layout.md` — covered by Tailwind general rules
- `font-recommendations.md` — web font curation
- `footers.md` — site footers
- `headers.md` — marketing site headers
- `heading-groups.md` — marketing heading groups
- `icons.md` — Solo uses Lucide, documented separately
- `images.md` — marketing imagery
- `landing-pages.md` — N/A
- `login-pages.md` — auth flow spec is separate
- `logo-clouds.md` — marketing brand strips
- `navigation.md` — marketing navigation
- `pagination.md` — Solo has no paginated lists
- `placeholder-content.md` — empty states handled per-panel
- `pricing-cards.md` — N/A
- `prose-content.md` — chat prose handled by streamdown overrides in `styles.css`
- `responsive-design.md` — desktop viewport; resize handled per-panel
- `section-layout.md` — marketing section rhythm
- `svg.md` — general SVG rules apply but no site-specific usage
- `tables.md` — tables appear only in chat markdown, overridden in `styles.css`
- `team-sections.md` — N/A
- `testimonials.md` — N/A
- `copywriting.md` — product copy handled at the feature level

## Review cadence

Re-run this reconciliation when:
- The Inspirations UI skill updates (`Inspirations/Skills/ui/design-guidelines/`)
- A new primitive introduces a novel interaction that might conflict with a rule
- Any `✗ Deviated` entry is challenged during review

Last review: 2026-04-17.
