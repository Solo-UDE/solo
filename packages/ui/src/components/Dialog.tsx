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
export const DialogPortal = Portal;

export const DialogOverlay = forwardRef<
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
DialogOverlay.displayName = "DialogOverlay";

/**
 * Dialog content frame with Codex-style entrance: translateY + scale.
 * Matches the `codex-dialog-enter` keyframe discovered in extraction.
 *
 * `showCloseButton` renders an absolute-positioned close affordance in the
 * top-right corner — matches the legacy shadcn/ui dialog convention.
 */
export interface DialogContentProps extends ComponentPropsWithoutRef<typeof Content> {
  size?: "sm" | "md" | "lg" | "xl";
  showCloseButton?: boolean;
}

const dialogSizes = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, size = "md", showCloseButton = false, children, ...props }, ref) => (
    <Portal>
      <DialogOverlay />
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
          dialogSizes[size],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <Close className="absolute right-3 top-3 inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground opacity-70 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring disabled:pointer-events-none">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="stroke-current" strokeWidth="1.5">
              <path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Close</span>
          </Close>
        )}
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
