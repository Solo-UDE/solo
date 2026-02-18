import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Size of the button */
  size?: "sm" | "md" | "lg";
  /** Variant style */
  variant?: "ghost" | "muted";
}

/**
 * IconButton component for icon-only actions
 *
 * Features:
 * - Square aspect ratio
 * - Subtle hover states
 * - Scale feedback on press
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", variant = "ghost", children, ...props }, ref) => {
    const sizes = {
      sm: "w-7 h-7",
      md: "w-8 h-8",
      lg: "w-10 h-10",
    };

    const variants = {
      ghost: "bg-transparent hover:bg-muted/60",
      muted: "bg-muted/40 hover:bg-muted/60",
    };

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center",
          "rounded-lg",
          "transition-[transform,background-color,color] duration-150",
          "hover:scale-105 active:scale-95",
          "disabled:opacity-50 disabled:pointer-events-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          sizes[size],
          variants[variant],
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
