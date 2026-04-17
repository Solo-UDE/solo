import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";
import { cn } from "../utils/cn";

/**
 * Toast — notification surface backed by Sonner.
 *
 * Mount `<Toaster />` once near the root of the app. Trigger via the
 * exported `toast()` helper. Styling routes through Sonner's `classNames`
 * slots so our tokens own the surface; Sonner only handles stacking,
 * dismissal, and promise orchestration.
 */
export function Toaster({
  position = "bottom-right",
  ...props
}: React.ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      position={position}
      offset={16}
      toastOptions={{
        classNames: {
          toast: cn(
            "!bg-popover !text-popover-foreground",
            "!ring-1 !ring-black/5 dark:!ring-white/10 !shadow-xl",
            "!rounded-md !px-3 !py-2",
            "!text-[13px] !font-medium",
          ),
          title: "text-foreground",
          description: "!text-muted-foreground text-[12px]",
          actionButton: cn(
            "!bg-primary !text-primary-foreground !rounded-sm",
            "!h-6 !px-2 !text-[12px] !font-medium",
          ),
          cancelButton: cn(
            "!bg-muted !text-muted-foreground !rounded-sm",
            "!h-6 !px-2 !text-[12px] !font-medium",
          ),
          success: "!text-success-foreground",
          error: "!text-destructive",
          warning: "!text-warning-foreground",
          info: "!text-info-foreground",
        },
      }}
      {...props}
    />
  );
}

export const toast = sonnerToast;
