import { Root, Indicator } from "@radix-ui/react-checkbox";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export interface CheckboxProps extends ComponentPropsWithoutRef<typeof Root> {
  size?: "sm" | "md";
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, size = "md", ...props }, ref) => {
    const sizes = { sm: "size-3.5", md: "size-4" };
    return (
      <Root
        ref={ref}
        className={cn(
          "peer shrink-0 inline-flex items-center justify-center rounded-[3px]",
          "bg-input ring-1 ring-black/10 dark:ring-white/10",
          "data-[state=checked]:bg-primary data-[state=checked]:ring-primary",
          "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:ring-primary",
          "transition-colors duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          sizes[size],
          className,
        )}
        {...props}
      >
        <Indicator className="text-primary-foreground">
          <svg width="10" height="10" viewBox="0 0 14 14" className="stroke-current" strokeWidth="2.5" fill="none">
            <path d="M3 8L6 11L11 3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Indicator>
      </Root>
    );
  },
);
Checkbox.displayName = "Checkbox";
