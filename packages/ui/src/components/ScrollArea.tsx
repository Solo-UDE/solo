import {
  Root,
  Viewport,
  Scrollbar,
  Thumb,
  Corner,
} from "@radix-ui/react-scroll-area";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export const ScrollArea = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Root> & { viewportClassName?: string }
>(({ className, children, viewportClassName, ...props }, ref) => (
  <Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <Viewport className={cn("size-full", viewportClassName)}>{children}</Viewport>
    <ScrollBar />
    <Corner className="bg-transparent" />
  </Root>
));
ScrollArea.displayName = "ScrollArea";

export const ScrollBar = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Scrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <Scrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none p-px transition-colors",
      orientation === "vertical" && "h-full w-2",
      orientation === "horizontal" && "h-2 w-full flex-col",
      className,
    )}
    {...props}
  >
    <Thumb className="relative flex-1 rounded-full bg-foreground/30 hover:bg-foreground/50 transition-colors" />
  </Scrollbar>
));
ScrollBar.displayName = "ScrollBar";
