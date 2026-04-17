# Primitives

`@solo/ui` is Solo's component library. It owns every reusable interactive element in the IDE. App code (`apps/desktop/src/components/`) composes primitives — it never writes raw button/input/dialog markup.

## Design principles

1. **Named API over Tailwind passthrough.** Variants and sizes are props, not classes. `<Button variant="primary" size="sm">` not `<Button className="bg-primary h-7 px-2.5">`.
2. **className is the last override.** Every primitive accepts `className` and merges it via `cn()` (clsx + tailwind-merge) so app code can adjust but never has to.
3. **No baked-in margin.** Primitives own their padding and internal gaps. Layout is the caller's concern.
4. **Token-driven styling.** No hex / oklch / pixel-value arbitraries in a primitive's class list. Only Tailwind utilities that flow from the token system.
5. **Motion is tokenized.** `duration-fast`, `duration-base`, `ease-smooth`, etc. No inline `duration-[237ms]` or custom cubic-beziers.
6. **Radix UI for anything stateful.** Open/close, selected, checked, hovered-across-boundaries — all use Radix. We wrap, not reinvent.
7. **forwardRef on everything interactive.** App code needs to attach refs for focus management, measurement, portal anchors.
8. **a11y by default.** Semantic HTML when possible; `aria-*` when not; focus-visible ring using `--ring`; keyboard operable via Radix or native behavior.
9. **Dark mode is not a variant.** The `.dark` class at `<html>` swaps tokens. Primitives use the same classes in both modes.

## Conventions

### Prop shape

```ts
interface PrimitiveProps<T extends HTMLElement> extends HTMLAttributes<T> {
  variant?: VariantName;     // visual family (primary/secondary/ghost/…)
  size?: SizeName;           // xs / sm / md / lg
  tone?: ToneName;           // optional accent (success/warning/destructive/…)
  density?: 'default' | 'compact';  // optional — dev-tool contexts
  asChild?: boolean;         // Radix Slot pattern, for primitives that benefit
  className?: string;
}
```

Not every primitive uses every slot. `variant` is required on anything with multiple visual treatments; `size` is required on anything with multiple heights.

### cn() utility

```ts
// packages/ui/src/utils/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Always the last call inside `className={...}` so app-side overrides win deterministically.

### Focus ring

Every interactive primitive uses:

```
focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
```

`ring-offset-background` is required so the ring is visible against any surface. Adjust `ring-offset-*` per call-site surface if a primitive is nested in a popover (where the offset should be `ring-offset-popover`).

### Motion transitions

The standard transition utility:

```
transition-[background-color,color,border-color,box-shadow,transform] duration-fast ease-snappy
```

Only transition the properties that visually change. Never `transition-all` — it catches layout properties and jank ensues.

## Inventory

| Primitive | Variants | Sizes | Radix backing |
|---|---|---|---|
| **Button** | primary, secondary, ghost, outline, destructive, link | xs, sm, md, lg | — |
| **IconButton** | ghost, outline, solid | xs, sm, md, lg | — |
| **Input** | default, error | sm, md | — |
| **Textarea** | default, error | sm, md | — |
| **Panel** | default, inset, raised | — | — |
| **Skeleton** | shimmer, pulse | — | — |
| **Badge** | default, secondary, outline, success, warning, destructive, info | sm, md | — |
| **Kbd** | — | sm, md | — |
| **Separator** | — | — | Radix Separator |
| **Spinner** | — | xs, sm, md, lg | — |
| **Switch** | — | sm, md | Radix Switch |
| **Checkbox** | — | sm, md | Radix Checkbox |
| **Radio** | — | sm, md | Radix RadioGroup |
| **Tooltip** | — | — | Radix Tooltip |
| **Dialog** | default, alert | sm, md, lg, xl | Radix Dialog |
| **Menu** | — | — | Radix DropdownMenu |
| **ContextMenu** | — | — | Radix ContextMenu |
| **Tabs** | default, pills | sm, md | Radix Tabs |
| **ScrollArea** | — | — | Radix ScrollArea |
| **Avatar** | — | xs, sm, md, lg | Radix Avatar |
| **Toast** | default, success, error, warning | — | Sonner |
| **Select** | — | sm, md | Radix Select |
| **Combobox** | — | sm, md | cmdk |
| **Popover** | — | — | Radix Popover |

## Per-primitive specs

Each primitive's full spec lives in its source file's doc comment + this table. The comment format:

```tsx
/**
 * Button — interactive element for triggering actions.
 *
 * Variants:
 *   primary     — page's main action. Max 1 per page (skill rule).
 *   secondary   — supporting action on muted surface.
 *   ghost       — text-only with hover tint. For toolbars.
 *   outline     — ring-1 border, transparent fill. For contextual emphasis.
 *   destructive — dangerous action. Muted by default; solid only in confirm dialogs.
 *   link        — inline text link with underline-offset.
 *
 * Sizes:
 *   xs — 20px height. Only in kbd-style chrome.
 *   sm — 24px height. Default in dense toolbars.
 *   md — 28px height. Default everywhere else.
 *   lg — 32px height. Dialog actions, form submits.
 *
 * Skill compliance:
 *   - Focus ring with outline-offset-2 on solid variants.
 *   - Asymmetric padding when leadingIcon/trailingIcon set.
 *   - No 48×48 touch target (desktop — mouse only).
 */
```

### Button (exemplar)

```tsx
// packages/ui/src/components/Button.tsx
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../utils/cn';
import { Spinner } from './Spinner';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'destructive' | 'link';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, leadingIcon, trailingIcon, children, disabled, type = 'button', ...props }, ref) => {
    const base = [
      'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium',
      'transition-[background-color,color,border-color,box-shadow,transform] duration-fast ease-snappy',
      'active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      '[&_svg]:shrink-0 [&_svg]:pointer-events-none',
    ];

    const variants = {
      primary:     'bg-primary text-primary-foreground hover:bg-primary/90',
      secondary:   'bg-secondary text-secondary-foreground hover:bg-accent',
      ghost:       'bg-transparent hover:bg-accent hover:text-accent-foreground',
      outline:     'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground',
      destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
      link:        'bg-transparent text-primary underline-offset-2 hover:underline',
    };

    const sizes = {
      xs: 'h-5 rounded-sm px-1.5 text-2xs [&_svg]:size-3',
      sm: 'h-6 rounded-sm px-2 text-xs [&_svg]:size-3.5',
      md: 'h-7 rounded-md px-2.5 text-sm [&_svg]:size-3.5',
      lg: 'h-8 rounded-md px-3.5 text-sm [&_svg]:size-4',
    };

    // Asymmetric padding when icons are passed (skill rule)
    const iconPad = leadingIcon && !trailingIcon
      ? { xs: 'pl-1 pr-1.5', sm: 'pl-1.5 pr-2', md: 'pl-2 pr-2.5', lg: 'pl-2.5 pr-3.5' }[size]
      : !leadingIcon && trailingIcon
      ? { xs: 'pl-1.5 pr-1', sm: 'pl-2 pr-1.5', md: 'pl-2.5 pr-2', lg: 'pl-3.5 pr-2.5' }[size]
      : '';

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], iconPad, className)}
        {...props}
      >
        {loading ? <Spinner size={size === 'lg' ? 'sm' : 'xs'} /> : leadingIcon}
        {children}
        {!loading && trailingIcon}
      </button>
    );
  },
);
Button.displayName = 'Button';
```

Note every decision traces to tokens or skill rules:
- `bg-primary` → `colorTokens.light.primary` / `colorTokens.dark.primary`
- `rounded-sm` / `rounded-md` → `radiiTokens.sm` / `radiiTokens.md`
- `duration-fast` → `motionTokens.duration.fast`
- `ease-snappy` → `motionTokens.easing.snappy`
- `active:scale-[0.98]` — the one permitted arbitrary value because it's a ratio, not a magnitude
- Asymmetric padding — skill's `buttons.md` rule

### Spinner (for completeness — Button depends on it)

```tsx
// packages/ui/src/components/Spinner.tsx
export interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  'aria-label'?: string;
}

export function Spinner({ size = 'sm', className, ...props }: SpinnerProps) {
  const sizes = { xs: 'size-3', sm: 'size-3.5', md: 'size-4', lg: 'size-5' };
  return (
    <span role="status" aria-label={props['aria-label'] ?? 'Loading'} className={cn('relative inline-flex', sizes[size], className)}>
      <span className="absolute inset-0 rounded-full border-2 border-current opacity-25" />
      <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-current animate-spin" />
    </span>
  );
}
```

## Gallery route

`apps/desktop/src/routes/__ui-gallery/page.tsx` renders every primitive in every variant, size, and state on a single scrollable page. Not Storybook — just one big dev route. Accessible via `?__gallery=1` in dev mode.

Structure:
```tsx
export function UIGalleryPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-12 p-8">
      <Section title="Button">
        <Row>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          {/* ... */}
        </Row>
        <Row>
          {(['xs','sm','md','lg'] as const).map(size =>
            <Button key={size} size={size}>{size}</Button>
          )}
        </Row>
        {/* ... loading, disabled, with icons, etc */}
      </Section>
      {/* ... every other primitive */}
    </div>
  );
}
```

This is the visual regression surface. Any primitive or token change should be eyeballed here before merging.

## Adding a new primitive

1. Create `packages/ui/src/components/<Name>.tsx`.
2. Write the doc comment with variants/sizes/skill-compliance notes (see Button).
3. Implement using tokens only — no raw literals.
4. Export from `packages/ui/src/index.ts`.
5. Add a gallery section in `__ui-gallery/page.tsx`.
6. Run `bun run check`.
7. Run `rg "bg-(white|black|gray|slate|zinc|stone|neutral)|rounded-\[|shadow-\[|duration-\[" packages/ui/src/components/<Name>.tsx` — must return zero matches.
8. Visual-check via the gallery.

## Migrating an app call-site to a primitive

1. Identify the ad-hoc markup (`rg "className=\"[^\"]*bg-primary" apps/desktop/src/components/` finds hand-rolled buttons).
2. Replace with `<Button>` (or relevant primitive).
3. If a one-off style remains, pass via `className` — but only overrides, not core styling.
4. If the override would violate an invariant (raw color/size/radius literal), open a design conversation — either the primitive needs a new variant, or the call-site is doing something the design system shouldn't accommodate.
