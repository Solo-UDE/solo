import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

/**
 * Kbd — keyboard shortcut chip.
 *
 * Use inside Tooltip bodies, menu items, and anywhere a key combination
 * needs visual emphasis. Renders each key as a small, rounded surface.
 */
export interface KbdProps extends HTMLAttributes<HTMLElement> {
  size?: "sm" | "md";
}

export const Kbd = forwardRef<HTMLElement, KbdProps>(
  ({ className, size = "sm", children, ...props }, ref) => {
    const sizes = {
      sm: "h-4 min-w-4 px-1 text-[10px] rounded-sm",
      md: "h-5 min-w-5 px-1.5 text-[11px] rounded-sm",
    };

    return (
      <kbd
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center",
          "bg-muted/60 text-muted-foreground font-mono",
          "ring-1 ring-black/5 dark:ring-white/5",
          sizes[size],
          className,
        )}
        {...props}
      >
        {children}
      </kbd>
    );
  },
);

Kbd.displayName = "Kbd";
