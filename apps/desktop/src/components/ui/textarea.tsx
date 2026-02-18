import * as React from "react";
import { cn } from "../../lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea"> & { error?: boolean }
>(({ className, error, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[80px] w-full rounded-lg px-3 py-2 text-sm",
      "bg-muted/40 text-foreground",
      "placeholder:text-muted-foreground/50",
      "transition-[background-color,box-shadow] duration-150",
      "focus:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-ring/30",
      "disabled:cursor-not-allowed disabled:opacity-50",
      error && "ring-1 ring-destructive/50 focus:ring-destructive/50",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
