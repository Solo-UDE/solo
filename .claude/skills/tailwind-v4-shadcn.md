# Tailwind v4 + shadcn/ui Pattern

**CRITICAL**: This is the canonical CSS structure for Solo IDE. Always follow this pattern.

---

## CSS Structure (`index.css`)

```css
@import "tailwindcss";
@import "tw-animate-css";

/* 1. Define CSS variables in :root (light) and .dark */
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.147 0.004 49.25);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.147 0.004 49.25);
  --primary: oklch(0.65 0.2 41);
  --primary-foreground: oklch(0.98 0.01 60);
  /* ... more colors */
}

.dark {
  --background: oklch(0.145 0.004 49.25);
  --foreground: oklch(0.985 0.001 106.423);
  --card: oklch(0.205 0.006 56.043);
  /* ... more colors */
}

/* 2. Map to Tailwind utilities with @theme inline */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  /* ... more mappings */
}

/* 3. Base styles */
* {
  border-color: var(--border);
}

body {
  background-color: var(--background);
  color: var(--foreground);
}
```

---

## Why OKLCH Colors?

OKLCH enables opacity modifiers to work correctly:

```css
/* With OKLCH, this works: */
bg-muted/40      /* 40% opacity */
bg-primary/10    /* 10% opacity */
border-border/50 /* 50% opacity */

/* With HEX, opacity modifiers FAIL */
```

### OKLCH Format
```
oklch(L C H)
      │ │ └─ Hue (0-360 degrees)
      │ └─── Chroma (0-0.4, saturation)
      └───── Lightness (0-1)
```

---

## Solo IDE Color Palette (OKLCH)

### Dark Mode (Primary)
| Token | OKLCH Value | Description |
|-------|-------------|-------------|
| `--background` | `oklch(0.145 0.004 49.25)` | Deep warm stone |
| `--foreground` | `oklch(0.985 0.001 106.423)` | Off-white text |
| `--card` | `oklch(0.205 0.006 56.043)` | Elevated surface |
| `--muted` | `oklch(0.32 0.01 50)` | Subtle backgrounds |
| `--muted-foreground` | `oklch(0.709 0.01 56.259)` | Secondary text |
| `--primary` | `oklch(0.7 0.18 41)` | Orange accent |
| `--border` | `oklch(0.38 0.01 50)` | Visible borders |
| `--destructive` | `oklch(0.704 0.191 22.216)` | Error red |

### Light Mode
| Token | OKLCH Value | Description |
|-------|-------------|-------------|
| `--background` | `oklch(1 0 0)` | Pure white |
| `--foreground` | `oklch(0.147 0.004 49.25)` | Dark text |
| `--card` | `oklch(1 0 0)` | White surface |
| `--muted` | `oklch(0.97 0.001 106.424)` | Light gray |
| `--primary` | `oklch(0.65 0.2 41)` | Orange accent |

---

## Dark Mode Setup

**HTML must have `class="dark"`:**

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <style>
      /* Prevent FOUC */
      html { background-color: oklch(0.145 0.004 49.25); }
    </style>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

For dynamic theming, use `next-themes`:
```tsx
import { ThemeProvider } from "next-themes";

<ThemeProvider attribute="class" defaultTheme="dark">
  <App />
</ThemeProvider>
```

---

## Dependencies

**Required packages:**
```json
{
  "tailwindcss": "^4.0.0",
  "@tailwindcss/vite": "^4.0.0",
  "tw-animate-css": "^1.4.0",
  "class-variance-authority": "^0.7.1",
  "clsx": "^2.1.1",
  "tailwind-merge": "^3.4.0"
}
```

**Deprecated (do NOT use):**
- `tailwindcss-animate` → use `tw-animate-css` instead

---

## Component Pattern (shadcn/ui style)

Components should:
1. Use `data-slot` attribute for styling hooks
2. Accept `className` prop with `cn()` merge
3. Use React 19 patterns (no forwardRef needed)

```tsx
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: "default" | "ghost" | "destructive";
}

function Button({ className, variant = "default", ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      className={cn(
        "h-[34px] px-3.5 rounded-[10px] font-medium",
        "transition-all duration-200 active:scale-[0.97]",
        variant === "default" && "bg-primary text-primary-foreground hover:brightness-110",
        variant === "ghost" && "bg-transparent hover:bg-muted",
        variant === "destructive" && "bg-destructive text-destructive-foreground",
        className
      )}
      {...props}
    />
  );
}
```

---

## Utility Function (`lib/utils.ts`)

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

---

## Common Mistakes to Avoid

### ❌ Wrong: Using HEX in @theme
```css
@theme {
  --color-background: #1c1917; /* Opacity won't work! */
}
```

### ✅ Correct: OKLCH with @theme inline
```css
:root {
  --background: oklch(0.145 0.004 49.25);
}
@theme inline {
  --color-background: var(--background);
}
```

### ❌ Wrong: Missing dark class
```html
<html lang="en"> <!-- Dark mode won't activate! -->
```

### ✅ Correct: Add dark class
```html
<html lang="en" class="dark">
```

### ❌ Wrong: Old animation package
```json
"tailwindcss-animate": "1.0.7"
```

### ✅ Correct: New animation package
```json
"tw-animate-css": "^1.4.0"
```

---

## Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

No `tailwind.config.js` needed - everything is CSS-first in `index.css`.

---

## References

- [shadcn/ui Tailwind v4 Guide](https://ui.shadcn.com/docs/tailwind-v4)
- [shadcn/ui Theming](https://ui.shadcn.com/docs/theming)
- [Tailwind CSS v4 Docs](https://tailwindcss.com/docs)
