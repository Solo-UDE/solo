import {
  Root,
  Trigger,
  Portal,
  Overlay,
  Content,
  Title,
  Description,
  Action,
  Cancel,
} from "@radix-ui/react-alert-dialog";
import { forwardRef, type ComponentPropsWithoutRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

/**
 * AlertDialog — modal confirmation. Identical styling to Dialog but wraps
 * Radix AlertDialog (focus trap + role=alertdialog) so screen readers treat
 * it as blocking.
 */
export const AlertDialog = Root;
export const AlertDialogTrigger = Trigger;
export const AlertDialogPortal = Portal;

export const AlertDialogOverlay = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Overlay>
>(({ className, ...props }, ref) => (
  <Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]",
      "data-[state=open]:animate-[overlay-in_150ms_cubic-bezier(0.4,0,0.2,1)]",
      "data-[state=closed]:animate-[fade-out_100ms_cubic-bezier(0.4,0,0.2,1)]",
      className,
    )}
    {...props}
  />
));
AlertDialogOverlay.displayName = "AlertDialogOverlay";

export interface AlertDialogContentProps extends ComponentPropsWithoutRef<typeof Content> {
  size?: "sm" | "md" | "lg" | "xl";
}

const sizes = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export const AlertDialogContent = forwardRef<HTMLDivElement, AlertDialogContentProps>(
  ({ className, size = "md", ...props }, ref) => (
    <Portal>
      <AlertDialogOverlay />
      <Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2",
          "w-full p-6 rounded-xl",
          "bg-popover text-popover-foreground",
          "ring-1 ring-black/5 dark:ring-white/5 shadow-xl",
          "data-[state=open]:animate-[dialog-enter_200ms_cubic-bezier(0.16,1,0.3,1)]",
          "data-[state=closed]:animate-[fade-out_100ms_cubic-bezier(0.4,0,0.2,1)]",
          "focus:outline-none",
          sizes[size],
          className,
        )}
        {...props}
      />
    </Portal>
  ),
);
AlertDialogContent.displayName = "AlertDialogContent";

export function AlertDialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}

export const AlertDialogTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof Title>
>(({ className, ...props }, ref) => (
  <Title
    ref={ref}
    className={cn("text-base font-semibold tracking-tight text-foreground", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = "AlertDialogTitle";

export const AlertDialogDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<typeof Description>
>(({ className, ...props }, ref) => (
  <Description
    ref={ref}
    className={cn("text-[13px] text-muted-foreground", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = "AlertDialogDescription";

/**
 * AlertDialogAction — primary button inside an alert dialog. Styled as primary.
 */
export const AlertDialogAction = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Action>
>(({ className, ...props }, ref) => (
  <Action
    ref={ref}
    className={cn(
      "inline-flex h-8 items-center justify-center rounded-md px-3.5 text-[13px] font-medium",
      "bg-primary text-primary-foreground transition-colors hover:bg-primary/90",
      "active:scale-[0.98] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
      className,
    )}
    {...props}
  />
));
AlertDialogAction.displayName = "AlertDialogAction";

/**
 * AlertDialogCancel — secondary button inside an alert dialog. Styled muted.
 */
export const AlertDialogCancel = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Cancel>
>(({ className, ...props }, ref) => (
  <Cancel
    ref={ref}
    className={cn(
      "inline-flex h-8 items-center justify-center rounded-md px-3.5 text-[13px] font-medium",
      "bg-secondary text-secondary-foreground transition-colors hover:bg-accent",
      "active:scale-[0.98] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
      className,
    )}
    {...props}
  />
));
AlertDialogCancel.displayName = "AlertDialogCancel";
