# Design System

## Color Palette (Warm Dark Stone)

```css
/* Base Colors */
--color-background: #1c1917;     /* Stone 900 */
--color-foreground: #fafaf9;     /* Stone 50 */

/* Card & Surfaces */
--color-card: #292524;           /* Stone 800 */
--color-card-foreground: #fafaf9;

/* Muted Elements */
--color-muted: #44403c;          /* Stone 700 */
--color-muted-foreground: #a8a29e; /* Stone 400 */

/* Primary (Orange) */
--color-primary: #f97316;        /* Orange 500 */
--color-primary-foreground: #fff;

/* Accent */
--color-accent: #292524;
--color-accent-foreground: #fafaf9;

/* Borders & Rings */
--color-border: #57534e;         /* Stone 600 */
--color-ring: #f97316;

/* Semantic */
--color-destructive: #ef4444;    /* Red 500 */
--color-destructive-foreground: #fff;
```

---

## Spacing Scale

```css
/* Tailwind spacing used consistently */
0.5  = 2px   /* Micro gaps */
1    = 4px   /* Icon padding */
1.5  = 6px   /* Tight spacing */
2    = 8px   /* Standard gap */
3    = 12px  /* Component padding */
4    = 16px  /* Section spacing */
6    = 24px  /* Large gaps */
8    = 32px  /* Panel margins */
```

---

## Typography

```css
/* Font Stack */
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
             "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;

/* Sizes */
text-xs    = 12px  /* Labels, badges */
text-sm    = 14px  /* Body text */
text-base  = 16px  /* Default */
text-lg    = 18px  /* Subheadings */
text-xl    = 20px  /* Headings */
text-2xl   = 24px  /* Page titles */
text-3xl   = 30px  /* Hero text */

/* Weights */
font-normal  = 400  /* Body */
font-medium  = 500  /* Buttons, labels */
font-semibold = 600 /* Headings */
font-bold    = 700  /* Emphasis */
```

---

## Border Radius Scale

```css
rounded-sm   = 4px   /* Badges, chips */
rounded      = 6px   /* Small elements */
rounded-md   = 8px   /* Buttons, inputs */
rounded-lg   = 10px  /* Cards, panels */
rounded-xl   = 12px  /* Modals */
rounded-2xl  = 14px  /* Floating panels */
rounded-[10px] = 10px /* Standard buttons */
rounded-[12px] = 12px /* Toasts */
rounded-[14px] = 14px /* Dialogs */
```

---

## Shadow Scale

```css
/* Subtle - hover states */
shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05)

/* Default - cards */
shadow: 0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)

/* Medium - dropdowns */
shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)

/* Large - modals */
shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)

/* Custom floating panel */
shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)]

/* Custom toast */
shadow-[0_4px_12px_-4px_rgba(0,0,0,0.2)]
```

---

## Component Patterns

### Buttons

```tsx
// Primary Button
<button className="h-[34px] px-3.5 bg-primary text-primary-foreground rounded-[10px] font-medium hover:brightness-110 active:scale-[0.97] transition-all duration-200">
  Primary Action
</button>

// Secondary Button
<button className="h-[34px] px-3.5 bg-muted/60 text-foreground rounded-[10px] font-medium hover:bg-muted active:scale-[0.97] transition-all duration-200">
  Secondary
</button>

// Ghost Button
<button className="h-[34px] px-3 bg-transparent text-muted-foreground rounded-[10px] hover:bg-muted/60 hover:text-foreground hover:scale-[1.02] active:scale-[0.97] transition-all duration-200">
  Ghost
</button>

// Destructive (only on hover)
<button className="h-[34px] px-3.5 bg-muted/60 text-foreground rounded-[10px] font-medium hover:bg-destructive/10 hover:text-destructive active:scale-[0.97] transition-all duration-200">
  Delete
</button>
```

### Inputs

```tsx
// Text Input
<input className="h-9 w-full px-3 rounded-lg bg-muted/40 border-none text-foreground placeholder:text-muted-foreground/50 focus:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-ring/30 transition-all duration-200" />

// Search Input
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
  <input className="h-9 w-full pl-9 pr-3 rounded-lg bg-muted/40 border-none ..." />
</div>
```

### Cards & Panels

```tsx
// Floating Panel
<div className="bg-card/95 backdrop-blur-md rounded-[14px] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)] border border-border/50">
  {/* content */}
</div>

// Sidebar Panel
<div className="bg-card/80 backdrop-blur-sm border-r border-border/50">
  {/* content */}
</div>

// Card
<div className="bg-card rounded-xl p-4 shadow-sm">
  {/* content */}
</div>
```

### Icon Buttons

```tsx
// Standard
<button className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground hover:scale-105 active:scale-95 transition-all duration-200">
  <Icon className="w-4 h-4" />
</button>

// Small
<button className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-all duration-150">
  <Icon className="w-3.5 h-3.5" />
</button>
```

---

## Opacity Patterns

```css
/* Backgrounds */
bg-card/95          /* Floating panels with blur */
bg-card/80          /* Sidebars with blur */
bg-muted/40         /* Input backgrounds */
bg-muted/60         /* Hover states */
bg-primary/10       /* Accent tint */
bg-destructive/10   /* Danger hover */

/* Borders */
border-border/50    /* Subtle default */
border-border/80    /* Hover/focus */

/* Text */
text-muted-foreground/50  /* Placeholders */
text-muted-foreground/70  /* Subtle labels */
```

---

## Z-Index Scale

```css
z-0   = 0    /* Base */
z-10  = 10   /* Elevated content */
z-20  = 20   /* Sticky headers */
z-30  = 30   /* Fixed sidebars */
z-40  = 40   /* Overlays */
z-50  = 50   /* Modals, dialogs */
z-[100] = 100 /* Toasts */
z-[999] = 999 /* Command palette */
```
