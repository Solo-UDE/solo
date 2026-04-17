import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

/**
 * Separator — thin divider for grouping related content.
 *
 * Horizontal by default. Use `orientation="vertical"` for inline groups.
 * Uses opacity-based color so it never jumps in light/dark mode.
 *
 * Kept as a native element for simplicity; can wrap Radix Separator later
 * if we need decorative-vs-semantic distinction.
 */
export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}

export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref,
  ) => {
    const dims =
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px";
    return (
      <div
        ref={ref}
        role={decorative ? "none" : "separator"}
        aria-orientation={decorative ? undefined : orientation}
        className={cn("shrink-0 bg-border/60", dims, className)}
        {...props}
      />
    );
  },
);

Separator.displayName = "Separator";
