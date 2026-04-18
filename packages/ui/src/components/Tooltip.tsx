import {
  Provider,
  Root,
  Trigger,
  Portal,
  Content,
  Arrow,
} from "@radix-ui/react-tooltip";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export const TooltipProvider = Provider;
export const Tooltip = Root;
export const TooltipTrigger = Trigger;

export interface TooltipContentProps extends ComponentPropsWithoutRef<typeof Content> {
  withArrow?: boolean;
}

export const TooltipContent = forwardRef<
  HTMLDivElement,
  TooltipContentProps
>(({ className, sideOffset = 4, withArrow = false, children, ...props }, ref) => (
  <Portal>
    <Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-60 overflow-hidden rounded-md",
        "bg-popover text-popover-foreground",
        "px-2 py-1 text-[11px] font-medium",
        "ring-1 ring-black/5 dark:ring-white/5",
        "shadow-md",
        "data-[state=delayed-open]:animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]",
        "data-[state=closed]:animate-[fade-out_100ms_cubic-bezier(0.4,0,0.2,1)]",
        className,
      )}
      {...props}
    >
      {children}
      {withArrow && <Arrow className="fill-popover" />}
    </Content>
  </Portal>
));
TooltipContent.displayName = "TooltipContent";
