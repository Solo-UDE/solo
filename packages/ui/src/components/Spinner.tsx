import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

/**
 * Spinner — a circular loading indicator.
 *
 * Sizes align with Button sizes so they can be composed 1:1
 * (Button in loading state swaps its leading icon for Spinner).
 */
export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: "xs" | "sm" | "md" | "lg";
  label?: string;
}

export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(
  ({ className, size = "sm", label = "Loading", ...props }, ref) => {
    const sizes = {
      xs: "size-3",
      sm: "size-3.5",
      md: "size-4",
      lg: "size-5",
    };
    return (
      <span
        ref={ref}
        role="status"
        aria-label={label}
        className={cn("relative inline-flex", sizes[size], className)}
        {...props}
      >
        <span className="absolute inset-0 rounded-full border-2 border-current opacity-25" />
        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-current animate-spin" />
      </span>
    );
  },
);

Spinner.displayName = "Spinner";
