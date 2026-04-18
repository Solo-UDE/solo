import { Root } from "@radix-ui/react-label";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

/**
 * Label — form control label. Uses Radix Label so clicking the label focuses
 * the associated input (via `htmlFor`).
 */
export interface LabelProps extends ComponentPropsWithoutRef<typeof Root> {
  size?: "xs" | "sm";
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, size = "xs", ...props }, ref) => {
    const sizes = {
      xs: "text-[11px] font-medium",
      sm: "text-[13px] font-medium",
    };
    return (
      <Root
        ref={ref}
        className={cn(
          "text-foreground/80 peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Label.displayName = "Label";
