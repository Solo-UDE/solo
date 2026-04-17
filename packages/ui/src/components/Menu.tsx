import {
  Root,
  Trigger,
  Portal,
  Content,
  Item,
  Group,
  Label,
  CheckboxItem,
  RadioGroup,
  RadioItem,
  Separator as RadixSeparator,
  Sub,
  SubTrigger,
  SubContent,
  ItemIndicator,
} from "@radix-ui/react-dropdown-menu";
import { forwardRef, type ComponentPropsWithoutRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export const Menu = Root;
export const MenuTrigger = Trigger;
export const MenuGroup = Group;
export const MenuSub = Sub;
export const MenuRadioGroup = RadioGroup;
export const MenuPortal = Portal;

/**
 * Keyboard-shortcut affordance inside a menu item — pushes to the far right
 * of its row with muted colour and condensed tracking.
 */
export function MenuShortcut({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
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

const menuItemBase = cn(
  "relative flex items-center gap-2 rounded-sm px-2 py-1 text-[13px] cursor-default select-none",
  "outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
  "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
);

export const MenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <Portal>
    <Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[8rem] p-1 rounded-md",
        "bg-popover text-popover-foreground",
        "ring-1 ring-black/5 dark:ring-white/10 shadow-lg",
        "data-[state=open]:animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]",
        "data-[state=closed]:animate-[fade-out_100ms_cubic-bezier(0.4,0,0.2,1)]",
        className,
      )}
      {...props}
    />
  </Portal>
));
MenuContent.displayName = "MenuContent";

export const MenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Item>
>(({ className, ...props }, ref) => (
  <Item ref={ref} className={cn(menuItemBase, className)} {...props} />
));
MenuItem.displayName = "MenuItem";

export const MenuCheckboxItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <CheckboxItem ref={ref} className={cn(menuItemBase, "pl-6", className)} {...props}>
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
MenuCheckboxItem.displayName = "MenuCheckboxItem";

export const MenuRadioItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadioItem>
>(({ className, children, ...props }, ref) => (
  <RadioItem ref={ref} className={cn(menuItemBase, "pl-6", className)} {...props}>
    <span className="absolute left-1.5 flex size-3 items-center justify-center">
      <ItemIndicator>
        <span className="size-1.5 rounded-full bg-current" />
      </ItemIndicator>
    </span>
    {children}
  </RadioItem>
));
MenuRadioItem.displayName = "MenuRadioItem";

export const MenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Label>
>(({ className, ...props }, ref) => (
  <Label
    ref={ref}
    className={cn("px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide", className)}
    {...props}
  />
));
MenuLabel.displayName = "MenuLabel";

export const MenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixSeparator>
>(({ className, ...props }, ref) => (
  <RadixSeparator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border/60", className)}
    {...props}
  />
));
MenuSeparator.displayName = "MenuSeparator";

export const MenuSubTrigger = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof SubTrigger>
>(({ className, children, ...props }, ref) => (
  <SubTrigger
    ref={ref}
    className={cn(menuItemBase, "data-[state=open]:bg-accent", className)}
    {...props}
  >
    {children}
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      className="ml-auto stroke-current opacity-60"
      strokeWidth="1.5"
      fill="none"
    >
      <path d="M2 1L6 4L2 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </SubTrigger>
));
MenuSubTrigger.displayName = "MenuSubTrigger";

export const MenuSubContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof SubContent>
>(({ className, ...props }, ref) => (
  <SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] p-1 rounded-md",
      "bg-popover text-popover-foreground",
      "ring-1 ring-black/5 dark:ring-white/10 shadow-lg",
      "data-[state=open]:animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]",
      className,
    )}
    {...props}
  />
));
MenuSubContent.displayName = "MenuSubContent";
