# Glass Patterns

Copy-pasteable Tailwind class recipes for every component type. Each pattern assumes the vibrancy system is active (macOS) and degrades gracefully to solid backgrounds on other platforms.

## Opacity Scale

| Opacity | Use case |
|---------|----------|
| `/[0.03]` | Barely visible tint (titlebar glass on vibrancy) |
| `/[0.06]` | Subtle border on glass surfaces |
| `/[0.08]` | Hover overlay on glass surfaces |
| `/20` | Light border separator |
| `/30` | Medium border separator |
| `/50` | Muted foreground text |
| `/60` | Secondary text, subtle dividers |
| `/70` | De-emphasized text, background with some transparency |
| `/80` | Tab bar, card backgrounds with slight translucency |
| `/95` | Panel headers, near-opaque with hint of depth |

## Backdrop Blur Tiers

| Class | Effect | Use for |
|-------|--------|---------|
| `backdrop-blur-sm` | 4px blur | Tab bars, breadcrumbs, light overlays |
| `backdrop-blur-md` | 12px blur | Titlebar, headers, prominent glass surfaces |
| `backdrop-blur-lg` | 16px blur | Modals, popovers, heavy overlays |

## Border Patterns

On vibrancy surfaces, prefer white-alpha borders over themed borders:

| Pattern | When to use |
|---------|-------------|
| `border-white/[0.06]` | Primary dividers on vibrancy surfaces (sidebar edge) |
| `border-border/30` | Secondary dividers (tab bar bottom, section separators) |
| `border-border/20` | Subtle dividers (breadcrumb bottom) |
| `border-border` | Standard borders on opaque surfaces |

## Hover Patterns

| Pattern | When to use |
|---------|-------------|
| `hover:bg-foreground/[0.08]` | Icon buttons on glass surfaces |
| `hover:bg-muted/60` | Buttons and items on opaque surfaces |
| `hover:scale-[1.01]` | Subtle lift on hover (inactive tabs) |
| `hover:scale-105 active:scale-95` | Interactive feedback (action buttons) |

---

## Component Recipes

### Titlebar / Window Header

The top-level draggable title bar with glass effect.

```
absolute top-0 inset-x-0 h-[38px] flex items-center z-50
backdrop-blur-md bg-background/70 titlebar-glass
```

- `titlebar-glass` class receives `background: rgb(255 255 255 / 0.03)` when vibrancy is active
- Uses `data-tauri-drag-region` for window dragging
- Requires `pt-[38px]` on content below it

### Titlebar Icon Button

Small icon buttons in the title bar area.

```
p-1 rounded hover:bg-foreground/[0.08] transition-colors
```

Active/pressed state:
```
p-1 rounded bg-foreground/[0.08] transition-colors
```

### Sidebar Container

The primary sidebar that sits over the native vibrancy effect.

```
h-full flex flex-col border-r border-white/[0.06] bg-sidebar overflow-hidden pt-[38px]
```

- `bg-sidebar` resolves to `transparent` when vibrancy is active, solid color otherwise
- `border-white/[0.06]` provides a subtle glass edge
- `pt-[38px]` accounts for the titlebar overlay

### Sidebar Section Header

Header row within the sidebar (e.g., tab bar).

```
h-10 flex items-center justify-between px-2 shrink-0 border-b border-border/30
```

### Tab Bar (Editor)

Translucent tab strip above editor content.

```
flex items-center h-8 bg-card/80 backdrop-blur-sm border-b border-border/30 overflow-x-auto
```

### Tab (Active)

```
flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-t-lg bg-background shadow-sm
```

### Tab (Inactive)

```
flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-t-lg
hover:bg-muted/60 hover:scale-[1.01]
```

### Breadcrumb Bar

Lightweight glass bar showing file path and symbol hierarchy.

```
flex items-center justify-between h-7 px-3
bg-background/80 backdrop-blur-sm border-b border-border/20
```

### Panel Header (Agent)

Near-opaque header for content panels.

```
flex items-center justify-between px-4 py-2
border-b border-border bg-background/95 backdrop-blur-sm
```

### Panel Action Button

Buttons within panel headers.

```
p-1.5 rounded-md hover:bg-muted/60 transition-colors
```

### Terminal Header

Terminal tab bar with sidebar background.

```
flex items-center justify-between px-1.5 shrink-0
border-b border-border/30 bg-sidebar
```

### Terminal Tab (Active)

```
group relative flex items-center gap-1 px-3 py-2 text-[11px] cursor-pointer
text-foreground
```

With accent bar:
```
absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary
```

### Terminal Tab (Inactive)

```
group relative flex items-center gap-1 px-3 py-2 text-[11px] cursor-pointer
text-muted-foreground hover:text-foreground transition-colors duration-150
```

### Terminal New Button

```
p-1 rounded-lg cursor-pointer
text-muted-foreground hover:text-foreground hover:bg-muted/60
hover:scale-105 active:scale-95 transition-all duration-150
```

### Card / Surface

A raised surface on opaque backgrounds.

```
rounded-lg bg-card border border-border shadow-sm
```

On vibrancy surfaces:
```
rounded-lg bg-card/80 backdrop-blur-sm border border-white/[0.06] shadow-sm
```

### Modal / Dialog Overlay

```
fixed inset-0 z-50 bg-black/50 backdrop-blur-sm
flex items-center justify-center
```

### Modal Content

```
rounded-xl bg-popover border border-border shadow-xl
backdrop-blur-lg max-w-md w-full p-6
```

### Popover / Dropdown

```
rounded-lg bg-popover border border-border shadow-lg
backdrop-blur-lg p-1 min-w-[180px]
```

### Popover Item

```
flex items-center gap-2 px-2 py-1.5 rounded-md text-sm
hover:bg-accent transition-colors cursor-pointer
```

### Tooltip

```
rounded-md bg-popover/95 backdrop-blur-sm border border-border
shadow-md px-2.5 py-1 text-xs text-popover-foreground
```

### Context Menu

```
rounded-lg bg-popover border border-border shadow-lg
backdrop-blur-lg p-1 min-w-[160px]
```

### Context Menu Item

```
flex items-center gap-2 px-2 py-1.5 rounded-md text-sm
text-foreground hover:bg-accent transition-colors cursor-pointer
```

### Input (Text Field)

```
h-8 w-full rounded-md border border-input bg-background/80
px-3 text-sm placeholder:text-muted-foreground
focus:outline-none focus:ring-1 focus:ring-ring
```

### Badge / Tag

```
inline-flex items-center rounded-full px-2 py-0.5
text-xs font-medium bg-secondary text-secondary-foreground
```

### Toggle / Switch

```
inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full
border border-transparent bg-input transition-colors
data-[state=checked]:bg-primary
```

### Toolbar

```
flex items-center gap-1 px-2 py-1
bg-card/80 backdrop-blur-sm border-b border-border/30
```

### Toast / Notification

```
rounded-lg bg-popover border border-border shadow-lg
backdrop-blur-lg px-4 py-3 flex items-center gap-3
```

### Split Divider

Defined in CSS (`markdown-preview.css`), not Tailwind:

```css
.split-divider {
    width: 8px;
    background-color: transparent;
    cursor: col-resize;
}
.split-divider::before {
    /* 1px center line, expands to 3px primary on hover */
}
.split-divider-grip {
    /* Three small dots at center, visible on hover */
}
```

### Status Indicator Dot

```
w-1.5 h-1.5 rounded-full bg-status-success
```

With pulse (connecting state):
```
w-1.5 h-1.5 rounded-full bg-status-warning animate-pulse
```

### Dirty/Unsaved Indicator

```
w-2 h-2 rounded-full bg-primary animate-pulse
```
