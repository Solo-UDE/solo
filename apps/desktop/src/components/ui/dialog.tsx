// Local shim — re-exports Dialog from @solo/ui.
//
// The legacy shadcn/ui dialog wrapper auto-rendered a close button inside
// every DialogContent. @solo/ui's DialogContent exposes `showCloseButton`
// (default `false`); this local wrapper flips the default to `true` so
// existing call sites preserve their close-button affordance without
// changing every import site.
import { forwardRef } from "react";
import {
  DialogContent as SoloDialogContent,
  type DialogContentProps as SoloDialogContentProps,
} from "@solo/ui";

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@solo/ui";

export type DialogContentProps = SoloDialogContentProps;

export const DialogContent = forwardRef<HTMLDivElement, SoloDialogContentProps>(
  ({ showCloseButton = true, ...props }, ref) => (
    <SoloDialogContent ref={ref} showCloseButton={showCloseButton} {...props} />
  ),
);
DialogContent.displayName = "DialogContent";
