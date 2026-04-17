import {
  Root,
  Trigger,
  Value,
  Icon,
  Portal,
  Content,
  Viewport,
  Item,
  ItemText,
  ItemIndicator,
  Group,
  Label,
  Separator as RadixSeparator,
  ScrollUpButton,
  ScrollDownButton,
} from "@radix-ui/react-select";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export const Select = Root;
export const SelectValue = Value;
export const SelectGroup = Group;

export interface SelectTriggerProps extends ComponentPropsWithoutRef<typeof Trigger> {
  size?: "sm" | "md";
}

export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, size = "md", children, ...props }, ref) => {
    const sizes = {
      sm: "h-7 px-2 text-[12px]",
      md: "h-8 px-2.5 text-[13px]",
    };
    return (
      <Trigger
        ref={ref}
        className={cn(
          "inline-flex items-center justify-between gap-2 rounded-md w-full",
          "bg-input text-foreground",
          "ring-1 ring-black/5 dark:ring-white/5",
          "focus:outline-2 -outline-offset-1 focus:outline-ring/60",
          "transition-colors duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "[&>span]:truncate",
          sizes[size],
          className,
        )}
        {...props}
      >
        {children}
        <Icon asChild>
          <svg width="8" height="5" viewBox="0 0 8 5" className="shrink-0 opacity-60" fill="none">
            <path d="M.5.5 4 4 7.5.5" stroke="currentColor" />
          </svg>
        </Icon>
      </Trigger>
    );
  },
);
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Content>
>(({ className, position = "popper", children, ...props }, ref) => (
  <Portal>
    <Content
      ref={ref}
      position={position}
      sideOffset={position === "popper" ? 4 : undefined}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md",
        "bg-popover text-popover-foreground",
        "ring-1 ring-black/5 dark:ring-white/10 shadow-lg",
        "data-[state=open]:animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]",
        "data-[state=closed]:animate-[fade-out_100ms_cubic-bezier(0.4,0,0.2,1)]",
        className,
      )}
      {...props}
    >
      <ScrollUpButton className="flex h-6 items-center justify-center text-muted-foreground">
        <svg width="8" height="5" viewBox="0 0 8 5" className="rotate-180" fill="none">
          <path d="M.5.5 4 4 7.5.5" stroke="currentColor" />
        </svg>
      </ScrollUpButton>
      <Viewport className="p-1">{children}</Viewport>
      <ScrollDownButton className="flex h-6 items-center justify-center text-muted-foreground">
        <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
          <path d="M.5.5 4 4 7.5.5" stroke="currentColor" />
        </svg>
      </ScrollDownButton>
    </Content>
  </Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Item>
>(({ className, children, ...props }, ref) => (
  <Item
    ref={ref}
    className={cn(
      "relative flex items-center gap-2 rounded-sm py-1 pl-6 pr-2 text-[13px] cursor-default select-none",
      "outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
      "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
      className,
    )}
    {...props}
  >
    <span className="absolute left-1.5 flex size-3 items-center justify-center">
      <ItemIndicator>
        <svg width="10" height="10" viewBox="0 0 14 14" className="stroke-current" strokeWidth="2" fill="none">
          <path d="M3 8L6 11L11 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ItemIndicator>
    </span>
    <ItemText>{children}</ItemText>
  </Item>
));
SelectItem.displayName = "SelectItem";

export const SelectLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Label>
>(({ className, ...props }, ref) => (
  <Label
    ref={ref}
    className={cn("px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground", className)}
    {...props}
  />
));
SelectLabel.displayName = "SelectLabel";

export const SelectSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixSeparator>
>(({ className, ...props }, ref) => (
  <RadixSeparator ref={ref} className={cn("-mx-1 my-1 h-px bg-border/60", className)} {...props} />
));
SelectSeparator.displayName = "SelectSeparator";
