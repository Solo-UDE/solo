import { Root, Item, Indicator } from "@radix-ui/react-radio-group";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export const RadioGroup = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Root>
>(({ className, ...props }, ref) => (
  <Root ref={ref} className={cn("grid gap-2", className)} {...props} />
));
RadioGroup.displayName = "RadioGroup";

export interface RadioItemProps extends ComponentPropsWithoutRef<typeof Item> {
  size?: "sm" | "md";
}

export const RadioItem = forwardRef<HTMLButtonElement, RadioItemProps>(
  ({ className, size = "md", ...props }, ref) => {
    const sizes = { sm: "size-3.5", md: "size-4" };
    return (
      <Item
        ref={ref}
        className={cn(
          "shrink-0 inline-flex items-center justify-center rounded-full",
          "bg-input ring-1 ring-black/10 dark:ring-white/10",
          "data-[state=checked]:ring-primary data-[state=checked]:ring-[3px]",
          "transition-[box-shadow] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          sizes[size],
          className,
        )}
        {...props}
      >
        <Indicator className="size-1.5 rounded-full bg-primary" />
      </Item>
    );
  },
);
RadioItem.displayName = "RadioItem";
