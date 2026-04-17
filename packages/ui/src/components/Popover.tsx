import {
  Root,
  Trigger,
  Portal,
  Content,
  Arrow,
  Close,
  Anchor,
} from "@radix-ui/react-popover";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export const Popover = Root;
export const PopoverTrigger = Trigger;
export const PopoverClose = Close;
export const PopoverAnchor = Anchor;

export interface PopoverContentProps extends ComponentPropsWithoutRef<typeof Content> {
  withArrow?: boolean;
}

export const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  ({ className, align = "center", sideOffset = 6, withArrow = false, children, ...props }, ref) => (
    <Portal>
      <Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 p-3 rounded-md outline-none",
          "bg-popover text-popover-foreground",
          "ring-1 ring-black/5 dark:ring-white/10 shadow-xl",
          "data-[state=open]:animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]",
          "data-[state=closed]:animate-[fade-out_100ms_cubic-bezier(0.4,0,0.2,1)]",
          className,
        )}
        {...props}
      >
        {children}
        {withArrow && <Arrow className="fill-popover" />}
      </Content>
    </Portal>
  ),
);
PopoverContent.displayName = "PopoverContent";
