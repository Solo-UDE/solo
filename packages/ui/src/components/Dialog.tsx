import {
  Root,
  Trigger,
  Portal,
  Overlay,
  Content,
  Title,
  Description,
  Close,
} from "@radix-ui/react-dialog";
import { forwardRef, type ComponentPropsWithoutRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export const Dialog = Root;
export const DialogTrigger = Trigger;
export const DialogClose = Close;

/**
 * Dialog content frame with Codex-style entrance: translateY + scale.
 * Matches the `codex-dialog-enter` keyframe discovered in extraction.
 */
export interface DialogContentProps extends ComponentPropsWithoutRef<typeof Content> {
  size?: "sm" | "md" | "lg" | "xl";
}

const dialogSizes = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, size = "md", children, ...props }, ref) => (
    <Portal>
      <Overlay
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]",
          "data-[state=open]:animate-[overlay-in_150ms_cubic-bezier(0.4,0,0.2,1)]",
          "data-[state=closed]:animate-[fade-out_100ms_cubic-bezier(0.4,0,0.2,1)]",
        )}
      />
      <Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2",
          "w-full p-6 rounded-xl",
          "bg-popover text-popover-foreground",
          "ring-1 ring-black/5 dark:ring-white/5 shadow-[var(--shadow-glass)]",
          "data-[state=open]:animate-[dialog-enter_200ms_cubic-bezier(0.16,1,0.3,1)]",
          "data-[state=closed]:animate-[fade-out_100ms_cubic-bezier(0.4,0,0.2,1)]",
          "focus:outline-none",
          dialogSizes[size],
          className,
        )}
        {...props}
      >
        {children}
      </Content>
    </Portal>
  ),
);
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}

export const DialogTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof Title>
>(({ className, ...props }, ref) => (
  <Title
    ref={ref}
    className={cn("text-base font-semibold tracking-tight text-foreground", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<typeof Description>
>(({ className, ...props }, ref) => (
  <Description
    ref={ref}
    className={cn("text-[13px] text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";
