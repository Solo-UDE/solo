# Do and Don't

Rules for maintaining the glass design system.

## Do

### Use semi-transparent backgrounds with backdrop blur on glass surfaces

```
bg-background/70 backdrop-blur-md    // titlebar
bg-card/80 backdrop-blur-sm          // tab bar
bg-background/80 backdrop-blur-sm    // breadcrumbs
bg-background/95 backdrop-blur-sm    // panel headers
```

The native macOS vibrancy shows through the transparent portion. Without vibrancy, the solid color underneath still looks correct.

### Use `border-white/[0.06]` for primary dividers on vibrancy surfaces

The sidebar's right edge uses this pattern. It produces a consistent subtle edge regardless of the background being transparent or solid.

```
border-r border-white/[0.06]    // sidebar edge
```

### Use `border-border/30` or `border-border/20` for secondary dividers

```
border-b border-border/30    // tab bar bottom, section headers
border-b border-border/20    // breadcrumb bottom
```

### Use `hover:bg-foreground/[0.08]` for icon buttons on glass

This creates a barely-visible highlight that works on both transparent and opaque backgrounds:

```
hover:bg-foreground/[0.08] transition-colors
```

### Use `bg-sidebar` for sidebar backgrounds

`bg-sidebar` automatically becomes transparent when vibrancy is active and resolves to a solid color otherwise. No conditional logic needed.

### Include `transition-colors` on interactive elements

All hover/active states should transition smoothly:

```
transition-colors duration-150
transition-all duration-150       // when scale transforms are also involved
```

### Account for the titlebar overlay

Content below the titlebar needs `pt-[38px]`:

```
<aside className="... pt-[38px]">     // sidebar
<div className="... pt-[38px]">       // main content column
```

### Test both vibrancy-on and vibrancy-off states

Any component visible in the sidebar or titlebar area should look correct:
- On macOS with vibrancy (transparent backgrounds)
- On macOS without vibrancy or on other platforms (solid backgrounds)

## Don't

### Don't use solid backgrounds on vibrancy surfaces

```
// BAD: blocks the native blur entirely
bg-background
bg-card
bg-white
bg-zinc-900

// GOOD: semi-transparent with blur
bg-background/70 backdrop-blur-md
bg-card/80 backdrop-blur-sm
```

### Don't use `border-border` on vibrancy surfaces

The themed `border-border` color is designed for opaque surfaces. On transparent backgrounds, it looks too heavy.

```
// BAD on vibrancy surface
border-border

// GOOD on vibrancy surface
border-white/[0.06]
border-border/30
```

### Don't use `bg-muted` or `bg-accent` as backgrounds on vibrancy surfaces

These are opaque colors. Use them on opaque content areas (editor, agent panel body) but not on sidebar or titlebar elements.

### Don't forget `shrink-0` on fixed-height headers

Headers in flex containers will compress without it:

```
// GOOD
<div className="h-10 flex items-center shrink-0 ...">
```

### Don't add vibrancy overrides for non-sidebar surfaces

Only the sidebar and root backgrounds need the `html[data-vibrancy]` transparency treatment. The editor area, agent panels, and terminal body use `bg-background` (opaque) intentionally — they sit in the right column which has a solid `bg-background` wrapper.

### Don't mix `backdrop-blur` tiers inconsistently

Use the established hierarchy:
- `backdrop-blur-md` for the titlebar (most prominent)
- `backdrop-blur-sm` for everything below it (tab bars, breadcrumbs, panel headers)
- `backdrop-blur-lg` reserved for overlays (modals, popovers)

### Don't use opacity below `/[0.03]` for tints

At opacity below 3%, the tint is invisible and the class is wasted. The minimum useful tint is `/[0.03]` (used by `titlebar-glass`).

### Don't use `bg-black/50` without `backdrop-blur` for overlays

Modal overlays should blur the content behind them:

```
// BAD: flat dark overlay
bg-black/50

// GOOD: blurred overlay
bg-black/50 backdrop-blur-sm
```

### Don't hardcode OKLCH values in component styles

Always use CSS variables via Tailwind classes. Hardcoded values won't respond to theme changes:

```
// BAD
style={{ backgroundColor: 'oklch(0.16 0.012 60)' }}

// GOOD
className="bg-background"
```

### Don't add `data-vibrancy` checks in component code

Components should not check for `data-vibrancy` directly. The CSS variable system handles it automatically. The only place that sets the attribute is `App.tsx`.
