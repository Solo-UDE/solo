import {
  Root,
  Trigger,
  Portal,
  Content,
  Item,
  CheckboxItem,
  RadioGroup,
  RadioItem,
  Group,
  Label,
  ItemIndicator,
  Separator as RadixSeparator,
  Sub,
  SubTrigger,
  SubContent,
} from "@radix-ui/react-context-menu";
import { forwardRef, type ComponentPropsWithoutRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export const ContextMenu = Root;
export const ContextMenuTrigger = Trigger;
export const ContextMenuSub = Sub;
export const ContextMenuPortal = Portal;
export const ContextMenuGroup = Group;
export const ContextMenuRadioGroup = RadioGroup;

const cmItemBase = cn(
  "relative flex items-center gap-2 rounded-sm px-2 py-1 text-[13px] cursor-default select-none",
  "outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
  "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
);

export const ContextMenuCheckboxItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <CheckboxItem ref={ref} className={cn(cmItemBase, "pl-6", className)} {...props}>
    <span className="absolute left-1.5 flex size-3 items-center justify-center">
      <ItemIndicator>
        <svg width="10" height="10" viewBox="0 0 14 14" className="stroke-current" strokeWidth="2" fill="none">
          <path d="M3 8L6 11L11 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ItemIndicator>
    </span>
    {children}
  </CheckboxItem>
));
ContextMenuCheckboxItem.displayName = "ContextMenuCheckboxItem";

export const ContextMenuRadioItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadioItem>
>(({ className, children, ...props }, ref) => (
  <RadioItem ref={ref} className={cn(cmItemBase, "pl-6", className)} {...props}>
    <span className="absolute left-1.5 flex size-3 items-center justify-center">
      <ItemIndicator>
        <span className="size-1.5 rounded-full bg-current" />
      </ItemIndicator>
    </span>
    {children}
  </RadioItem>
));
ContextMenuRadioItem.displayName = "ContextMenuRadioItem";

export const ContextMenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Label>
>(({ className, ...props }, ref) => (
  <Label
    ref={ref}
    className={cn("px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide", className)}
    {...props}
  />
));
ContextMenuLabel.displayName = "ContextMenuLabel";

export function ContextMenuShortcut({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "ml-auto text-[11px] tracking-wide text-muted-foreground/80 font-mono",
        className,
      )}
      {...props}
    />
  );
}

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
