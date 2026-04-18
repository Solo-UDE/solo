import { Root, Thumb } from "@radix-ui/react-switch";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export interface SwitchProps extends ComponentPropsWithoutRef<typeof Root> {
  size?: "sm" | "md";
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, size = "md", ...props }, ref) => {
    const sizes = {
      sm: "h-3.5 w-6 [&>span]:size-2.5 data-[state=checked]:[&>span]:translate-x-2.5",
      md: "h-4 w-7 [&>span]:size-3 data-[state=checked]:[&>span]:translate-x-3",
    };
    return (
      <Root
        ref={ref}
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer items-center rounded-full",
          "p-0.5 transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "bg-muted data-[state=checked]:bg-primary",
          "ring-1 ring-black/5 dark:ring-white/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          sizes[size],
          className,
        )}
        {...props}
      >
        <Thumb
          className={cn(
            "pointer-events-none block rounded-full bg-white",
            "shadow-sm ring-1 ring-black/5",
            "transition-transform duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]",
          )}
        />
      </Root>
    );
  },
);
Switch.displayName = "Switch";
