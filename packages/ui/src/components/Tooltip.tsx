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
        "z-60",
        "data-[side=top]:[--solo-tooltip-origin:bottom]",
        "data-[side=bottom]:[--solo-tooltip-origin:top]",
        "data-[side=left]:[--solo-tooltip-origin:right]",
        "data-[side=right]:[--solo-tooltip-origin:left]",
      )}
      {...props}
    >
      <div
        className={cn(
          "overflow-hidden rounded-full",
          "bg-popover text-popover-foreground",
          "px-2 py-1 text-[11px] font-medium",
          "ring-1 ring-black/5 dark:ring-white/5",
          "shadow-md",
          "origin-[var(--solo-tooltip-origin,center)]",
          "animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]",
          className,
        )}
      >
        {children}
      </div>
      {withArrow && <Arrow className="fill-popover" />}
    </Content>
  </Portal>
));
TooltipContent.displayName = "TooltipContent";
