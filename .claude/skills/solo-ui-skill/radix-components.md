# Radix UI Components

Radix UI provides unstyled, accessible primitives. We wrap them with Tailwind styles following shadcn/ui patterns.

## Installed Packages

```json
{
  "@radix-ui/react-dialog": "^1.x",
  "@radix-ui/react-dropdown-menu": "^2.x",
  "@radix-ui/react-popover": "^1.x",
  "@radix-ui/react-scroll-area": "^1.x",
  "@radix-ui/react-select": "^2.x",
  "@radix-ui/react-tabs": "^1.x",
  "@radix-ui/react-tooltip": "^1.x",
  "@radix-ui/react-collapsible": "^1.x",
  "@radix-ui/react-separator": "^1.x",
  "@radix-ui/react-switch": "^1.x",
  "@radix-ui/react-slot": "^1.x"
}
```

---

## Component Wrappers

### Dialog

```tsx
// src/components/ui/dialog.tsx
import * as DialogPrimitive from "@radix-ui/react-dialog";

const DialogOverlay = React.forwardRef<...>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));

const DialogContent = React.forwardRef<...>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]",
        "w-full max-w-lg p-6 bg-card/95 backdrop-blur-md rounded-[14px]",
        "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] border border-border/50",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
```

### Dropdown Menu

```tsx
// src/components/ui/dropdown-menu.tsx
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

const DropdownMenuContent = React.forwardRef<...>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={4}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden p-1",
        "bg-card/95 backdrop-blur-md rounded-[12px]",
        "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)] border border-border/50",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));

const DropdownMenuItem = React.forwardRef<...>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex items-center gap-2 px-2 py-1.5 text-sm rounded-lg",
      "cursor-pointer select-none outline-none",
      "text-foreground hover:bg-muted/60",
      "focus:bg-muted/60 focus:text-foreground",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      "transition-colors duration-150",
      className
    )}
    {...props}
  />
));
```

### Tooltip

```tsx
// src/components/ui/tooltip.tsx
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

const TooltipContent = React.forwardRef<...>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 px-3 py-1.5 text-xs font-medium",
        "bg-card/95 backdrop-blur-sm text-foreground rounded-lg",
        "shadow-[0_4px_12px_-4px_rgba(0,0,0,0.2)] border border-border/50",
        "animate-in fade-in-0 zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));

// Usage: Wrap app with TooltipProvider
<TooltipProvider delayDuration={300}>
  <App />
</TooltipProvider>
```

### Tabs

```tsx
// src/components/ui/tabs.tsx
import * as TabsPrimitive from "@radix-ui/react-tabs";

const TabsList = React.forwardRef<...>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 p-1 bg-muted/40 rounded-lg",
      className
    )}
    {...props}
  />
));

const TabsTrigger = React.forwardRef<...>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium",
      "rounded-md text-muted-foreground whitespace-nowrap",
      "hover:text-foreground hover:bg-muted/60",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30",
      "data-[state=active]:bg-card data-[state=active]:text-foreground",
      "data-[state=active]:shadow-sm",
      "disabled:pointer-events-none disabled:opacity-50",
      "transition-all duration-200",
      className
    )}
    {...props}
  />
));
```

### Scroll Area

```tsx
// src/components/ui/scroll-area.tsx
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

const ScrollArea = React.forwardRef<...>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));

const ScrollBar = React.forwardRef<...>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" && "h-full w-2 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" && "h-2 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border/50 hover:bg-border/80 transition-colors" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
```

### Switch

```tsx
// src/components/ui/switch.tsx
import * as SwitchPrimitive from "@radix-ui/react-switch";

const Switch = React.forwardRef<...>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center",
      "rounded-full border-2 border-transparent",
      "bg-muted/60 transition-colors duration-200",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-primary",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-white",
        "shadow-sm transition-transform duration-200",
        "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitive.Root>
));
```

---

## Animation Classes

Radix components use `data-[state=open/closed]` attributes. Add these animations:

```css
/* tailwind.config or index.css */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes zoomIn { from { transform: scale(0.95); } to { transform: scale(1); } }
@keyframes zoomOut { from { transform: scale(1); } to { transform: scale(0.95); } }

.animate-in { animation: fadeIn 150ms ease-out, zoomIn 150ms ease-out; }
.animate-out { animation: fadeOut 150ms ease-in, zoomOut 150ms ease-in; }
```

---

## Best Practices

1. **Always forward refs** - Radix needs refs for positioning
2. **Use Portal** - For dropdowns, tooltips, modals to escape overflow
3. **Provide sideOffset** - Standard is 4-8px gap from trigger
4. **Handle keyboard** - Radix handles this, don't override
5. **Data attributes** - Use `data-[state=*]` for styling states
6. **Asynchronous close** - Use `animate-out` before removal
