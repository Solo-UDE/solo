import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

/**
 * Panel — generic surface container.
 *
 * Variants:
 *   default — card surface with soft shadow.
 *   inset   — recessed well (darker than canvas), no shadow.
 *   raised  — floating panel for overlays (stronger shadow + optional blur).
 */
export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "inset" | "raised";
  blur?: boolean;
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ className, variant = "default", blur, children, ...props }, ref) => {
    const variants = {
      default: "bg-card text-card-foreground shadow-md ring-1 ring-black/5 dark:ring-white/5",
      inset:   "bg-muted/60 text-foreground",
      raised:  "bg-popover text-popover-foreground shadow-xl ring-1 ring-black/5 dark:ring-white/10",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg",
          variants[variant],
          blur && "backdrop-blur-md",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Panel.displayName = "Panel";
