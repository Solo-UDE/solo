# Animations

## Core Principles

1. **Duration:** Keep under 300ms (usually 150-200ms)
2. **Properties:** Only animate `transform` and `opacity` (GPU-accelerated)
3. **Accessibility:** Always respect `prefers-reduced-motion`
4. **Interruptible:** User should never wait for animation

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

### When to Use Each

| Curve | Duration | Use For |
|-------|----------|---------|
| Spring | 200ms | Buttons, cards, hover effects, press feedback |
| Smooth | 250-300ms | Modals, sidebars, panel transitions |
| Snappy | 150ms | Tooltips, toggles, loading states |

---

## Tailwind Transitions

```tsx
// Standard hover transition
className="transition-all duration-200"

// Fast feedback
className="transition-all duration-150"

// Smooth panel animation
className="transition-all duration-300"

// Color only
className="transition-colors duration-200"

// Transform only
className="transition-transform duration-200"
```

---

## Button Animations

```tsx
// Primary button with press effect
<button className="
  hover:brightness-110
  active:scale-[0.97]
  transition-all duration-200
">
  Click Me
</button>

// Ghost button with subtle scale
<button className="
  hover:bg-muted/60
  hover:scale-[1.02]
  active:scale-[0.97]
  transition-all duration-200
">
  Ghost
</button>

// Icon button with scale
<button className="
  hover:bg-muted/60
  hover:scale-105
  active:scale-95
  transition-all duration-200
">
  <Icon />
</button>
```

---

## Framer Motion Patterns

```tsx
import { motion, AnimatePresence } from "framer-motion";

// Fade in/out
<AnimatePresence>
  {isVisible && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      Content
    </motion.div>
  )}
</AnimatePresence>

// Scale + fade (dialogs)
<motion.div
  initial={{ opacity: 0, scale: 0.95 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.95 }}
  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
>
  Modal Content
</motion.div>

// Slide in (sidebars)
<motion.div
  initial={{ x: -256 }}
  animate={{ x: 0 }}
  exit={{ x: -256 }}
  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
>
  Sidebar
</motion.div>

// Staggered children (lists)
<motion.ul
  initial="hidden"
  animate="visible"
  variants={{
    visible: { transition: { staggerChildren: 0.05 } },
  }}
>
  {items.map((item) => (
    <motion.li
      key={item.id}
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0 },
      }}
    >
      {item.name}
    </motion.li>
  ))}
</motion.ul>
```

---

## Loading States

```tsx
// Spinner
<Loader2 className="w-4 h-4 animate-spin" />

// Pulse (skeleton)
<div className="h-4 bg-muted/60 rounded animate-pulse" />

// Custom spin with delay
<style>
@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.animate-spin-slow { animation: spin-slow 2s linear infinite; }
</style>
```

---

## Panel Transitions

```tsx
// Collapsible sidebar
<div
  className="transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
  style={{ width: isCollapsed ? 40 : 256 }}
>
  {/* content */}
</div>

// Bottom panel slide
<motion.div
  initial={{ height: 0 }}
  animate={{ height: isOpen ? 200 : 0 }}
  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
  className="overflow-hidden"
>
  {/* content */}
</motion.div>
```

---

## Radix Animation Classes

For Radix UI components, use data attributes:

```css
/* Add to index.css or global styles */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes zoomIn {
  from { transform: scale(0.95); }
  to { transform: scale(1); }
}

@keyframes zoomOut {
  from { transform: scale(1); }
  to { transform: scale(0.95); }
}

@keyframes slideInFromTop {
  from { transform: translateY(-10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes slideInFromBottom {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Tailwind-style utilities */
.animate-in {
  animation: fadeIn 150ms ease-out, zoomIn 150ms ease-out;
}

.animate-out {
  animation: fadeOut 150ms ease-in, zoomOut 150ms ease-in;
}

.fade-in-0 { --tw-enter-opacity: 0; }
.fade-out-0 { --tw-exit-opacity: 0; }
.zoom-in-95 { --tw-enter-scale: 0.95; }
.zoom-out-95 { --tw-exit-scale: 0.95; }
```

---

## Accessibility

Always respect reduced motion preferences:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

In Framer Motion:

```tsx
import { useReducedMotion } from "framer-motion";

function Component() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={{ x: 100 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.3
      }}
    />
  );
}
```

---

## Performance Tips

1. **Only animate transform & opacity** - These are GPU-accelerated
2. **Avoid animating layout** - width, height, margin cause reflow
3. **Use will-change sparingly** - Only when needed, remove after
4. **Batch animations** - Animate multiple properties in one transition
5. **Exit animations** - Keep shorter than enter (users expect quick exit)

```tsx
// Good: Transform-based resize illusion
<div className="transform scale-x-50 transition-transform" />

// Avoid: Width animation (causes layout shift)
<div className="w-1/2 transition-[width]" />
```

---

## Canvas-Based Animation Pattern

For high-particle-count animations, use `<canvas>` + `requestAnimationFrame` instead of DOM elements.
Reference: `StarsBackground` (`src/components/ui/stars-background.tsx`).

Key pattern:
1. `ResizeObserver` for responsive canvas sizing with `devicePixelRatio`
2. `requestAnimationFrame` loop with delta-time movement
3. `MutationObserver` on `<html>` for theme-reactive rendering (dark mode only)
4. `prefers-reduced-motion`: draw one static frame, skip rAF loop
5. Cleanup: cancel rAF, disconnect observers, remove listeners

### Parallax / Pointer-Tracking

```tsx
const offsetX = (mouse.x - width / 2) * factor * item.z;
```

`factor` controls parallax intensity, `z` (0-1) creates depth layers.

---

## RAIL_SPRING Constant

```tsx
const RAIL_SPRING = { type: 'spring' as const, stiffness: 600, damping: 35 };
```

Used in: `RepoRail.tsx` (rail width, tooltip transitions).
