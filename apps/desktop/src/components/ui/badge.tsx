import * as React from "react";
import { cn } from "../../lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
}

const badgeVariants = {
  default: "bg-primary/15 text-primary",
  secondary: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive",
  outline: "bg-transparent border border-border/50 text-foreground",
  success: "bg-success-muted text-success-foreground",
  warning: "bg-warning-muted text-warning-foreground",
};

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium",
        "transition-colors duration-100",
        badgeVariants[variant],
        className
      )}
      {...props}
    />
  )
);
Badge.displayName = "Badge";

export { Badge, type BadgeProps };
