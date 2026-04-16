import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Size of the button */
  size?: "xs" | "sm" | "md" | "lg";
  /** Variant style */
  variant?: "ghost" | "muted" | "outline";
}

/**
 * Compact square icon button — Orbit dev-tool density.
 *
 * No hover scale. Uses --radius tokens so global radius tuning applies.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = "md", variant = "ghost", children, ...props }, ref) => {
    const sizes = {
      xs: "w-5 h-5 rounded-sm",
      sm: "w-6 h-6 rounded-sm",
      md: "w-7 h-7 rounded-md",
      lg: "w-8 h-8 rounded-md",
    };

    const variants = {
      ghost: "bg-transparent hover:bg-accent",
      muted: "bg-muted/40 hover:bg-muted/60",
      outline: "border border-input bg-transparent hover:bg-accent",
    };

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center",
          "transition-[background-color,color,border-color] duration-150",
          "active:scale-95",
          "disabled:opacity-50 disabled:pointer-events-none",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
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
