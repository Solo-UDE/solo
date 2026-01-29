import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Size of the button */
  size?: "sm" | "md" | "lg";
  /** Variant style */
  variant?: "ghost" | "muted" | "surface";
  /** Show active state (e.g., for toggle buttons) */
  isActive?: boolean;
}

/**
 * IconButton component for icon-only actions
 *
 * Features:
 * - Square aspect ratio with rounded corners
 * - Spring easing on hover/press
 * - Subtle background elevation on hover
 * - Active state for toggle buttons
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", variant = "ghost", isActive = false, children, ...props }, ref) => {
    const sizes = {
      sm: "w-7 h-7",
      md: "w-8 h-8",
      lg: "w-10 h-10",
    };

    const variants = {
      ghost: [
        "bg-transparent",
        "hover:bg-bg-surface-2",
        "dark:hover:bg-bg-surface-2",
      ].join(" "),
      muted: [
        "bg-bg-surface-1",
        "hover:bg-bg-surface-2",
        "dark:bg-bg-surface-1",
        "dark:hover:bg-bg-surface-2",
      ].join(" "),
      surface: [
        "bg-bg-surface-2",
        "hover:bg-bg-surface-3",
        "shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]",
        "dark:shadow-[0_1px_2px_-1px_rgba(0,0,0,0.3)]",
      ].join(" "),
    };

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center",
          "rounded-lg",
          "transition-all duration-150",
          // Spring easing
          "[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]",
          "hover:scale-105 active:scale-95",
          "disabled:opacity-50 disabled:pointer-events-none disabled:scale-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          sizes[size],
          variants[variant],
          // Active state styling
          isActive && "bg-primary/10 text-primary hover:bg-primary/15",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

IconButton.displayName = "IconButton";
