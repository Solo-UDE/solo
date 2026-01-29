import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional error state */
  error?: boolean;
  /** Optional icon to display on the left */
  icon?: ReactNode;
  /** Size variant */
  inputSize?: "sm" | "md" | "lg";
}

/**
 * Input component following NeuralForge design system
 *
 * Features:
 * - Surface-2 background for depth hierarchy
 * - Spring transition on focus with border-focus color
 * - Subtle shadow inset for depth
 * - Optional left icon
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, icon, inputSize = "md", ...props }, ref) => {
    const sizes = {
      sm: "h-8 text-sm",
      md: "h-9 text-sm",
      lg: "h-11 text-base",
    };

    const input = (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-lg",
          "bg-bg-surface-2 text-foreground",
          "border border-border-subtle",
          "placeholder:text-muted-foreground/50",
          // Spring transition
          "transition-all duration-200",
          "[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]",
          // Focus state
          "focus:outline-none focus:border-border-focus",
          "focus:ring-2 focus:ring-border-focus/20",
          "focus:bg-bg-surface-3",
          // Disabled state
          "disabled:opacity-50 disabled:cursor-not-allowed",
          // Error state
          error && "border-destructive/50 focus:border-destructive focus:ring-destructive/20",
          // Size and padding
          sizes[inputSize],
          icon ? "pl-9 pr-3" : "px-3",
          className
        )}
        {...props}
      />
    );

    if (icon) {
      return (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            {icon}
          </span>
          {input}
        </div>
      );
    }

    return input;
  }
);

Input.displayName = "Input";
