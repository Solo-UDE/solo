import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../utils/cn";

/**
 * Textarea — multi-line text input.
 *
 * Shares Input's styling language (soft surface, no hard border by default,
 * inset focus outline). Sizes control vertical padding only; height is
 * controlled by the `rows` attribute at the call site.
 */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "error";
  size?: "sm" | "md";
  /** @deprecated use `variant="error"` — kept for back-compat with legacy callers */
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant, error, size = "md", rows = 4, ...props }, ref) => {
    const effectiveVariant = variant ?? (error ? "error" : "default");
    const sizes = {
      sm: "px-2 py-1.5 text-[12px] rounded-md",
      md: "px-2.5 py-2 text-[13px] rounded-md",
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
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          "w-full resize-y",
          "transition-[background-color,box-shadow,outline-color] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          sizes[size],
          variants[effectiveVariant],
          className,
        )}
        {...props}
      />
    );
  },
);

Textarea.displayName = "Textarea";
