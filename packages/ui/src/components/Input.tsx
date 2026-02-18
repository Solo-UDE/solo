import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional error state */
  error?: boolean;
}

/**
 * Input component following Solo/Orbit design system
 *
 * Features:
 * - Soft background, no hard borders
 * - Subtle focus ring
 * - Smooth transitions
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full px-3 rounded-lg",
          "bg-muted/40 text-foreground",
          "placeholder:text-muted-foreground/50",
          "transition-[background-color,box-shadow] duration-150",
          "focus:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-ring/30",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          error && "ring-1 ring-destructive/50 focus:ring-destructive/50",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
