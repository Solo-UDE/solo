// Local shim — re-exports Dialog from @solo/ui.
//
// The prior shadcn/ui wrapper auto-rendered a close button inside every
// DialogContent; the @solo/ui Dialog exposes `showCloseButton` (default
// `false`). Existing call sites that want the close button must pass
// `showCloseButton`, or use DialogClose directly.
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@solo/ui";
