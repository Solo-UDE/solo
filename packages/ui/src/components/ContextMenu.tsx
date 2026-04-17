import {
  Root,
  Trigger,
  Portal,
  Content,
  Item,
  Separator as RadixSeparator,
  Sub,
  SubTrigger,
  SubContent,
} from "@radix-ui/react-context-menu";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export const ContextMenu = Root;
export const ContextMenuTrigger = Trigger;
export const ContextMenuSub = Sub;

const itemBase = cn(
  "relative flex items-center gap-2 rounded-sm px-2 py-1 text-[13px] cursor-default select-none",
  "outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
  "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
);

export const ContextMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Content>
>(({ className, ...props }, ref) => (
  <Portal>
    <Content
      ref={ref}
      className={cn(
        "z-50 min-w-[10rem] p-1 rounded-md",
        "bg-popover text-popover-foreground",
        "ring-1 ring-black/5 dark:ring-white/10 shadow-lg",
        "data-[state=open]:animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]",
        className,
      )}
      {...props}
    />
  </Portal>
));
ContextMenuContent.displayName = "ContextMenuContent";

export const ContextMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Item>
>(({ className, ...props }, ref) => (
  <Item ref={ref} className={cn(itemBase, className)} {...props} />
));
ContextMenuItem.displayName = "ContextMenuItem";

export const ContextMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixSeparator>
>(({ className, ...props }, ref) => (
  <RadixSeparator ref={ref} className={cn("-mx-1 my-1 h-px bg-border/60", className)} {...props} />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";

export const ContextMenuSubTrigger = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof SubTrigger>
>(({ className, ...props }, ref) => (
  <SubTrigger ref={ref} className={cn(itemBase, "data-[state=open]:bg-accent", className)} {...props} />
));
ContextMenuSubTrigger.displayName = "ContextMenuSubTrigger";

export const ContextMenuSubContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof SubContent>
>(({ className, ...props }, ref) => (
  <SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[10rem] p-1 rounded-md",
      "bg-popover text-popover-foreground",
      "ring-1 ring-black/5 dark:ring-white/10 shadow-lg",
      className,
    )}
    {...props}
  />
));
ContextMenuSubContent.displayName = "ContextMenuSubContent";
