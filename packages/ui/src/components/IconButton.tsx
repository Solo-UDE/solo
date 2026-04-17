import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../utils/cn";

/**
 * IconButton — square, icon-only button. Shares the Button size ladder
 * so the two can sit next to each other without height mismatch.
 *
 * Variants:
 *   ghost   — transparent bg, hover tint (toolbar default).
 *   muted   — always-visible muted surface (used when an icon needs persistent presence).
 *   outline — ring border, transparent fill.
 *   solid   — primary-colored filled button for emphasis.
 */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "xs" | "sm" | "md" | "lg";
  variant?: "ghost" | "muted" | "outline" | "solid";
  /** Accessible label. Accepts `label` or standard `aria-label`. */
  label?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className,
      size = "md",
      variant = "ghost",
      label,
      "aria-label": ariaLabel,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const sizes = {
      xs: "size-5 rounded-sm [&_svg]:size-3",
      sm: "size-6 rounded-sm [&_svg]:size-3.5",
      md: "size-7 rounded-md [&_svg]:size-3.5",
      lg: "size-8 rounded-md [&_svg]:size-4",
    };

    const variants = {
      ghost: "bg-transparent text-foreground/80 hover:bg-accent hover:text-foreground",
      muted: "bg-muted/40 text-foreground/90 hover:bg-muted/60",
      outline: "border border-input bg-transparent hover:bg-accent",
      solid: "bg-primary text-primary-foreground hover:bg-primary/90",
    };

    return (
      <button
        ref={ref}
        type={type}
        aria-label={label ?? ariaLabel}
        className={cn(
          "inline-flex items-center justify-center",
          "transition-[background-color,color,border-color,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "active:scale-95 disabled:opacity-50 disabled:pointer-events-none",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "[&_svg]:shrink-0 [&_svg]:pointer-events-none",
          sizes[size],
          variants[variant],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

IconButton.displayName = "IconButton";
