import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../utils/cn";

/**
 * Input — single-line text input.
 *
 * Sizes parallel Button's (sm/md) for consistent row heights.
 * No hard borders by default — uses a soft muted surface with focus ring.
 *
 * Skill compliance:
 *   - Inset focus outline with -outline-offset-1
 *   - `name` attribute required by caller
 *   - Caller associates label or passes aria-label
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "md";
  variant?: "default" | "error";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      size = "md",
      variant = "default",
      type = "text",
      ...props
    },
    ref,
  ) => {
    const sizes = {
      sm: "h-7 px-2 text-[12px] rounded-md",
      md: "h-8 px-2.5 text-[13px] rounded-md",
    };

    const variants = {
      default:
        "bg-input text-foreground placeholder:text-muted-foreground/50 " +
        "ring-1 ring-black/5 dark:ring-white/5 " +
        "focus:outline-2 -outline-offset-1 focus:outline-ring/60",
      error:
        "bg-input text-foreground placeholder:text-muted-foreground/50 " +
        "ring-1 ring-destructive/50 " +
        "focus:outline-2 -outline-offset-1 focus:outline-destructive/60",
    };

    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "w-full",
          "transition-[background-color,box-shadow,outline-color] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          sizes[size],
          variants[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
