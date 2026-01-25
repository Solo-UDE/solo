import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
}

/**
 * Button component following Solo/Orbit design system
 *
 * Features:
 * - Spring easing on hover/press
 * - Scale transforms for feedback
 * - Soft shadows, no hard borders
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => {
    const baseStyles = [
      "inline-flex items-center justify-center gap-2",
      "font-medium rounded-[10px]",
      "transition-all duration-200",
      "hover:scale-[1.02] active:scale-[0.97]",
      "disabled:opacity-50 disabled:pointer-events-none",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    ].join(" ");

    const variants = {
      primary: "bg-primary text-primary-foreground hover:brightness-110 shadow-md",
      secondary: "bg-muted text-foreground hover:bg-muted/80",
      ghost: "bg-transparent hover:bg-muted/60",
      destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20",
    };

    const sizes = {
      sm: "h-8 px-3 text-sm",
      md: "h-10 px-4 text-sm",
      lg: "h-12 px-6 text-base",
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
