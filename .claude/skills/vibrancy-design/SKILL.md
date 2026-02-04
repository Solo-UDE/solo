# Vibrancy Design System

> macOS-native glass UI patterns for Solo IDE. Use this skill when styling any component that needs to integrate with the vibrancy/translucency system.

## Triggers

- Styling a new component (button, dropdown, panel, modal, input, etc.)
- Adding glass/translucent effects
- Working with backgrounds on vibrancy-active surfaces
- Creating or modifying sidebar, header, or overlay components
- Debugging transparent background issues on macOS

## Quick Reference

| File | Contents |
|------|----------|
| [architecture.md](./architecture.md) | Three-layer vibrancy system: Rust native effects, CSS transparency rules, React attribute setup |
| [glass-patterns.md](./glass-patterns.md) | Copy-pasteable Tailwind class recipes for every component type |
| [color-system.md](./color-system.md) | OKLCH color variables, light/dark mode values, vibrancy overrides |
| [do-and-dont.md](./do-and-dont.md) | Rules, anti-patterns, and common mistakes |

## Core Philosophy

1. **Native first** — macOS `NSVisualEffectView` (via `Effect::Sidebar`) provides the base translucency. CSS never fakes what the OS provides natively.
2. **Transparent cascade** — When `data-vibrancy` is set, sidebar and root backgrounds become transparent. The native blur shows through.
3. **Graceful fallback** — Without vibrancy (Windows, Linux, or disabled), components use solid `bg-background` or `bg-card` with no visual breakage.
4. **Semi-transparent layers** — Components use opacity-modified backgrounds (`bg-background/70`, `bg-card/80`) with `backdrop-blur-*` to create depth without blocking the native effect.

## Quick-Copy Patterns

**Titlebar / Header:**
```
backdrop-blur-md bg-background/70 titlebar-glass
```

**Sidebar container:**
```
bg-sidebar border-r border-white/[0.06]
```

**Tab bar:**
```
bg-card/80 backdrop-blur-sm border-b border-border/30
```

**Icon button (titlebar):**
```
p-1 rounded hover:bg-foreground/[0.08] transition-colors
```

**Panel header:**
```
bg-background/95 backdrop-blur-sm border-b border-border
```

**Breadcrumb bar:**
```
bg-background/80 backdrop-blur-sm border-b border-border/20
```
