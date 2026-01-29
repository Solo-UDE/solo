import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  /** Optional keyboard shortcut hint displayed on hover */
  shortcutHint?: string;
  /** Icon to display before children */
  icon?: ReactNode;
}

/**
 * Button component following NeuralForge design system
 *
 * Features:
 * - Spring easing on hover/press (cubic-bezier 0.34, 1.56, 0.64, 1)
 * - Scale transforms for tactile feedback
 * - Soft shadow elevation instead of brightness on hover
 * - Optional keyboard shortcut hints
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", shortcutHint, icon, children, ...props }, ref) => {
    const baseStyles = [
      "group relative inline-flex items-center justify-center gap-2",
      "font-medium rounded-lg",
      "transition-all duration-200",
      // Spring easing for hover/active
      "[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]",
      "hover:scale-[1.02] active:scale-[0.97]",
      "disabled:opacity-50 disabled:pointer-events-none disabled:scale-100",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    ].join(" ");

    const variants = {
      primary: [
        "bg-primary text-primary-foreground",
        "shadow-[0_2px_8px_-2px_rgba(0,0,0,0.2)]",
        "hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.3)]",
        "dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)]",
        "dark:hover:shadow-[0_4px_16px_-2px_var(--primary)/30%]",
      ].join(" "),
      secondary: [
        "bg-bg-surface-2 text-foreground",
        "border border-border-subtle",
        "shadow-[0_1px_3px_-1px_rgba(0,0,0,0.1)]",
        "hover:bg-bg-surface-3 hover:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.15)]",
        "dark:shadow-[0_1px_3px_-1px_rgba(0,0,0,0.3)]",
        "dark:hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)]",
      ].join(" "),
      ghost: [
        "bg-transparent",
        "hover:bg-bg-surface-2",
        "dark:hover:bg-bg-surface-2",
      ].join(" "),
      destructive: [
        "bg-destructive/10 text-destructive",
        "hover:bg-destructive/20",
        "shadow-[0_1px_3px_-1px_rgba(0,0,0,0.1)]",
        "hover:shadow-[0_2px_6px_-2px_rgba(255,0,0,0.15)]",
      ].join(" "),
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
        {icon && <span className="shrink-0">{icon}</span>}
        {children}
        {shortcutHint && (
          <span className="ml-auto text-xs opacity-0 group-hover:opacity-60 transition-opacity text-muted-foreground">
            {shortcutHint}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
