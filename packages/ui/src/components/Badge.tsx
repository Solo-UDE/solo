import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

/**
 * Badge — inline status/tag label.
 *
 * Variants use status tokens where applicable; `outline` and `secondary`
 * are chromeless alternatives for neutral contexts.
 */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "outline" | "success" | "warning" | "destructive" | "info";
  size?: "sm" | "md";
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", size = "md", children, ...props }, ref) => {
    const variants = {
      default:     "bg-primary/10 text-primary",
      secondary:   "bg-muted text-muted-foreground",
      outline:     "border border-border text-foreground",
      success:     "bg-success-muted text-success-foreground",
      warning:     "bg-warning-muted text-warning-foreground",
      destructive: "bg-destructive/10 text-destructive",
      info:        "bg-info-muted text-info-foreground",
    };

    const sizes = {
      sm: "h-4 px-1.5 text-[10px] rounded-sm",
      md: "h-5 px-2 text-[11px] rounded-md",
    };

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 font-medium whitespace-nowrap tabular-nums",
          sizes[size],
          variants[variant],
          className,
        )}
        {...props}
      >
        {children}
      </span>
    );
  },
);

Badge.displayName = "Badge";
