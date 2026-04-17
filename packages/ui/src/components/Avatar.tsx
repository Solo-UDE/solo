import { Root, Image, Fallback } from "@radix-ui/react-avatar";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export interface AvatarProps extends ComponentPropsWithoutRef<typeof Root> {
  size?: "xs" | "sm" | "md" | "lg";
}

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, size = "md", ...props }, ref) => {
    const sizes = {
      xs: "size-5 text-[9px]",
      sm: "size-6 text-[10px]",
      md: "size-8 text-[12px]",
      lg: "size-10 text-[14px]",
    };
    return (
      <Root
        ref={ref}
        className={cn(
          "relative inline-flex shrink-0 overflow-hidden rounded-full",
          "bg-muted",
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Avatar.displayName = "Avatar";

export const AvatarImage = forwardRef<
  HTMLImageElement,
  ComponentPropsWithoutRef<typeof Image>
>(({ className, ...props }, ref) => (
  <Image ref={ref} className={cn("aspect-square size-full object-cover", className)} {...props} />
));
AvatarImage.displayName = "AvatarImage";

export const AvatarFallback = forwardRef<
  HTMLSpanElement,
  ComponentPropsWithoutRef<typeof Fallback>
>(({ className, ...props }, ref) => (
  <Fallback
    ref={ref}
    className={cn(
      "flex size-full items-center justify-center",
      "bg-muted text-muted-foreground font-medium uppercase",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = "AvatarFallback";
