import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../utils/cn";
import { Spinner } from "./Spinner";

/**
 * Button — interactive element for triggering actions.
 *
 * Variants:
 *   primary     — page's main action. Max 1 per page (skill rule).
 *   secondary   — supporting action on muted surface.
 *   ghost       — text-only with hover tint. For toolbars.
 *   outline     — ring-1 border, transparent fill. For contextual emphasis.
 *   destructive — dangerous action. Muted by default; solid only in confirm dialogs.
 *   link        — inline text link with underline-offset.
 *
 * Sizes:
 *   xs — 20px height. Dev-tool chrome (kbd chips).
 *   sm — 24px height. Dense toolbars.
 *   md — 28px height. Default everywhere.
 *   lg — 32px height. Dialog actions, form submits.
 *
 * Skill compliance:
 *   - Asymmetric padding when leadingIcon/trailingIcon set.
 *   - Focus ring on solid variants with ring-offset.
 *   - No 48×48 touch target (desktop mouse-only).
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "outline" | "destructive" | "link";
  size?: "xs" | "sm" | "md" | "lg";
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const iconPadMap = {
  leading: {
    xs: "pl-1 pr-1.5",
    sm: "pl-1.5 pr-2",
    md: "pl-2 pr-2.5",
    lg: "pl-2.5 pr-3.5",
  },
  trailing: {
    xs: "pl-1.5 pr-1",
    sm: "pl-2 pr-1.5",
    md: "pl-2.5 pr-2",
    lg: "pl-3.5 pr-2.5",
  },
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading,
      leadingIcon,
      trailingIcon,
      children,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const base = [
      "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium",
      "transition-[background-color,color,border-color,box-shadow,transform] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]",
      "active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
      "[&_svg]:shrink-0 [&_svg]:pointer-events-none",
    ];

    const variants = {
      primary: "bg-primary text-primary-foreground hover:bg-primary/90",
      secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
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

    const iconPad =
      leadingIcon && !trailingIcon
        ? iconPadMap.leading[size]
        : !leadingIcon && trailingIcon
          ? iconPadMap.trailing[size]
          : "";

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], iconPad, className)}
        {...props}
      >
        {loading ? <Spinner size={size === "lg" ? "sm" : "xs"} /> : leadingIcon}
        {children}
        {!loading && trailingIcon}
      </button>
    );
  },
);

Button.displayName = "Button";
