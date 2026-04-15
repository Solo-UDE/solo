import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "outline" | "destructive" | "link";
  size?: "xs" | "sm" | "md" | "lg";
}

/**
 * Compact button — Orbit dev-tool density (24/28/32 px heights).
 *
 * No hover scale, no built-in shadow, no glow. Uses Solo's --radius scale
 * (6px md) so a global radius change re-tunes every button at once.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => {
    const baseStyles = [
      "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium",
      "transition-[background-color,color,border-color,box-shadow,transform] duration-150",
      "hover:brightness-[1.03] active:scale-[0.98]",
      "disabled:opacity-50 disabled:pointer-events-none",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      "[&_svg]:shrink-0 [&_svg]:pointer-events-none",
    ].join(" ");

    const variants = {
      primary: "bg-primary text-primary-foreground hover:bg-primary/90",
      secondary: "bg-secondary text-secondary-foreground border border-border hover:bg-accent",
      ghost: "bg-transparent hover:bg-accent hover:text-accent-foreground",
      outline:
        "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
      destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20",
      link: "bg-transparent text-primary underline-offset-2 hover:underline",
    };

    const sizes = {
      xs: "h-5 rounded-sm px-1.5 text-[11px] [&_svg]:size-3",
      sm: "h-6 rounded-sm px-2 text-[12px] [&_svg]:size-3.5",
      md: "h-7 rounded-md px-2.5 text-[13px] [&_svg]:size-3.5",
      lg: "h-8 rounded-md px-3.5 text-[13px] [&_svg]:size-4",
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
