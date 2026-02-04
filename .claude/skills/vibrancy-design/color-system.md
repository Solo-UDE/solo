# Color System

All colors use the OKLCH color space via CSS custom properties. The theme is defined in `apps/desktop/src/index.css`.

## Light Mode (`:root`)

| Variable | Value | Purpose |
|----------|-------|---------|
| `--background` | `oklch(0.98 0.005 75)` | Main background |
| `--foreground` | `oklch(0.25 0.02 60)` | Primary text |
| `--card` | `oklch(0.96 0.008 70)` | Elevated surfaces |
| `--card-foreground` | `oklch(0.25 0.02 60)` | Card text |
| `--popover` | `oklch(0.98 0.005 75)` | Popover/dropdown bg |
| `--popover-foreground` | `oklch(0.25 0.02 60)` | Popover text |
| `--primary` | `oklch(0.68 0.17 140)` | Solo Green — brand accent |
| `--primary-foreground` | `oklch(0.98 0.01 75)` | Text on primary |
| `--secondary` | `oklch(0.80 0.05 65)` | Secondary backgrounds |
| `--secondary-foreground` | `oklch(0.30 0.02 60)` | Secondary text |
| `--muted` | `oklch(0.92 0.01 70)` | Muted backgrounds |
| `--muted-foreground` | `oklch(0.50 0.03 60)` | De-emphasized text |
| `--accent` | `oklch(0.85 0.04 65)` | Accent backgrounds |
| `--accent-foreground` | `oklch(0.25 0.02 60)` | Accent text |
| `--destructive` | `oklch(0.55 0.22 25)` | Destructive actions |
| `--border` | `oklch(0.88 0.02 70)` | Standard borders |
| `--input` | `oklch(0.90 0.015 70)` | Input borders |
| `--ring` | `oklch(0.68 0.17 140)` | Focus ring (matches primary) |
| `--sidebar` | `oklch(0.95 0.008 70)` | Sidebar background |
| `--sidebar-foreground` | `oklch(0.25 0.02 60)` | Sidebar text |
| `--sidebar-border` | `oklch(0.88 0.02 70)` | Sidebar borders |

## Dark Mode (`html.dark`)

| Variable | Value | Purpose |
|----------|-------|---------|
| `--background` | `oklch(0.16 0.012 60)` | Warm dark (not pure black) |
| `--foreground` | `oklch(0.93 0.01 75)` | Primary text |
| `--card` | `oklch(0.20 0.015 58)` | Slightly elevated |
| `--popover` | `oklch(0.22 0.015 58)` | Popover background |
| `--primary` | `oklch(0.86 0.14 135)` | Solo Mint — soft neon green |
| `--primary-foreground` | `oklch(0.15 0.01 60)` | Text on primary |
| `--secondary` | `oklch(0.28 0.02 58)` | Secondary backgrounds |
| `--muted` | `oklch(0.25 0.015 58)` | Muted backgrounds |
| `--muted-foreground` | `oklch(0.65 0.03 60)` | De-emphasized text |
| `--accent` | `oklch(0.30 0.02 55)` | Accent backgrounds |
| `--destructive` | `oklch(0.65 0.20 25)` | Destructive actions |
| `--border` | `oklch(1 0 0 / 10%)` | White overlay border |
| `--input` | `oklch(1 0 0 / 12%)` | Input border (white overlay) |
| `--ring` | `oklch(0.86 0.14 135)` | Focus ring (matches primary) |
| `--sidebar` | `oklch(0.18 0.012 58)` | Sidebar dark warm |
| `--sidebar-border` | `oklch(1 0 0 / 10%)` | Sidebar border (white overlay) |

Note: Dark mode borders use `oklch(1 0 0 / 10%)` (white at 10% opacity) rather than a solid color. This produces consistent subtle edges on any background.

## Vibrancy Overrides (`html[data-vibrancy]`)

When vibrancy is active, these overrides apply:

```css
html[data-vibrancy] {
    --sidebar: transparent;
    background-color: transparent !important;
}
html[data-vibrancy] #root > div {
    background: transparent;
}
html[data-vibrancy] .titlebar-glass {
    background: rgb(255 255 255 / 0.03);
}
```

Only `--sidebar` changes. All other variables remain as-is. Components on vibrancy surfaces should use opacity modifiers (e.g., `bg-background/70`) rather than relying on the variable itself being transparent.

## Semantic Status Colors

| Variable | Light | Dark |
|----------|-------|------|
| `--status-success` | `oklch(0.65 0.18 155)` | `oklch(0.70 0.18 155)` |
| `--status-warning` | `oklch(0.75 0.18 85)` | `oklch(0.80 0.18 85)` |
| `--status-error` | `oklch(0.55 0.22 25)` | `oklch(0.65 0.20 25)` |

## Agent Colors

| Variable | Light | Dark |
|----------|-------|------|
| `--agent-user-bg` | `oklch(0.95 0.02 140 / 10%)` | `oklch(0.86 0.14 135 / 10%)` |
| `--agent-assistant-bg` | `oklch(0.96 0.008 70)` | `oklch(0.22 0.015 58)` |
| `--agent-tool-bg` | `oklch(0.94 0.01 70)` | `oklch(0.25 0.015 58)` |
| `--agent-streaming` | `oklch(0.68 0.17 140)` | `oklch(0.86 0.14 135)` |

## Tailwind Theme Mapping

The `@theme inline` block in `index.css` maps CSS variables to Tailwind:

```css
--color-background: var(--background);
--color-foreground: var(--foreground);
--color-card: var(--card);
--color-primary: var(--primary);
--color-secondary: var(--secondary);
--color-muted: var(--muted);
--color-accent: var(--accent);
--color-border: var(--border);
--color-sidebar: var(--sidebar);
/* ... etc */
```

This enables usage like `bg-background`, `text-foreground`, `border-border`, `bg-sidebar` in Tailwind classes.

## Creating New Vibrancy-Aware Colors

To add a new color that respects vibrancy:

1. Define the CSS variable in `:root` (light) and `html.dark` (dark):
   ```css
   :root { --my-color: oklch(0.90 0.01 70); }
   html.dark { --my-color: oklch(0.25 0.015 58); }
   ```

2. Map it in `@theme inline`:
   ```css
   --color-my-color: var(--my-color);
   ```

3. Use in components: `bg-my-color`

4. For vibrancy-specific behavior, either:
   - Use opacity modifiers: `bg-my-color/80`
   - Add a vibrancy override: `html[data-vibrancy] { --my-color: transparent; }`
